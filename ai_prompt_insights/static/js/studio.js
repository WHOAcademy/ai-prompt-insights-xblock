/* Studio editor. Same markup and save payload as StudioEditableXBlockMixin. */
function AIPromptInsightsStudio(runtime, element, config) {
  "use strict";
  var $root = $(element).find(".pe-studio");
  function $field(name) {
    return $root.find("#xb-field-edit-" + name);
  }

  // Model dropdown: the fixed list of supported models.
  var $model = $field("model");
  $.each(config.models, function (i, model) { $model.append($("<option>").val(model).text(model)); });

  // Fill the form from saved settings. The saved API key is never sent to the browser.
  $field("display_name").val(config.values.display_name);
  $field("scenario").val(config.values.scenario);
  $field("max_attempts").val(config.values.max_attempts);
  $field("show_score").val(config.values.show_score ? "1" : "0");
  $field("api_base_url").val(config.values.api_base_url);
  $model.val(config.models.indexOf(config.values.model) === -1 ? config.models[0] : config.values.model);

  var $key = $field("api_key"), $keyItem = $key.closest("li"), $keyClear = $keyItem.find(".setting-clear");
  var removeKey = false;
  function updateKeyState() {
    var saved = config.hasApiKey && !removeKey;
    $keyItem.toggleClass("is-set", saved || $key.val() !== "");
    $keyClear.toggleClass("active", saved).toggleClass("inactive", !saved);
    $root.find(".pe-key-help").text(
      removeKey ? "The saved key will be removed when you save." :
      saved ? "An encrypted key is saved. Leave blank to keep it, or enter a new key to replace it." :
      "Encrypted before storage; course exports contain ciphertext, not the plaintext key.");
  }
  $key.on("input", function () { removeKey = false; updateKeyState(); });
  $keyClear.on("click", function () { if (config.hasApiKey) {
    removeKey = true; $key.val(""); updateKeyState();
  } });
  updateKeyState();

  $root.find(".save-button").on("click", function (event) {
    event.preventDefault();
    var values = {
      display_name: $field("display_name").val(),
      scenario: $field("scenario").val(),
      max_attempts: parseInt($field("max_attempts").val(), 10),
      show_score: $field("show_score").val() === "1",
      api_base_url: $field("api_base_url").val().trim(),
      model: $model.val()
    };
    if ($key.val().trim()) { values.api_key = $key.val(); }
    runtime.notify("save", {state: "start", message: gettext("Saving")});
    $.ajax({
      type: "POST", url: runtime.handlerUrl(element, "submit_studio_edits"),
      data: JSON.stringify({values: values, defaults: removeKey ? ["api_key"] : []}),
      dataType: "json", global: false
    }).done(function () {
      runtime.notify("save", {state: "end"});
    }).fail(function (xhr) {
      var message = gettext("Unable to save. Check your connection and try again.");
      try {
        var error = JSON.parse(xhr.responseText).error;
        message = error && error.messages ? $.map(error.messages, function (m) { return m.text; }).join(", ") : error || message;
      } catch (e) { /* keep the generic message */ }
      runtime.notify("error", {title: gettext("Unable to update settings"), message: message});
    });
  });

  $root.find(".cancel-button").on("click", function (event) {
    event.preventDefault();
    runtime.notify("cancel", {});
  });
}
