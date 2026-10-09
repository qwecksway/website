(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function num(value) {
    return (Math.round(Number(value) * 100) / 100).toString();
  }

  function classLabel(value) {
    return String(value || "").replace(/^SHS\s*/i, "Year ");
  }

  var css = ".rs-doc{background:#fff;color:#000;padding:1.25rem;border:1px solid #cfd6d2;border-radius:8px;font-family:Georgia,'Times New Roman',serif;font-size:.9rem;overflow-x:auto}" +
    ".rs-doc table{width:100%;border-collapse:collapse}" +
    ".rs-banner{position:relative;background:#ffffe0;color:#000;border:1px solid #000;padding:14px 56px;text-align:center}" +
    ".rs-logo{position:absolute;left:12px;top:50%;transform:translateY(-50%);height:56px;width:auto}" +
    ".rs-lg{font-size:23px;font-weight:bold;line-height:1.2}.rs-md{font-size:18px;margin-top:6px}" +
    ".rs-title{font-size:18px;text-decoration:underline;text-align:center;margin:14px 0;font-weight:bold}" +
    ".rs-meta th{text-align:left;width:22%;padding:4px 6px;vertical-align:top}.rs-meta td{padding:4px 6px}" +
    ".rs-term{margin:16px 0 6px;font-weight:bold;font-size:1rem}" +
    ".rs-table{margin:6px 0 10px;border:1px solid #000}.rs-table th{background:#ddd;border:1px solid #000;padding:6px;text-align:center}" +
    ".rs-table th.rs-left,.rs-table td.rs-left{text-align:left}.rs-table td{border:1px solid #000;padding:6px;text-align:center}" +
    ".rs-fail{color:#b00020;font-weight:bold}.rs-gpa{width:60%;margin-left:auto}.rs-gpa th{text-align:right;padding:5px}.rs-gpa td{padding:5px;border-bottom:1px solid #000;width:25%;text-align:center}" +
    ".rs-sum{width:70%;margin:14px 0 0 auto;border-top:2px solid #000}.rs-sum th{text-align:right;padding:5px}.rs-sum td{padding:5px;border-bottom:1px solid #000;width:25%;text-align:center;font-weight:bold}" +
    ".rs-note{text-align:center;font-size:10px;margin:18px 0}" +
    ".rs-sign{display:flex;gap:40px;margin-top:40px}.rs-sign>div{flex:1}.rs-line{border-bottom:1px solid #000;height:36px;margin-bottom:10px}" +
    ".rs-actions{display:flex;gap:.75rem;margin-top:1rem}";

  function ensureStyles() {
    if (document.getElementById("student-results-styles")) return;
    var style = document.createElement("style");
    style.id = "student-results-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function termHtml(report, term) {
    var types = report.types || [];
    var head = '<th class="rs-left">Subject</th>' + types.map(function (t) { return "<th>" + esc(t.name) + "</th>"; }).join("") +
      '<th>Total</th><th>Grade</th><th>Grade Point</th><th class="rs-left">Description</th>';
    var rows = (term.subjects || []).map(function (s) {
      var cells = (s.cells || []).map(function (cell) {
        if (cell.score == null) return "<td>IC</td>";
        return "<td>" + esc(num(cell.score) + (Number(cell.max) !== 100 ? " / " + num(cell.max) : "")) + "</td>";
      }).join("");
      var failed = s.complete && Number(s.grade_point) === 0;
      return '<tr><td class="rs-left">' + esc(s.name) + "</td>" + cells +
        "<td>" + (s.total == null ? "IC" : esc(num(s.total))) + "</td>" +
        '<td class="' + (failed ? "rs-fail" : "") + '"><strong>' + esc(s.grade) + "</strong></td>" +
        "<td>" + esc(num(s.grade_point)) + '</td><td class="rs-left">' + esc(s.description) + "</td></tr>";
    }).join("") || '<tr><td class="rs-left" colspan="' + (types.length + 5) + '">No subjects have been set up for this class yet.</td></tr>';
    return '<div class="rs-term">' + esc(term.year) + " Academic Year &mdash; " + esc(term.term) +
      (term.class_name ? " &mdash; " + esc(classLabel(term.class_name)) : "") + "</div>" +
      '<table class="rs-table"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table>" +
      '<table class="rs-gpa"><tr><th>Semester GPA:</th><td><strong>' + esc(num(term.gpa)) + "</strong></td></tr></table>";
  }

  function documentHtml(report, info) {
    var terms = report.terms || [];
    var latest = terms[terms.length - 1] || {};
    var now = new Date().toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var logo = new URL("assets/afastech-logo.png", document.baseURI).href;
    return '<div class="rs-doc">' +
      '<div class="rs-banner"><img class="rs-logo" src="' + esc(logo) + '" alt="AFASTECH logo">' +
      '<div class="rs-lg">AFADJATO SENIOR HIGH<br>TECHNICAL SCHOOL</div>' +
      '<div class="rs-md">AFADJATO SENIOR HIGH TECHNICAL SCHOOL</div></div>' +
      '<h3 class="rs-title">STATEMENT OF RESULTS</h3>' +
      '<table class="rs-meta">' +
      "<tr><th>Student ID / Index Number:</th><td>" + esc(info.index || "-") + "</td><th>Date:</th><td>" + esc(now) + "</td></tr>" +
      '<tr><th>Student Name:</th><td colspan="3">' + esc(info.name || "-") + "</td></tr>" +
      '<tr><th>Programme:</th><td colspan="3">' + esc(info.programme || "-") + "</td></tr>" +
      "<tr><th>Academic Year:</th><td>" + esc(latest.year || "-") + "</td><th>Semester:</th><td>" + esc(latest.term || "-") + "</td></tr>" +
      '<tr><th>Class:</th><td colspan="3">' + esc(classLabel(latest.class_name) || "-") + "</td></tr>" +
      "</table>" +
      terms.map(function (t) { return termHtml(report, t); }).join("") +
      '<table class="rs-sum">' +
      "<tr><th>Number of Incompletes (ICs):</th><td>" + esc(report.ic_total) + "</td></tr>" +
      "<tr><th>Number of Fails (Es):</th><td>" + esc(report.fail_total) + "</td></tr>" +
      "<tr><th>CGPA:</th><td>" + esc(num(report.cgpa)) + "</td></tr></table>" +
      '<p class="rs-note">*** IC means the assessment is incomplete or not yet recorded. ***</p>' +
      '<div class="rs-sign"><div><strong>Prepared by:</strong><div class="rs-line"></div><span>Name / Signature</span></div>' +
      '<div><strong>Head of Academics:</strong><div class="rs-line"></div><span>Signature</span></div></div></div>';
  }

  function printDoc(html) {
    var win = window.open("", "_blank");
    if (!win) {
      window.alert("Allow pop-ups for this site to print the statement.");
      return;
    }
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Statement of Results</title><style>body{margin:24px;font-size:13px}' +
      css + ".rs-doc{border:0;padding:0}</style></head><body>" + html + "</body></html>");
    win.document.close();
    win.focus();
    win.onload = function () { win.print(); };
    setTimeout(function () { try { win.print(); } catch (e) { /* closed */ } }, 600);
  }

  async function render(client, container) {
    if (!container) return;
    ensureStyles();
    var result = await client.rpc("student_my_results_report");
    if (result.error || !result.data) {
      container.innerHTML = '<p class="student-empty-note">Your results could not be loaded. Please try again later.</p>';
      return;
    }
    var report = result.data;
    if (!(report.terms || []).length) {
      container.innerHTML = '<p class="student-empty-note">Your class and semester have not been set up yet, so there are no results to show.</p>';
      return;
    }
    var info = { index: "", name: "", programme: "" };
    try {
      var user = (await client.auth.getUser()).data.user;
      var details = await client.from("student_details").select("index_number, programme").eq("profile_id", user.id).maybeSingle();
      var profile = await client.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      info.index = details.data && details.data.index_number;
      info.programme = details.data && details.data.programme;
      info.name = profile.data && profile.data.full_name;
    } catch (e) { /* header falls back to dashes */ }

    var html = documentHtml(report, info);
    container.innerHTML = html + '<div class="rs-actions"><button class="btn btn-primary" type="button" id="student-results-print">Print Statement</button></div>';
    document.getElementById("student-results-print").addEventListener("click", function () { printDoc(html); });
  }

  window.AfastechResults = { render: render };
})();
