// AFASTECH — Admissions wizard (front-end demo flow, no backend attached).
// Mirrors the 6-step CSSPS-style flow: placement -> voucher -> forms ->
// class choice -> prospectus -> letter. All data stays in memory only.
(function () {
  "use strict";

  var form = document.getElementById("admissions-wizard");
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll(".wizard-step"));
  var progressSteps = Array.prototype.slice.call(document.querySelectorAll(".progress-step"));
  var current = 0;

  var state = {
    indexNumber: "",
    examYear: "",
    voucherSerial: "",
    voucherPin: "",
    programme: ""
  };

  function showStep(i) {
    steps.forEach(function (s, idx) {
      s.hidden = idx !== i;
    });
    progressSteps.forEach(function (p, idx) {
      p.classList.toggle("active", idx === i);
      p.classList.toggle("done", idx < i);
    });
    var region = document.getElementById("wizard-live");
    if (region) region.textContent = "Step " + (i + 1) + " of " + steps.length;
    window.scrollTo({ top: form.offsetTop - 100, behavior: "smooth" });
  }

  function validateStep(i) {
    var stepEl = steps[i];
    var inputs = stepEl.querySelectorAll("input[required], select[required]");
    var valid = true;
    inputs.forEach(function (input) {
      var field = input.closest(".field");
      if (!input.value.trim()) {
        valid = false;
        if (field) field.classList.add("has-error");
      } else if (field) {
        field.classList.remove("has-error");
      }
    });
    return valid;
  }

  form.addEventListener("click", function (e) {
    var next = e.target.closest("[data-wizard-next]");
    var back = e.target.closest("[data-wizard-back]");

    if (next) {
      e.preventDefault();
      if (!validateStep(current)) return;

      if (current === 1) {
        // fake voucher check
        var serial = form.querySelector("#voucherSerial").value.trim();
        var pin = form.querySelector("#voucherPin").value.trim();
        var result = document.getElementById("voucher-result");
        if (serial.length < 4 || pin.length < 4) {
          result.textContent = "That voucher serial/PIN combination could not be verified. Double-check and try again.";
          result.className = "alert alert-error show";
          return;
        }
        result.textContent = "Voucher accepted. You may continue.";
        result.className = "alert alert-success show";
        state.voucherSerial = serial;
        state.voucherPin = pin;
      }

      if (current < steps.length - 1) {
        current += 1;
        showStep(current);
      }

      if (current === steps.length - 1) {
        renderSummary();
      }
    }

    if (back) {
      e.preventDefault();
      if (current > 0) {
        current -= 1;
        showStep(current);
      }
    }
  });

  function renderSummary() {
    var summary = document.getElementById("wizard-summary");
    if (!summary) return;
    var indexNumber = form.querySelector("#indexNumber");
    var examYear = form.querySelector("#examYear");
    var programme = form.querySelector("#programmeChoice");
    var rows = [
      ["BECE index number", indexNumber ? indexNumber.value : ""],
      ["Exam year", examYear ? examYear.value : ""],
      ["Voucher serial", state.voucherSerial],
      ["Programme selected", programme ? programme.options[programme.selectedIndex].text : ""]
    ];
    summary.innerHTML = rows
      .map(function (r) {
        return "<tr><th>" + r[0] + "</th><td>" + (r[1] || "\u2014") + "</td></tr>";
      })
      .join("");
  }

  showStep(0);
})();
