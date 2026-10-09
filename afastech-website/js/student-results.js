(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function num(value) {
    var n = Number(value);
    return (Math.round(n * 100) / 100).toString();
  }

  function ensureStyles() {
    if (document.getElementById("student-results-styles")) return;
    var style = document.createElement("style");
    style.id = "student-results-styles";
    style.textContent =
      ".res-card{background:#fff;border:1px solid #dfe5eb;border-radius:12px;margin-bottom:1.25rem;overflow:hidden}" +
      ".res-head{display:flex;justify-content:space-between;align-items:center;padding:.9rem 1.1rem;border-bottom:1px solid #dfe5eb;background:#f8fafc}" +
      ".res-head h3{margin:0;font-size:1rem;color:#1f4068}" +
      ".res-badge{background:#e3ebf6;color:#1f4068;border-radius:999px;padding:.25rem .7rem;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}" +
      ".res-wrap{overflow-x:auto}.res-table{width:100%;border-collapse:collapse;font-size:.88rem}" +
      ".res-table th{background:#f3f6fa;color:#5b6b7c;font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;padding:.6rem .7rem;text-align:center;white-space:nowrap}" +
      ".res-table th.left,.res-table td.left{text-align:left}.res-table td{padding:.65rem .7rem;border-top:1px solid #edf0f4;text-align:center}" +
      ".res-pill{display:inline-block;min-width:2.2rem;padding:.15rem .55rem;border-radius:6px;background:#5f6b76;color:#fff;font-weight:700;font-size:.8rem}" +
      ".res-pill.ok{background:#1f6f43}.res-pill.fail{background:#b00020}" +
      ".res-foot{display:flex;gap:.6rem;padding:.7rem 1.1rem;background:#f3f6fa;border-top:1px solid #dfe5eb}" +
      ".res-chip{background:#fff;border:1px solid #dfe5eb;border-radius:8px;padding:.3rem .7rem;font-size:.85rem}" +
      ".res-summary div{display:flex;justify-content:space-between;padding:.75rem 1.1rem;border-top:1px solid #dfe5eb;font-weight:600}";
    document.head.appendChild(style);
  }

  function pillClass(subject) {
    if (!subject.complete) return "res-pill";
    return Number(subject.grade_point) === 0 ? "res-pill fail" : "res-pill ok";
  }

  function termCard(report, term) {
    var types = report.types || [];
    var head = '<th class="left">Subject</th>' + types.map(function (t) { return "<th>" + esc(t.name) + "</th>"; }).join("") +
      "<th>Total</th><th>Grade</th><th>Grade point</th><th class=\"left\">Description</th>";
    var rows = (term.subjects || []).map(function (s) {
      var cells = (s.cells || []).map(function (cell) {
        if (cell.score == null) return '<td><span class="res-pill">IC</span></td>';
        var text = num(cell.score) + (Number(cell.max) !== 100 ? " / " + num(cell.max) : "");
        return "<td>" + esc(text) + "</td>";
      }).join("");
      return '<tr><td class="left">' + esc(s.name) + "</td>" + cells +
        "<td>" + (s.total == null ? "—" : esc(num(s.total))) + "</td>" +
        '<td><span class="' + pillClass(s) + '">' + esc(s.grade) + "</span></td>" +
        "<td>" + esc(num(s.grade_point)) + '</td><td class="left">' + esc(s.description) + "</td></tr>";
    }).join("");
    if (!rows) rows = '<tr><td class="left" colspan="' + (types.length + 5) + '">No subjects have been set up for your class yet.</td></tr>';
    return '<div class="res-card"><div class="res-head"><h3>' + esc(term.year) + " Academic Year" +
      (term.class_name ? " · " + esc(String(term.class_name).replace(/^SHS\s*/i, "Year ")) : "") + "</h3>" +
      '<span class="res-badge">' + esc(term.term) + "</span></div>" +
      '<div class="res-wrap"><table class="res-table"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<div class="res-foot"><span class="res-chip">GPA <strong>' + esc(num(term.gpa)) + "</strong></span>" +
      '<span class="res-chip">Incompletes <strong>' + esc(term.ic_count) + "</strong></span></div></div>";
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
    var latest = report.terms[report.terms.length - 1];
    container.innerHTML = report.terms.slice().reverse().map(function (t) { return termCard(report, t); }).join("") +
      '<div class="res-card"><div class="res-head"><h3>Academic Summary</h3></div><div class="res-summary">' +
      "<div><span>Number of Incompletes (ICs)</span><span>" + esc(report.ic_total) + "</span></div>" +
      "<div><span>Number of Fails (Es)</span><span>" + esc(report.fail_total) + "</span></div>" +
      "<div><span>Latest semester GPA (" + esc(latest.term) + ")</span><span>" + esc(num(latest.gpa)) + "</span></div>" +
      "<div><span>CGPA</span><span>" + esc(num(report.cgpa)) + "</span></div></div></div>";
  }

  window.AfastechResults = { render: render };
})();
