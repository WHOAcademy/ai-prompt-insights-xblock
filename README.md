# AI Prompt Insights XBlock (v0.1.4)

Open edX formative prompt-writing activity: instructor-provided scenario, learner submission, AI evaluation (strengths, weaknesses, RCTF score, coaching feedback), retry, and completion on first valid submission.

The XBlock provides AI-assisted formative feedback on learner-submitted prompts.

## Install

In the **LMS Python environment**, not just your host OS:

```bash
pip install -e /path/to/ai-prompt-insights
```

`pyproject.toml` contains the complete setuptools configuration; `setup.py` is not required. Install with pip rather than `python setup.py install`.

For persistent Tutor deployments, bake the package into your custom Open edX image and restart/redeploy **both LMS and Studio**.

In Studio, open **Settings → Advanced Settings → Advanced Module List** and add this entry, preserving any existing entries:

```json
["ai_prompt_insights"]
```

Save, open a unit, and select **Advanced → ai_prompt_insights**. This is the registered XBlock type; the distribution and GitHub repository can retain the hyphenated `ai-prompt-insights` name. Renaming the entry point from `promptevaluator` is a breaking change for existing course content; migrate existing block types before removing the old package.

## Configure in Studio

Edit the component to set its scenario, attempt limit, score visibility, **OpenAI API key**, and **OpenAI model**. Publish the unit after saving so the LMS receives the settings.

The editor uses Studio's standard settings-form markup (the same as xblock-lti-consumer). **Model** is a dropdown of the supported models only (gpt-4o-mini, gpt-4o, gpt-4.1-nano/mini, gpt-4.1, gpt-5-nano/mini, gpt-5, gpt-6-astra, gpt-6.1-sol, gpt-6-luna); other values are rejected on save. Default: `gpt-4o-mini`.

Minimum and maximum prompt lengths are no longer Studio settings. Input validation uses fixed limits of **20–5,000 characters** in both the learner interface and backend.

The key field is masked and never displays the stored key. Leave it blank to keep the key, enter a replacement, or click the field's reset (↺) button and save to remove it. Saving without a key is allowed; learner submissions still complete the activity, but feedback fails until a key is configured. The API key and model come from Studio; the encryption key is read through Django settings in both LMS and CMS.

API keys are stored as Fernet-encrypted ciphertext in XBlock settings and can appear as ciphertext in exports and backups. Restrict access to those artifacts. Saved keys are never included in learner responses or editor initialization; authoring access is checked with Studio's course write-permission service. OpenAI billing and model access are required.

### Azure OpenAI and other OpenAI-compatible endpoints

**API Base URL** is optional. Leave it blank to use OpenAI. When set, feedback requests use that endpoint instead:

| Provider | API Base URL | API Key | Model |
|---|---|---|---|
| OpenAI | *(blank)* | `sk-...` | e.g. `gpt-4o-mini` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/v1/` | Azure resource key | a listed model; name your Azure **deployment** exactly the same (e.g. `gpt-4o-mini`) |

On Azure OpenAI the model value is sent as the deployment name, so the deployment must use the same name as the chosen model. The endpoint must support Chat Completions with JSON output. The URL is called from the LMS server, so only use endpoints you trust.

## Test

```bash
pip install -e '.[test]'
pytest -q
python -m compileall -q ai_prompt_insights
```

## Behavior

- First valid submission marks the XBlock complete even if feedback generation fails.
- No grading/pass threshold. Optional score is formative only.
- Retrying prompt creates a new attempt; retrying feedback uses last failed submission.
- User state stores the latest feedback and attempts. Long-term analytics requires additional storage.
- Existing prompt input and results are restored after reload.

## Limitations

This is a **base implementation**, not production-hardened: synchronous AI request, no idempotency guard against concurrent duplicate submissions, no analytics backend, no Azure provider, and unbounded attempts. Editing requires the Open edX `studio_user_permissions` service; other runtimes must supply it. Validate Studio editing, publishing, and LMS progress on the target deployment. 

## Encryption configuration

Generate a Fernet key once with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Configure it in the effective **LMS and CMS Django settings** (for example, via your Open edX `common.py` configuration):

```python
AI_PROMPT_INSIGHTS_ENCRYPTION_KEY = "<same-generated-fernet-key-in-both-services>"
```

The XBlock obtains this setting through `django.conf.settings`, not `os.environ`. Do not use a new key on each deployment. If the configuration files are tracked in Git, do **not** commit the actual key: inject the same protected value into both effective Django settings at deployment time. Keep it out of course exports; back it up independently. Existing plaintext keys must be re-entered through Studio. Losing or rotating the encryption key without migration makes previously stored credentials unreadable.

Requests are limited per learner and XBlock: 10 submissions and 3 feedback retries per hour. Reuse Open edX's **shared** Django default Redis/Memcached cache across workers; per-process local memory is rejected.
