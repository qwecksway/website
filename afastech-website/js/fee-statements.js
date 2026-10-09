(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(value) {
    var n = Number(value) || 0;
    return n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function yearLabel(value) {
    return String(value || "").replace(/^SHS\s*/i, "Year ");
  }

  function itemRows(s) {
    var base = s.base_fees != null ? s.base_fees : s.total_fees;
    var rows = [{ description: s.item_description || "School Fees", amount: base }].concat(s.items || []);
    return rows.map(function (row, index) {
      return "<tr><td>" + (index + 1) + "</td><td>" + esc(row.description) + '</td><td class="num">' + money(row.amount) + "</td></tr>";
    }).join("");
  }

  function statementHtml(s) {
    var paid = Number(s.amount_paid) || 0;
    var payable = Number(s.amount_payable) || 0;
    var now = new Date().toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var logo = new URL("assets/afastech-logo.png", document.baseURI).href;
    return '<div class="fee-statement">' +
      '<div class="fee-banner"><img class="fee-logo" src="' + esc(logo) + '" alt="AFASTECH logo">' +
      '<div class="fee-school-lg">AFADJATO SENIOR HIGH<br>TECHNICAL SCHOOL</div>' +
      '<div class="fee-school-md">AFADJATO SENIOR HIGH TECHNICAL SCHOOL</div>' +
      '<div class="fee-dept">DEPARTMENT OF FINANCE</div></div>' +
      '<h3 class="fee-title">STUDENT FEE STATEMENT</h3>' +
      '<table class="fee-meta">' +
      "<tr><th>Student ID / Index Number:</th><td>" + esc(s.index_number || "-") + "</td><th>Date:</th><td>" + esc(now) + "</td></tr>" +
      "<tr><th>Student Name:</th><td colspan=\"3\">" + esc(s.student_name || "-") + "</td></tr>" +
      "<tr><th>Programme:</th><td colspan=\"3\">" + esc(s.programme || "-") + "</td></tr>" +
      "<tr><th>Academic Year:</th><td>" + esc(s.academic_year || "-") + "</td><th>Semester:</th><td>" + esc(s.semester || "-") + "</td></tr>" +
      "<tr><th>Level / Year:</th><td>" + esc(yearLabel(s.year) || "-") + "</td><th>Currency:</th><td>GHs</td></tr>" +
      "</table>" +
      '<table class="fee-items"><thead><tr><th>Sn</th><th>Item</th><th class="num">Amount (GHS)</th></tr></thead><tbody>' +
      itemRows(s) +
      '<tr class="fee-total"><td colspan="2" class="num"><strong>Total</strong></td><td class="num"><strong>' + money(s.total_fees) + "</strong></td></tr>" +
      "</tbody></table>" +
      '<table class="fee-summary">' +
      "<tr><th>Balance from previous academic year:</th><td class=\"num\">" + money(s.previous_balance) + "</td></tr>" +
      "<tr><th>Amount Paid:</th><td class=\"num fee-credit\">" + (paid > 0 ? "-" : "") + money(paid) + "</td></tr>" +
      "<tr class=\"fee-payable\"><th>Amount Payable:</th><td class=\"num " + (payable > 0 ? "fee-owing" : "fee-credit") + "\">" + money(payable) + "</td></tr>" +
      "</table>" +
      '<p class="fee-note">*** A <span class="fee-credit">negative value</span> indicates a CREDIT BALANCE in the student\'s favour.<br>' +
      'A <span class="fee-owing">positive value</span> indicates an OUTSTANDING AMOUNT to be paid. ***</p>' +
      '<div class="fee-sign"><div><strong>Prepared by:</strong><div class="fee-line"></div><span>Name / Signature</span></div>' +
      '<div><strong>Finance Officer:</strong><div class="fee-line"></div><span>Signature</span></div></div>' +
      "</div>";
  }

  var printCss = "body{font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#000;margin:24px}" +
    "table{width:100%;border-collapse:collapse}.num{text-align:right;font-family:'Courier New',monospace}" +
    ".fee-meta th{text-align:left;width:22%;padding:4px 6px;vertical-align:top}.fee-meta td{padding:4px 6px}" +
    ".fee-items{margin:14px 0;border:1px solid #000}.fee-items th{background:#ddd;border:1px solid #000;padding:6px;text-align:left}" +
    ".fee-items th.num{text-align:right}.fee-items td{border:1px solid #000;padding:6px}" +
    ".fee-summary{width:70%;margin-left:auto}.fee-summary th{text-align:right;padding:6px}.fee-summary td{padding:6px;border-bottom:1px solid #000;width:30%}" +
    ".fee-payable th,.fee-payable td{border-top:2px solid #000;font-weight:bold}" +
    ".fee-owing{color:#b00020}.fee-credit{color:#1b6e2d}.fee-note{text-align:center;font-size:10px;margin:20px 0}" +
    ".fee-banner{position:relative;background:#ffffe0;color:#000;border:1px solid #000;padding:14px 56px;text-align:center}" +
    ".fee-logo{position:absolute;left:12px;top:50%;transform:translateY(-50%);height:56px;width:auto}" +
    ".fee-school-lg{font-size:23px;font-weight:bold;line-height:1.2}.fee-school-md{font-size:18px;margin-top:6px}.fee-dept{font-size:16px;margin-top:4px}" +
    ".fee-title{font-size:18px;text-decoration:underline;text-align:center;margin:14px 0;font-weight:bold}" +
    ".fee-sign{display:flex;gap:40px;margin-top:40px}.fee-sign>div{flex:1}.fee-line{border-bottom:1px solid #000;height:36px;margin-bottom:10px}";

  function printStatement(s) {
    var win = window.open("", "_blank");
    if (!win) {
      window.alert("Allow pop-ups for this site to print the statement.");
      return;
    }
    win.document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>Fee Statement</title><style>" + printCss +
      "</style></head><body>" + statementHtml(s) + "</body></html>");
    win.document.close();
    win.focus();
    win.onload = function () { win.print(); };
    setTimeout(function () { try { win.print(); } catch (e) { /* closed */ } }, 600);
  }

  function ensureStyles() {
    if (document.getElementById("fee-statement-styles")) return;
    var style = document.createElement("style");
    style.id = "fee-statement-styles";
    style.textContent = printCss.replace("body{font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#000;margin:24px}", "") +
      ".fee-statement{background:#fff;color:#000;padding:1.25rem;border:1px solid #cfd6d2;border-radius:8px;font-family:Georgia,serif;font-size:.9rem;overflow-x:auto}" +
      ".fee-actions{display:flex;gap:.75rem;margin-top:1rem;flex-wrap:wrap}" +
      ".fee-dialog{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.7);display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto}" +
      ".fee-dialog form{background:#fff;border-radius:12px;padding:1.75rem;max-width:480px;width:100%}" +
      ".fee-dialog .fee-readout{background:#f3f6f4;border-radius:8px;padding:.75rem 1rem;margin:.5rem 0 1rem;font-weight:600}";
    document.head.appendChild(style);
  }

  async function renderStudent(client) {
    var box = document.getElementById("student-fee-statement");
    if (!box) return;
    ensureStyles();
    var result = await client.rpc("get_my_fee_statement");
    if (result.error || !result.data) {
      box.textContent = "Your fee statement could not be loaded.";
      return;
    }
    var s = result.data;
    if (!s.recorded) {
      box.innerHTML = "<p>No fee statement has been recorded for you yet. Your house master will post it.</p>";
      return;
    }
    box.innerHTML = statementHtml(s) + '<div class="fee-actions"><button class="btn btn-primary" type="button" id="student-fee-print">Print Statement</button></div>';
    document.getElementById("student-fee-print").addEventListener("click", function () { printStatement(s); });
  }

  async function openEditor(client, record, onSaved) {
    ensureStyles();
    var alertBox = document.getElementById("portal-data-alert");
    var result = await client.rpc("get_fee_statement", { target_student_id: record.student_id });
    if (result.error || !result.data) {
      if (alertBox) {
        alertBox.textContent = "The fee statement could not be loaded: " + (result.error ? result.error.message : "student not found");
        alertBox.className = "alert alert-error show";
      }
      return;
    }
    var s = result.data;
    var overlay = document.createElement("div");
    overlay.className = "fee-dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = "<form><h2>Fee statement</h2><p><strong>" + esc(s.student_name || "Student") + "</strong> · " + esc(s.index_number || "") + "</p>" +
      '<div class="field"><label>Academic year</label><input name="academic_year" maxlength="20" placeholder="2026/2027" value="' + esc(s.academic_year) + '"></div>' +
      '<div class="field"><label>Fee item</label><input name="item" maxlength="200" value="' + esc(s.item_description) + '"></div>' +
      '<div class="field"><label>Total amount owed (GHS)</label><input name="total" type="number" step="0.01" min="0" required value="' + esc(s.base_fees != null ? s.base_fees : s.total_fees) + '"></div>' +
      ((s.items || []).length ? '<p style="color:#555;font-size:.85rem;">Plus ' + s.items.length + " added charge(s) totalling GHS " +
        money(s.items.reduce(function (sum, i) { return sum + Number(i.amount); }, 0)) + " (managed under Finance &rarr; Add a charge).</p>" : "") +
      '<div class="field"><label>Balance from previous year (GHS, negative for credit)</label><input name="previous" type="number" step="0.01" required value="' + esc(s.previous_balance) + '"></div>' +
      '<div class="field"><label>Amount paid (GHS)</label><input name="paid" type="number" step="0.01" min="0" required value="' + esc(s.amount_paid) + '"></div>' +
      '<div class="fee-readout">Balance (amount payable): <span data-balance></span></div>' +
      '<div class="fee-actions"><button class="btn btn-primary" type="submit">Save</button>' +
      '<button class="btn btn-outline" type="button" data-print>Print</button>' +
      '<button class="btn btn-outline" type="button" data-close>Close</button></div>' +
      '<p class="alert" role="status" style="margin-top:1rem;"></p></form>';
    document.body.appendChild(overlay);
    var form = overlay.querySelector("form");
    var status = overlay.querySelector(".alert");
    var readout = overlay.querySelector("[data-balance]");

    function current() {
      var total = parseFloat(form.total.value) || 0;
      var previous = parseFloat(form.previous.value) || 0;
      var paid = parseFloat(form.paid.value) || 0;
      var extra = (s.items || []).reduce(function (sum, i) { return sum + Number(i.amount); }, 0);
      return {
        student_name: s.student_name, index_number: s.index_number, programme: s.programme, year: s.year,
        academic_year: form.academic_year.value.trim(), item_description: form.item.value.trim() || "School Fees",
        base_fees: total, items: s.items || [], total_fees: total + extra, previous_balance: previous, amount_paid: paid,
        amount_payable: Math.round((total + extra + previous - paid) * 100) / 100
      };
    }
    function refresh() {
      var c = current();
      readout.textContent = "GHS " + money(c.amount_payable) + (c.amount_payable < 0 ? " (credit)" : c.amount_payable > 0 ? " (owing)" : "");
    }
    form.addEventListener("input", refresh);
    refresh();
    overlay.querySelector("[data-close]").addEventListener("click", function () { overlay.remove(); });
    overlay.querySelector("[data-print]").addEventListener("click", function () { printStatement(current()); });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var c = current();
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      var saved = await client.rpc("save_fee_statement", {
        target_student_id: record.student_id,
        target_academic_year: c.academic_year,
        target_item: c.item_description,
        target_total: c.base_fees,
        target_previous: c.previous_balance,
        target_paid: c.amount_paid
      });
      button.disabled = false;
      status.textContent = saved.error ? "Could not save: " + saved.error.message : "Saved. The student can now see this statement.";
      status.className = "alert show " + (saved.error ? "alert-error" : "alert-success");
      if (!saved.error && onSaved) onSaved();
    });
  }

  async function initCharges(client, students) {
    var box = document.getElementById("admin-fee-charges");
    if (!box || box.dataset.ready) return;
    box.dataset.ready = "true";
    ensureStyles();
    var opts = await client.rpc("fee_charge_options");
    if (opts.error) {
      box.textContent = "Fee charges are unavailable. Apply the latest Supabase migration (supabase db push).";
      return;
    }
    var years = opts.data.years || [];
    var programmes = opts.data.programmes || [];
    function options(list) { return list.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }).join(""); }
    box.innerHTML = '<h3 style="margin-top:0">Add a charge</h3>' +
      '<p style="color:var(--stone);margin-top:0">Add a new fee item to students\' statements. Each charge appears as its own line on the statement.</p>' +
      '<form class="fee-charge-form">' +
      '<div class="field"><label>Item description</label><input name="description" maxlength="200" required placeholder="e.g. PTA Levy"></div>' +
      '<div class="field"><label>Amount (GHS, negative for a discount)</label><input name="amount" type="number" step="0.01" required></div>' +
      '<div class="field"><label>Apply to</label><select name="scope"><option value="year">A whole year</option><option value="programme">A programme</option>' +
      '<option value="student">One student</option><option value="all">All students</option></select></div>' +
      '<div class="field" data-scope="year"><label>Year</label><select name="year">' + options(years) + "</select></div>" +
      '<div class="field" data-scope="programme" hidden><label>Programme</label><select name="programme">' + options(programmes) + "</select></div>" +
      '<div class="field" data-scope="student" hidden><label>Student</label><select name="student">' +
      students.map(function (st) { return '<option value="' + esc(st.student_id) + '">' + esc(st.full_name || "Unnamed") + "</option>"; }).join("") + "</select></div>" +
      '<div class="fee-actions"><button class="btn btn-primary" type="submit">Add charge</button></div>' +
      '<p class="alert" role="status" style="margin-top:1rem;"></p></form>' +
      '<h3>Charge history</h3><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Date</th><th>Item</th><th>Amount (GHS)</th><th>Applied to</th><th>Students</th><th></th></tr></thead>' +
      '<tbody data-charge-history></tbody></table></div>';
    var form = box.querySelector("form");
    var status = box.querySelector(".alert");
    var history = box.querySelector("[data-charge-history]");

    function scopeFields() {
      form.querySelectorAll("[data-scope]").forEach(function (el) { el.hidden = el.getAttribute("data-scope") !== form.scope.value; });
    }
    form.scope.addEventListener("change", scopeFields);
    scopeFields();

    function scopeArgs() {
      var type = form.scope.value;
      return {
        scope_type: type,
        scope_value: type === "year" ? form.year.value : type === "programme" ? form.programme.value : "",
        target_student_id: type === "student" ? form.student.value || null : null
      };
    }
    function say(text, ok) { status.textContent = text; status.className = "alert show " + (ok ? "alert-success" : "alert-error"); }

    async function loadHistory() {
      var res = await client.rpc("list_fee_charges");
      history.replaceChildren();
      var list = res.data || [];
      if (res.error || !list.length) {
        history.innerHTML = '<tr><td colspan="6">' + (res.error ? "Could not load charges." : "No charges have been added yet.") + "</td></tr>";
        return;
      }
      list.forEach(function (c) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td>" + esc(new Date(c.created_at).toLocaleDateString("en-GB")) + "</td><td>" + esc(c.description) + "</td><td>" + money(c.amount) +
          "</td><td>" + esc(c.scope_label) + "</td><td>" + c.student_count + "</td><td></td>";
        var cell = tr.lastChild;
        if (c.voided) {
          cell.textContent = "Reversed";
        } else {
          var undo = document.createElement("button");
          undo.type = "button";
          undo.className = "btn btn-outline";
          undo.textContent = "Reverse";
          undo.addEventListener("click", async function () {
            if (!window.confirm("Reverse \"" + c.description + "\"? It will be removed from " + c.student_count + " student statement(s).")) return;
            undo.disabled = true;
            var r = await client.rpc("void_fee_charge", { target_charge_id: c.id });
            say(r.error ? "Could not reverse: " + r.error.message : "Charge reversed.", !r.error);
            loadHistory();
          });
          cell.appendChild(undo);
        }
        history.appendChild(tr);
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var args = scopeArgs();
      var amount = parseFloat(form.amount.value);
      var description = form.description.value.trim();
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      var preview = await client.rpc("preview_fee_charge", args);
      if (preview.error) { say("Could not check recipients: " + preview.error.message, false); button.disabled = false; return; }
      var ok = window.confirm("Add \"" + description + "\" of GHS " + money(amount) + " to " + preview.data + " student(s)? Total: GHS " + money(amount * preview.data));
      if (!ok) { button.disabled = false; return; }
      var res = await client.rpc("apply_fee_charge", Object.assign({ charge_description: description, charge_amount: amount }, args));
      button.disabled = false;
      if (res.error) { say("Could not add the charge: " + res.error.message, false); return; }
      say("Added to " + res.data + " student statement(s).", true);
      form.description.value = "";
      form.amount.value = "";
      loadHistory();
    });
    loadHistory();
  }

  window.AfastechFees = { renderStudent: renderStudent, openEditor: openEditor, initCharges: initCharges };
})();