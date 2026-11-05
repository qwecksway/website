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

  // Fallback descriptions for the standard WASSCE-style letter grades, used
  // only when the school's grade scale doesn't provide one for a grade.
  var GRADE_DESCRIPTIONS = {
    A1: "Excellent", B2: "Very Good", B3: "Good",
    C4: "Credit", C5: "Credit", C6: "Credit",
    D7: "Pass", E8: "Pass", F9: "Fail"
  };

  function formatDate(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
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

  // Groups the flat, continuously-updated transcript entries into one
  // table per year level/semester, in the order they were recorded.
  function groupTerms(entries) {
    var byKey = {};
    var order = [];
    (entries || []).forEach(function (entry) {
      var key = entry.year_level + "-" + entry.semester_no;
      if (!byKey[key]) {
        byKey[key] = { year_level: entry.year_level, semester_no: entry.semester_no, subjects: [] };
        order.push(key);
      }
      byKey[key].subjects.push(entry);
    });
    return order.map(function (key) { return byKey[key]; });
  }

  function termHtml(term) {
    var head = '<th class="rs-left">Subject</th><th>Grade</th><th>Grade Point</th><th class="rs-left">Description</th>';
    var gpaSum = 0;
    var gpaCount = 0;
    var rows = term.subjects.map(function (s) {
      if (s.grade_point_average != null) {
        gpaSum += Number(s.grade_point_average);
        gpaCount += 1;
      }
      var failed = s.grade_point_average != null && Number(s.grade_point_average) === 0;
      var description = GRADE_DESCRIPTIONS[String(s.final_grade || "").toUpperCase()] || "-";
      return '<tr><td class="rs-left">' + esc(s.subject_name) + "</td>" +
        '<td class="' + (failed ? "rs-fail" : "") + '"><strong>' + esc(s.final_grade || "-") + "</strong></td>" +
        "<td>" + (s.grade_point_average == null ? "-" : esc(num(s.grade_point_average))) + '</td><td class="rs-left">' + esc(description) + "</td></tr>";
    }).join("");
    var termGpa = gpaCount ? gpaSum / gpaCount : null;
    return '<div class="rs-term">Year ' + esc(term.year_level) + " &mdash; Semester " + esc(term.semester_no) + "</div>" +
      '<table class="rs-table"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table>" +
      '<table class="rs-gpa"><tr><th>Semester GPA:</th><td><strong>' + (termGpa == null ? "-" : esc(num(termGpa))) + "</strong></td></tr></table>";
  }

  function documentHtml(profile, terms) {
    var latest = terms[terms.length - 1] || {};
    var now = new Date().toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var logo = new URL("assets/afastech-logo.png", document.baseURI).href;
    return '<div class="rs-doc">' +
      '<div class="rs-banner"><img class="rs-logo" src="' + esc(logo) + '" alt="AFASTECH logo">' +
      '<div class="rs-lg">AFADJATO SENIOR HIGH<br>TECHNICAL SCHOOL</div>' +
      '<div class="rs-md">AFADJATO SENIOR HIGH TECHNICAL SCHOOL</div></div>' +
      '<h3 class="rs-title">STATEMENT OF RESULTS</h3>' +
      '<table class="rs-meta">' +
      "<tr><th>Student ID / Index Number:</th><td>" + esc(profile.index_number || "-") + "</td><th>Date:</th><td>" + esc(now) + "</td></tr>" +
      '<tr><th>Student Name:</th><td colspan="3">' + esc(profile.full_name || "-") + "</td></tr>" +
      '<tr><th>Programme:</th><td colspan="3">' + esc(profile.study_area || "-") + "</td></tr>" +
      "<tr><th>Date of Birth:</th><td>" + esc(formatDate(profile.date_of_birth)) + "</td><th>Year of Admission:</th><td>" + esc(profile.year_of_admission || "-") + "</td></tr>" +
      "<tr><th>Current Year Level:</th><td>" + esc(latest.year_level || "-") + "</td><th>Current Semester:</th><td>" + esc(latest.semester_no || "-") + "</td></tr>" +
      "</table>" +
      terms.map(termHtml).join("") +
      '<table class="rs-sum">' +
      "<tr><th>Cumulative GPA:</th><td>" + (profile.cumulative_gpa == null ? "-" : esc(num(profile.cumulative_gpa))) + "</td></tr>" +
      "<tr><th>Credits Earned:</th><td>" + (profile.credits_earned == null ? "-" : esc(num(profile.credits_earned))) + "</td></tr></table>" +
      '<div class="rs-sign"><div><strong>Prepared by:</strong><div class="rs-line"></div><span>Name / Signature</span></div>' +
      '<div><strong>Head of Academics:</strong><div class="rs-line"></div><span>Signature</span></div></div></div>';
  }

  var fitCss = "@page{size:A4 portrait;margin:10mm}html,body{margin:0;padding:0}#fit{width:718px}";
  // Scales the page down so the whole statement fits on one sheet of paper.
  var fitJs = "function fit(){var f=document.getElementById('fit');f.style.zoom=1;var z=Math.min(1,718/Math.max(f.scrollWidth,718),1040/f.scrollHeight);f.style.zoom=z;}";

  function printDoc(html) {
    var win = window.open("", "_blank");
    if (!win) {
      window.alert("Allow pop-ups for this site to print the statement.");
      return;
    }
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Statement of Results</title><style>body{font-size:13px}' +
      css + ".rs-doc{border:0;padding:0}" + fitCss + "</style></head><body><div id=\"fit\">" + html + "</div><script>" + fitJs + "<\/script></body></html>");
    win.document.close();
    win.focus();
    win.onload = function () { win.fit(); win.print(); };
    
  }

  async function render(client, container) {
    if (!container) return;
    ensureStyles();
    var results = await Promise.all([
      client.rpc("student_list_my_transcript_entries"),
      client.rpc("student_get_my_transcript_profile")
    ]);
    var entriesResult = results[0];
    var profileResult = results[1];
    if (entriesResult.error || profileResult.error) {
      container.innerHTML = '<p class="student-empty-note">Your results could not be loaded. Please try again later.</p>';
      return;
    }
    var entries = entriesResult.data || [];
    if (!entries.length) {
      container.innerHTML = '<p class="student-empty-note">No transcript records are available yet. Your statement will appear here once your school uploads your transcript.</p>';
      return;
    }
    var profile = profileResult.data || {};
    var terms = groupTerms(entries);

    var html = documentHtml(profile, terms);
    container.innerHTML = html + '<div class="rs-actions"><button class="btn btn-primary" type="button" id="student-results-print">Print Statement</button></div>';
    document.getElementById("student-results-print").addEventListener("click", function () { printDoc(html); });
  }

  window.AfastechResults = { render: render };
})();
