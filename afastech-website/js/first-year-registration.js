(function () {
  "use strict";

  var areas = {
    "General Arts": [
      ["Government", "Economics", "Additional Mathematics", "Geography"],
      ["Government", "Economics", "French", "Geography"],
      ["Government", "Economics", "Business Management", "French"]
    ],
    "Business": [["Accounting", "Economics", "Business Management", "Computing", "Agriculture"]],
    "Applied Technology": [
      ["Design and Communication Technology", "Building Construction and Wood Technology", "Business Management", "Additional Mathematics"],
      ["Design and Communication Technology", "Electrical and Electronic Technology", "Geography", "Physics"],
      ["Design and Communication Technology", "Electrical and Electronic Technology", "Geography", "Computing"]
    ],
    "Home Economics": [
      ["Agriculture", "Biology", "Management in Living", "Food and Nutrition"],
      ["Agriculture", "Biology", "Management in Living", "Clothing and Textiles"]
    ],
    "Agriculture": [["Agriculture", "Biology", "Business Management", "Chemistry"]],
    "Languages": [
      ["Government", "Literature-in-English", "Agriculture", "Ewe"],
      ["Government", "Literature-in-English", "French", "History"]
    ]
  };
  var form = document.getElementById("first-year-form");
  var area = document.getElementById("learning-area");
  var option = document.getElementById("subject-option");
  var status = document.getElementById("registration-status");
  var submit = document.getElementById("registration-submit");
  var reference = null;
  var lastPayload = "";
  var client = window.supabase && window.AFASTECH_SUPABASE_URL && window.AFASTECH_SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.AFASTECH_SUPABASE_URL, window.AFASTECH_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    }) : null;

  function showStatus(message, kind) {
    status.textContent = message;
    status.className = message ? "alert alert-" + kind + " show" : "alert";
  }
  function step(name) {
    ["subjects", "details", "review"].forEach(function (part) {
      document.getElementById("registration-" + part).hidden = part !== name;
    });
    showStatus("", "");
    document.getElementById("registration-" + name).querySelector("h2").scrollIntoView({ block: "start" });
  }
  function addOption(select, value, text) {
    var item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    select.appendChild(item);
  }
  Object.keys(areas).forEach(function (name) { addOption(area, name, name); });
  var today = new Date();
  document.getElementById("dob").max = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  area.addEventListener("change", function () {
    option.replaceChildren();
    addOption(option, "", area.value ? "Select a combination" : "Select a learning area first");
    (areas[area.value] || []).forEach(function (subjects, index) {
      addOption(option, String(index + 1), "Option " + (index + 1) + ": " + subjects.join(", "));
    });
    option.disabled = !area.value;
  });
  document.getElementById("subjects-next").addEventListener("click", function () {
    if (area.reportValidity() && option.reportValidity()) step("details");
  });
  document.querySelectorAll("[data-back]").forEach(function (button) {
    button.addEventListener("click", function () { step(button.dataset.back); });
  });
  document.getElementById("details-next").addEventListener("click", function () {
    var fields = Array.from(document.querySelectorAll("#registration-details input, #registration-details select"));
    var invalid = fields.find(function (field) { return !field.checkValidity() || (field.required && !field.value.trim()); });
    if (invalid) {
      if (invalid.validity.valid) invalid.setCustomValidity("Please complete this field.");
      invalid.reportValidity();
      invalid.setCustomValidity("");
      return;
    }
    var summary = document.getElementById("registration-summary");
    summary.replaceChildren();
    [area, option].concat(fields).forEach(function (field) {
      var label = form.querySelector('label[for="' + field.id + '"]');
      var term = document.createElement("dt");
      var description = document.createElement("dd");
      term.textContent = label.textContent.replace(/\s*\*$/, "");
      description.textContent = field.tagName === "SELECT" ? field.options[field.selectedIndex].text : (field.value.trim() || "Not provided");
      summary.append(term, description);
    });
    step("review");
  });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!client || !window.crypto || !window.crypto.randomUUID) {
      showStatus("Registration is unavailable. Use a secure connection and contact the school if the problem continues.", "error");
      return;
    }
    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = String(value).trim(); });
    var serialized = JSON.stringify(payload);
    if (!reference || lastPayload !== serialized) {
      reference = window.crypto.randomUUID();
      lastPayload = serialized;
    }
    submit.disabled = true;
    document.querySelectorAll("#registration-review [data-back]").forEach(function (button) { button.disabled = true; });
    showStatus("Saving your registration…", "success");
    try {
      var result = await client.rpc("submit_first_year_registration", { submission_id: reference, registration: payload });
      if (result.error) throw result.error;
      form.hidden = true;
      document.getElementById("registration-reference").textContent = reference;
      document.getElementById("registration-complete").hidden = false;
      showStatus("", "");
    } catch (error) {
      console.error("First year registration failed:", error);
      showStatus(error && error.code === "55000" && error.message === "First year registration is closed."
        ? "First year registration is closed. Contact the school if you need help."
        : "We could not confirm that your registration was saved. Retry with the same details; if the problem continues, contact the school before submitting again.", "error");
    } finally {
      submit.disabled = false;
      document.querySelectorAll("#registration-review [data-back]").forEach(function (button) { button.disabled = false; });
    }
  });
})();
