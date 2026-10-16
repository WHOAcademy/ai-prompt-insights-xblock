"""Open edX AI Prompt Insights XBlock.

Completion is based on first valid saved submission, not AI quality or availability.
"""
import re
import uuid
from contextlib import contextmanager
from importlib.resources import files

from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Integer, List, Scope, String
from xblock.fragment import Fragment
from xblock.utils.studio_editable import StudioEditableXBlockMixin
from xblock.validation import ValidationMessage

from .credentials import EncryptionConfigurationError, decrypt_api_key, encrypt_api_key
from .evaluator import DEFAULT_MODEL, MODEL_OPTIONS, EvaluationError, evaluate_prompt
from .limits import LimitConfigurationError, consume, shared_cache

BASE_URL = re.compile(r"https?://[^\s/$.?#][^\s]{0,499}", re.IGNORECASE)


@XBlock.wants("studio_user_permissions")
class AIPromptInsightsXBlock(StudioEditableXBlockMixin, XBlock):
    """Handle Studio settings, learner attempts, and AI feedback."""

    has_custom_completion = True
    has_score = False
    MIN_PROMPT_CHARACTERS = 20
    MAX_PROMPT_CHARACTERS = 5000

    display_name = String(default="AI Prompt Insights", scope=Scope.settings,
                          display_name="Display Name",
                          help="The name learners see for this component.")
    scenario = String(
        default=("Your supervisor needs a summary of a 40-page field report on food security "
                 "in East Africa for a director-level meeting tomorrow. Write the prompt you "
                 "would use to ask an AI assistant for help."),
        scope=Scope.settings, display_name="Scenario", multiline_editor=True,
        help="The situation learners write a prompt for.",
    )
    max_attempts = Integer(default=3, scope=Scope.settings, display_name="Maximum Attempts",
                           values={"min": 0, "step": 1},
                           help="How many prompts a learner may submit. 0 means unlimited.")
    show_score = Boolean(default=True, scope=Scope.settings, display_name="Show Score",
                         help="Show the numeric RCTF score with the feedback.")
    api_base_url = String(
        default="", scope=Scope.settings, display_name="API Base URL",
        help="Leave blank for OpenAI. For Azure OpenAI or another OpenAI-compatible service, "
             "enter its endpoint, e.g. https://<resource>.openai.azure.com/openai/v1/",
    )
    api_key = String(default="", scope=Scope.settings, display_name="API Key")
    model = String(default=DEFAULT_MODEL, scope=Scope.settings, display_name="Model",
                   help="Choose the model used for feedback. With a custom API Base URL, it must match the model or deployment name there.")
    editable_fields = ("display_name", "scenario", "max_attempts", "show_score",
                       "api_base_url", "api_key", "model")

    is_completed = Boolean(default=False, scope=Scope.user_state)
    attempts = List(default=[], scope=Scope.user_state)

    @staticmethod
    def _resource(name):
        """Read a static HTML, CSS, or JavaScript resource."""
        return files("ai_prompt_insights").joinpath("static", name).read_text(encoding="utf-8")

    def _require_studio_write(self):
        """Ensure the current Studio user may modify course content."""
        permissions = self.runtime.service(self, "studio_user_permissions")
        context_key = getattr(self.scope_ids.usage_id, "context_key", None)
        if not permissions or context_key is None or not permissions.can_write(context_key):
            raise JsonHandlerError(403, "Studio write access is required.")

    # Studio editor: our own HTML using the StudioEditableXBlockMixin markup (same look as
    # xblock-lti-consumer). Saving uses the mixin's
    # submit_studio_edits handler, with clean_studio_edits/validate_field_data below.

    def studio_view(self, context=None):
        """Render the Studio editor without exposing saved API credentials."""
        self._require_studio_write()
        fragment = Fragment(self._resource("html/studio.html"))
        fragment.add_javascript(self._resource("js/studio.js"))
        fragment.initialize_js("AIPromptInsightsStudio", {
            "values": {name: getattr(self, name)
                       for name in ("display_name", "scenario", "max_attempts", "show_score",
                                    "api_base_url", "model")},
            "hasApiKey": bool(self.api_key),  # never the key itself
            "models": list(MODEL_OPTIONS),
        })
        return fragment

    def clean_studio_edits(self, data):
        """Normalize incoming settings and encrypt newly entered API keys."""
        # Runs before any field is changed, so a 403 or 400 here leaves settings untouched.
        self._require_studio_write()
        for name in ("display_name", "scenario", "model", "api_base_url"):
            if isinstance(data.get(name), str):
                data[name] = data[name].strip()
        if "api_key" in data:
            key = data["api_key"]
            if not isinstance(key, str) or len(key) > 1024 or any(c.isspace() for c in key.strip()):
                raise JsonHandlerError(400, "Enter a valid API key without spaces.")
            if key.strip():
                try:
                    data["api_key"] = encrypt_api_key(key.strip())
                except EncryptionConfigurationError as exc:
                    raise JsonHandlerError(503, str(exc)) from exc
            else:
                del data["api_key"]  # blank input keeps the saved key

    def validate_field_data(self, validation, data):
        """Report invalid Studio settings before persisting them."""
        def error(text):
            validation.add(ValidationMessage(ValidationMessage.ERROR, text))
        if not (data.display_name or "").strip():
            error("Display Name is required.")
        if not (data.scenario or "").strip():
            error("Scenario is required.")
        if isinstance(data.max_attempts, bool) or not isinstance(data.max_attempts, int) \
                or data.max_attempts < 0:
            error("Maximum Attempts must be a whole number, 0 or greater.")
        if data.model not in MODEL_OPTIONS:
            error("Choose one of the listed models.")
        base_url = data.api_base_url or ""
        if base_url and not BASE_URL.fullmatch(base_url):
            error("API Base URL must be a full http:// or https:// address, or left blank for OpenAI.")

    def student_view(self, context=None):
        """Render the learner interface and initialize its configuration."""
        fragment = Fragment(self._resource("html/student.html"))
        fragment.add_css(self._resource("css/student.css"))
        fragment.add_javascript(self._resource("js/student.js"))
        fragment.initialize_js("AIPromptInsightsXBlock", {
            "scenario": self.scenario,
            "minCharacters": self.MIN_PROMPT_CHARACTERS,
            "maxCharacters": self.MAX_PROMPT_CHARACTERS,
            "maxAttempts": self.max_attempts,
            "showScore": self.show_score,
        })
        return fragment

    def _current_state(self):
        """Return learner completion and attempt history."""
        saved = self.attempts
        return {
            "completed": self.is_completed,
            "attempt_count": len(saved),
            "attempts": saved,
            "latest": saved[-1] if saved else None,
            "max_attempts": self.max_attempts,
        }

    def _identity(self):
        """Return the current learner and block identifiers."""
        user = getattr(self.scope_ids, "user_id", None)
        if user is None:
            raise JsonHandlerError(403, "Sign in to submit prompts.")
        return str(user), str(self.scope_ids.usage_id)

    def _consume(self, action, limit):
        """Consume a request from the learner's hourly shared-cache quota."""
        user, usage = self._identity()
        try:
            if not consume(user, usage, action, limit):
                raise JsonHandlerError(429, "AI request quota reached. Please try later.")
        except LimitConfigurationError as exc:
            raise JsonHandlerError(503, "AI request limits are not configured.") from exc

    @contextmanager
    def _submission_guard(self):
        """Serialize a learner's submissions using a shared-cache lease."""
        user, usage = self._identity()
        cache = shared_cache()
        key = f"ai-prompt-insights:busy:{user}:{usage}"
        token = uuid.uuid4().hex
        if not cache.add(key, token, timeout=40):
            raise JsonHandlerError(429, "An evaluation is already in progress.")
        try:
            yield
        finally:
            # Never delete a newer lock if the original lease expired.
            if cache.get(key) == token:
                cache.delete(key)

    @XBlock.json_handler
    def get_state(self, data, suffix=""):
        """Fetch saved attempt history for the current learner."""
        return self._current_state()

    @XBlock.json_handler
    def submit_prompt(self, data, suffix=""):
        """Persist a valid submission and request AI feedback."""
        prompt = data.get("prompt") if isinstance(data, dict) else None
        if not isinstance(prompt, str):
            return {"error": "Enter a prompt before submitting."}
        prompt = prompt.strip()
        if len(prompt) < self.MIN_PROMPT_CHARACTERS:
            return {"error": f"Please enter at least {self.MIN_PROMPT_CHARACTERS} characters."}
        if len(prompt) > self.MAX_PROMPT_CHARACTERS:
            return {"error": f"Please use at most {self.MAX_PROMPT_CHARACTERS} characters."}
        with self._submission_guard():
            if self.max_attempts < 0:
                return {"error": "Invalid activity configuration. Please contact the instructor."}
            if self.max_attempts and len(self.attempts) >= self.max_attempts:
                return {"error": "You have used all available attempts."}

            self._consume("submit", 10)

            # Persist submission before calling AI; AI outages must not block completion.
            attempt = {"number": len(self.attempts) + 1, "prompt": prompt,
                       "status": "pending", "feedback": None}
            self.attempts = self.attempts + [attempt]
            if not self.is_completed:
                self.is_completed = True
                self.runtime.publish(self, "completion", {"completion": 1.0})

            try:
                feedback = evaluate_prompt(prompt=prompt, scenario=self.scenario,
                                           api_key=decrypt_api_key(self.api_key), model=self.model,
                                           base_url=self.api_base_url)
                attempt = dict(attempt, status="ready", feedback=feedback)
            except (EvaluationError, EncryptionConfigurationError):
                attempt = dict(attempt, status="failed")
            self.attempts = self.attempts[:-1] + [attempt]
            return self._current_state()

    @XBlock.json_handler
    def retry_evaluation(self, data, suffix=""):
        """Retry feedback for the most recent failed submission."""
        with self._submission_guard():
            if not self.attempts:
                return {"error": "No submission found."}
            current = self.attempts[-1]
            if current["status"] != "failed":
                return {"error": "Only failed evaluations can be retried."}
            if current.get("retry_count", 0) >= 3:
                return {"error": "The maximum feedback retries for this attempt were reached."}
            self._consume("retry", 3)
            retry_count = current.get("retry_count", 0) + 1
            try:
                feedback = evaluate_prompt(prompt=current["prompt"], scenario=self.scenario,
                                           api_key=decrypt_api_key(self.api_key), model=self.model,
                                           base_url=self.api_base_url)
                updated = dict(current, status="ready", feedback=feedback, retry_count=retry_count)
            except (EvaluationError, EncryptionConfigurationError):
                updated = dict(current, status="failed", retry_count=retry_count)
            self.attempts = self.attempts[:-1] + [updated]
            return self._current_state()

    @staticmethod
    def workbench_scenarios():
        """Provide an example block for XBlock Workbench."""
        return [("ai-prompt-insights", "<ai-prompt-insights/>")]
