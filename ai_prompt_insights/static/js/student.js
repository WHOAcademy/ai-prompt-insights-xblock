/* Learner view: collapsible attempt history (latest expanded) and a "Try again" composer. */
function AIPromptInsightsXBlock(runtime, element, config) {
  "use strict";
  element = element.jquery ? element[0] : element;
  var root = element.querySelector(".pe-root");
  function find(selector) {
    return root.querySelector(selector);
  }

  var attemptsBox = find(".pe-attempts"), compose = find(".pe-compose"), actions = find(".pe-actions");
  var input = find(".pe-input"), submit = find(".pe-submit"), tryAgain = find(".pe-try-again");
  var messageBox = find(".pe-message");
  var busy = false, state = null;

  find(".pe-scenario").textContent = config.scenario;
  input.id = "pe-input-" + Math.random().toString(36).slice(2);
  find(".pe-compose-label").setAttribute("for", input.id);

  var ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>'
  };
  function icon(name, className) {
    var span = document.createElement("span");
    span.className = "pe-icon-wrap " + (className || "");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = '<svg class="pe-icon" viewBox="0 0 24 24">' + ICONS[name] + "</svg>";  // static markup only
    return span;
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
    node.className = className;
  }
    if (text !== undefined && text !== null) {
    node.textContent = text;
  }
    return node;
  }
  function message(value) {
    messageBox.textContent = value || "";
  }
  // Counter, submit state and auto-growing textarea, updated as the learner types.
  var countBox = find(".pe-count");
  function updateCount() {
    var length = input.value.trim().length, needed = config.minCharacters - length;
    countBox.textContent = needed > 0 ? needed + " more character" + (needed === 1 ? "" : "s") + " needed"
      : input.value.length + " / " + config.maxCharacters;
    countBox.classList.toggle("is-over", length > config.maxCharacters);
    if (!busy) {
    submit.disabled = needed > 0 || length > config.maxCharacters;
  }
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight + 2, 360) + "px";
  }
  input.addEventListener("input", updateCount);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit.click(); }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform || "")) { find(".pe-shortcut").textContent = "⌘ + Enter to submit"; }

  // Strengths / weaknesses as a tinted card ("good" = green, "improve" = amber).
  function feedbackCard(title, items, iconName, tone, unit) {
    var card = el("div", "pe-card pe-card-" + tone);
    var head = el("div", "pe-card-head");
    head.appendChild(icon(iconName, "pe-icon-" + iconName));
    head.appendChild(el("div", "pe-card-title", title));
    // Labelled count on the right, tinted with the card colour: "1 strength", "4 areas".
    head.appendChild(el("span", "pe-card-count", items.length + " " + unit + (items.length === 1 ? "" : "s")));
    card.appendChild(head);
    // divs with list roles, not ul/li: LMS list styles (indent, margins, markers) can't reach them.
    var list = el("div", "pe-list");
    list.setAttribute("role", "list");
    items.forEach(function (item) {
      var row = el("div", "pe-list-item", item);
      row.setAttribute("role", "listitem");
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  // RCTF breakdown: one card per criterion (0-25) with a bar, plus the overall score.
  var CRITERIA = [["role", "Role"], ["context", "Context"], ["task", "Task"], ["format", "Format"]];

  function scoreSection(f) {
    var section = el("div", "pe-block");
    var head = el("div", "pe-score-head");
    head.appendChild(el("div", "pe-section-title", "RCTF score"));
    head.appendChild(el("span", "pe-score-total", f.overall_score + " / 100"));
    section.appendChild(head);
    var grid = el("div", "pe-criteria");
    CRITERIA.forEach(function (pair) {
      var value = f.scores[pair[0]];
      var card = el("div", "pe-criterion");
      var top = el("div", "pe-criterion-top");
      top.appendChild(el("span", "pe-criterion-name", pair[1]));
      top.appendChild(el("span", "pe-criterion-value", value + "/25"));
      var bar = el("div", "pe-bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", pair[1] + ": " + value + " out of 25");
      var fill = el("div", "pe-bar-fill");
      fill.style.width = Math.max(0, Math.min(100, value * 4)) + "%";
      bar.appendChild(fill);
      card.appendChild(top); card.appendChild(bar);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  }

  // Per-element explanation, shown in the coach's feedback card as a vertical R-C-T-F stepper.
  function reasonsBreakdown(f) {
    var reasons = f.reasons || {};
    var items = CRITERIA.filter(function (pair) { return reasons[pair[0]]; });
    if (!items.length) {
    return null;
  }
    var section = el("div", "pe-coach-breakdown");
    section.appendChild(el("div", "pe-coach-subtitle", "RCTF breakdown"));
    var steps = el("div", "pe-steps");
    steps.setAttribute("role", "list");
    items.forEach(function (pair) {
      var step = el("div", "pe-step");
      step.setAttribute("role", "listitem");
      step.appendChild(el("span", "pe-step-marker", pair[1].charAt(0)));
      var content = el("div", "pe-step-content");
      content.appendChild(el("div", "pe-step-name", pair[1]));
      content.appendChild(el("div", "pe-step-text", reasons[pair[0]]));
      step.appendChild(content);
      steps.appendChild(step);
    });
    section.appendChild(steps);
    return section;
  }

  function copyText(text, button) {
    var label = button.querySelector(".pe-copy-label");
    function done() {
      label.textContent = "Copied";
      setTimeout(function () { label.textContent = "Copy"; }, 1500);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    // Clipboard API can be blocked inside the courseware iframe; use a hidden textarea instead.
    var area = el("textarea"); area.value = text; area.setAttribute("readonly", "");
    area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    try { document.execCommand("copy"); } catch (e) { /* nothing else to try */ }
    document.body.removeChild(area);
  }

  var ICON_EXTRA = {
    bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
  };
  Object.keys(ICON_EXTRA).forEach(function (name) { ICONS[name] = ICON_EXTRA[name]; });

  function chip(className, iconName, text, title) {
    var node = el("span", "pe-chip " + className);
    if (title) {
    node.title = title;
  }
    if (iconName) {
    node.appendChild(icon(iconName));
  }
    node.appendChild(el("span", "", text));
    return node;
  }

  function renderAttempt(attempt, flags) {
    var item = el("details", "pe-attempt");
    item.open = flags.latest;
    var f = attempt.status === "ready" ? attempt.feedback : null;

    var summary = el("summary", "pe-attempt-head");
    var titleBox = el("span", "pe-attempt-title");
    titleBox.appendChild(el("span", "", "Attempt " + attempt.number));
    if (flags.latest) {
    titleBox.appendChild(el("span", "pe-tag", "Latest"));
  }
    if (flags.best) {
    titleBox.appendChild(el("span", "pe-tag pe-tag-best", "Best"));
  }
    summary.appendChild(titleBox);
    var meta = el("span", "pe-attempt-meta");
    if (f) {
      meta.appendChild(chip("pe-chip-good", "check", String(f.strengths.length), "Strengths"));
      meta.appendChild(chip("pe-chip-improve", "info", String(f.weaknesses.length), "Things to improve"));
      if (config.showScore) {
    meta.appendChild(el("span", "pe-score-pill", String(f.overall_score)));
  }
    } else if (attempt.status === "failed") {
      meta.appendChild(chip("pe-chip-warn", "alert", "Feedback unavailable"));
    } else {
      meta.appendChild(chip("pe-chip-muted", null, "Evaluating…"));
    }
    meta.appendChild(icon("chevron", "pe-chevron"));
    summary.appendChild(meta);
    item.appendChild(summary);

    var body = el("div", "pe-attempt-body");

    // Learner's prompt as a quote block; long prompts are clamped with a toggle.
    var promptBlock = el("div", "pe-block");
    var promptHead = el("div", "pe-prompt-head");
    promptHead.appendChild(el("span", "pe-block-label", "Your prompt"));
    var copy = el("button", "pe-copy");
    copy.type = "button";
    copy.appendChild(icon("copy")); copy.appendChild(el("span", "pe-copy-label", "Copy"));
    copy.addEventListener("click", function () { copyText(attempt.prompt, copy); });
    promptHead.appendChild(copy);
    promptBlock.appendChild(promptHead);
    var quote = el("blockquote", "pe-quote", attempt.prompt);
    promptBlock.appendChild(quote);
    if (attempt.prompt.length > 280 || attempt.prompt.split("\n").length > 4) {
      quote.classList.add("is-clamped");
      var more = el("button", "pe-link", "Show more");
      more.type = "button";
      more.addEventListener("click", function () {
        var clamped = quote.classList.toggle("is-clamped");
        more.textContent = clamped ? "Show more" : "Show less";
      });
      promptBlock.appendChild(more);
    }
    body.appendChild(promptBlock);

    if (f) {
      if (config.showScore) {
    body.appendChild(scoreSection(f));
  }
      var cards = el("div", "pe-cards");
      if (f.strengths.length) {
    cards.appendChild(feedbackCard("What worked", f.strengths, "check", "good", "strength"));
  }
      if (f.weaknesses.length) {
    cards.appendChild(feedbackCard("What to improve", f.weaknesses, "info", "improve", "area"));
  }
      if (cards.children.length === 1) {
    cards.classList.add("is-single");
  }
      body.appendChild(cards);
      // Coach's feedback card: gradient header, feedback paragraph, then the RCTF breakdown.
      var coach = el("section", "pe-coach");
      var coachHead = el("div", "pe-coach-head");
      coachHead.appendChild(icon("bulb", "pe-coach-icon"));
      var coachTitles = el("div");
      coachTitles.appendChild(el("div", "pe-coach-title", "Coach's feedback"));
      coachTitles.appendChild(el("div", "pe-coach-caption", "A personal review of this attempt"));
      coachHead.appendChild(coachTitles);
      coach.appendChild(coachHead);
      var coachBody = el("div", "pe-coach-body");
      coachBody.appendChild(el("div", "pe-coach-text", f.coaching_feedback));
      var breakdown = reasonsBreakdown(f);
      if (breakdown) {
    coachBody.appendChild(breakdown);
  }
      coach.appendChild(coachBody);
      body.appendChild(coach);
    } else if (attempt.status === "failed") {
      var failed = el("div", "pe-notice");
      failed.appendChild(icon("alert", "pe-notice-icon"));
      var failedText = el("div");
      failedText.appendChild(el("p", "pe-notice-text", "Your prompt is saved, but we couldn't get AI feedback this time."));
      if (flags.latest) {
        var retry = el("button", "pe-btn pe-btn-secondary pe-retry", "Retry feedback");
        retry.type = "button";
        retry.addEventListener("click", function () { retryFeedback(retry); });
        failedText.appendChild(retry);
      }
      failed.appendChild(failedText);
      body.appendChild(failed);
    }
    item.appendChild(body);
    return item;
  }

  function attemptsLeft() { return !state.max_attempts || state.attempt_count < state.max_attempts; }

  var VISIBLE_ATTEMPTS = 3;  // older attempts sit behind "Show earlier attempts"

  function render(data) {
    state = data;
    var attempts = data.attempts || [];
    var best = null;
    if (config.showScore) {
      attempts.forEach(function (a) {
        if (a.status === "ready" && (!best || a.feedback.overall_score >= best.feedback.overall_score)) { best = a; }
      });
      if (attempts.filter(function (a) { return a.status === "ready"; }).length < 2) { best = null; }
    }
    attemptsBox.replaceChildren();
    var hiddenCount = Math.max(0, attempts.length - VISIBLE_ATTEMPTS);
    var older = el("div", "pe-older");
    older.hidden = true;
    attempts.forEach(function (attempt, index) {
      var node = renderAttempt(attempt, {latest: index === attempts.length - 1, best: attempt === best});
      (index < hiddenCount ? older : attemptsBox).appendChild(node);
    });
    if (hiddenCount) {
      var toggle = el("button", "pe-older-toggle");
      toggle.type = "button";
      var label = "Show " + hiddenCount + " earlier attempt" + (hiddenCount === 1 ? "" : "s");
      toggle.textContent = label;
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", function () {
        older.hidden = !older.hidden;
        toggle.textContent = older.hidden ? label : "Hide earlier attempts";
        toggle.setAttribute("aria-expanded", String(!older.hidden));
      });
      attemptsBox.insertBefore(older, attemptsBox.firstChild);
      attemptsBox.insertBefore(toggle, older);
    }
    attemptsBox.hidden = !attempts.length;
    showComposer(!attempts.length);
  }

  // The composer is shown for the first attempt and after "Try again"; otherwise "Try again" is offered.
  function showComposer(show) {
    var attempts = state.attempts || [], latest = attempts[attempts.length - 1];
    compose.hidden = !show;
    actions.hidden = show || !attemptsLeft() || Boolean(latest && latest.status === "pending");
    if (!show && !attemptsLeft()) { message("You have used all " + state.max_attempts + " attempts."); }
    if (show) {
    input.value = ""; updateCount();
  }
  }

  function setBusy(value, button, busyLabel) {
    busy = value;
    submit.disabled = value; tryAgain.disabled = value;
    if (value) {
    button.dataset.label = button.textContent; button.textContent = busyLabel;
  }
    else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
    button.disabled = value;
    button.classList.toggle("is-loading", value);
    if (!value) {
    updateCount();
  }
  }

  function csrfToken() {
    // fetch does not inherit the LMS jQuery AJAX CSRF setup, so send Django's token explicitly.
    var cookie = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
    if (cookie) {
    return decodeURIComponent(cookie[1]);
  }
    var field = document.querySelector("input[name=csrfmiddlewaretoken]");
    return field ? field.value : "";
  }
  function request(handler, payload) {
    return fetch(runtime.handlerUrl(element, handler), {
      method: "POST", credentials: "same-origin",
      headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken()},
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      if (!response.ok) {
    throw new Error("Request failed (" + response.status + ")");
  }
      return response.json();
    });
  }

  tryAgain.addEventListener("click", function () {
    if (busy) {
    return;
  }
    attemptsBox.querySelectorAll("details").forEach(function (item) { item.open = false; });
    message("");
    showComposer(true);
    input.focus();
  });

  submit.addEventListener("click", function () {
    if (busy || submit.disabled) {
    return;
  }
    var value = input.value.trim();
    if (value.length < config.minCharacters || value.length > config.maxCharacters) {
      message("Enter between " + config.minCharacters + " and " + config.maxCharacters + " characters."); return;
    }
    setBusy(true, submit, "Evaluating…"); message("");
    request("submit_prompt", {prompt: value})
      .then(function (data) {
        setBusy(false, submit);
        if (data.error) {
    message(data.error); return;
  }
        render(data);
      })
      .catch(function () { setBusy(false, submit); message("Could not submit the prompt. Please check your connection and retry."); });
  });

  function retryFeedback(button) {
    if (busy) {
    return;
  }
    setBusy(true, button, "Retrying…"); message("");
    request("retry_evaluation", {})
      .then(function (data) {
        setBusy(false, button);
        if (data.error) {
    message(data.error); return;
  }
        render(data);
      })
      .catch(function () { setBusy(false, button); message("Could not retry feedback. Please try again."); });
  }

  request("get_state", {}).then(render).catch(function () {
    state = {attempts: [], attempt_count: 0, max_attempts: config.maxAttempts};
    showComposer(true);
    message("Could not load previous attempts.");
  });
}
