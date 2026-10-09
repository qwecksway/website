(function () {
  "use strict";

  var SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  var client = null;
  var parsedRows = [];
  var sheetLoader = null;

  function el(id) { return document.getElementById(id); }

  function setStatus(message, kind) {
    var box = el("admin-batch-status");
    box.textContent = message || "";
    box.className = message ? "alert show alert-" + (kind === "error" ? "error" : "success") : "alert";
  }

  function fillSelect(select, items, placeholder, labelOf) {
    var previous = select.value;
    select.replaceChildren();
    var first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    items.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.id;
      option.textContent = labelOf(item);
      select.appendChild(option);
    });
    if (previous) select.value = previous;
  }

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetLoader) return sheetLoader;
    sheetLoader = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = SHEETJS_URL;
      script.onload = function () { resolve(window.XLSX); };
      script.onerror = function () { sheetLoader = null; reject(new Error("The Excel reader could not be loaded. Check your connection or save the sheet as CSV.")); };
      document.head.appendChild(script);
    });
    return sheetLoader;
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var value = "";
    var quoted = false;
    text = text.replace(/^\uFEFF/, "");
    var delimiter = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else value += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(value.trim()); value = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(value.trim());
        rows.push(row);
        row = [];
        value = "";
      } else value += ch;
    }
    if (value !== "" || row.length) { row.push(value.trim()); rows.push(row); }
    return rows;
  }

  async function readSheet(file) {
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      return parseCsv(await file.text());
    }
    var XLSX = await loadSheetJs();
    var workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  }

  function norm(value) { return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  function extractRows(grid) {
    var refAliases = ["cassrefid", "refid", "referenceid", "indexnumber", "indexno", "index", "studentid", "studentrefid"];
    var headerAt = -1;
    var refCol = -1;
    for (var r = 0; r < Math.min(grid.length, 15) && headerAt < 0; r += 1) {
      for (var c = 0; c < grid[r].length; c += 1) {
        if (refAliases.indexOf(norm(grid[r][c])) >= 0) { headerAt = r; refCol = c; break; }
      }
    }
    if (headerAt < 0) throw new Error("No CassRefID column found. The sheet needs a heading such as CassRefID, RefID or Index Number.");
    var headers = grid[headerAt].map(norm);
    var scoreCol = -1;
    ["score", "mark", "marks", "total"].some(function (name) {
      for (var i = 0; i < headers.length; i += 1) {
        if (headers[i].indexOf(name) >= 0 && i !== refCol) { scoreCol = i; return true; }
      }
      return false;
    });
    if (scoreCol < 0) scoreCol = headers.length - 1;
    if (scoreCol === refCol) throw new Error("No score column found. Add a column headed Score.");

    var rows = [];
    for (var i = headerAt + 1; i < grid.length; i += 1) {
      var ref = String(grid[i][refCol] == null ? "" : grid[i][refCol]).trim();
      var score = String(grid[i][scoreCol] == null ? "" : grid[i][scoreCol]).trim();
      if (!ref && !score) continue;
      rows.push({ ref: ref, score: score });
    }
    if (!rows.length) throw new Error("The sheet has no score rows below the heading.");
    return rows;
  }

  function args(commit) {
    return {
      target_subject_id: el("admin-batch-subject").value,
      target_assessment_type_id: el("admin-batch-type").value,
      target_max_score: parseFloat(el("admin-batch-max").value),
      target_rows: parsedRows,
      commit_changes: commit
    };
  }

  function renderPreview(result) {
    var body = el("admin-batch-results-list");
    body.replaceChildren();
    (result.rows || []).forEach(function (row) {
      var tr = document.createElement("tr");
      [row.ref, row.name || "—", row.score, row.status === "ok" ? "Ready" + (row.class ? " · " + row.class : "") : row.status].forEach(function (text, index) {
        var td = document.createElement("td");
        td.textContent = text;
        if (index === 3) td.style.color = row.status === "ok" ? "#1b6e2d" : "#b00020";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    el("admin-batch-summary").textContent = result.subject + " · " + result.assessment + " — " +
      result.year + ", " + result.term + ". " + result.saved + " row(s) ready, " + result.problems + " with problems (skipped).";
    el("admin-batch-apply").disabled = !result.saved;
    el("admin-batch-preview").hidden = false;
  }

  function reset() {
    parsedRows = [];
    el("admin-batch-results-list").replaceChildren();
    el("admin-batch-preview").hidden = true;
    el("admin-batch-file").value = "";
    el("admin-batch-apply").disabled = true;
  }

  function bind() {
    var form = el("admin-batch-results-form");
    if (!form || form.dataset.batchBound) return;
    form.dataset.batchBound = "true";

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      var file = el("admin-batch-file").files[0];
      if (!file) { setStatus("Choose a score sheet first.", "error"); return; }
      if (file.size > 10000000) { setStatus("The file must be smaller than 10 MB.", "error"); return; }
      button.disabled = true;
      setStatus("Reading the file…", "success");
      try {
        parsedRows = extractRows(await readSheet(file));
        var preview = await client.rpc("admin_import_scores", args(false));
        if (preview.error) throw preview.error;
        renderPreview(preview.data);
        setStatus("", "success");
      } catch (error) {
        el("admin-batch-preview").hidden = true;
        setStatus(error.message || "The file could not be read.", "error");
      } finally {
        button.disabled = false;
      }
    });

    el("admin-batch-clear").addEventListener("click", function () { reset(); setStatus("", "success"); });

    el("admin-batch-apply").addEventListener("click", async function () {
      var button = this;
      button.disabled = true;
      setStatus("Saving and publishing…", "success");
      try {
        var saved = await client.rpc("admin_import_scores", args(true));
        if (saved.error) throw saved.error;
        var data = saved.data;
        setStatus(data.saved + " score(s) published for " + data.subject + " (" + data.assessment + "). " +
          (data.problems ? data.problems + " row(s) were skipped." : ""), "success");
        reset();
      } catch (error) {
        button.disabled = false;
        setStatus("Could not save: " + (error.message || "unknown error"), "error");
      }
    });
  }

  // Keeps the dropdown in step with the Assessment types menu (active types only).
  async function refreshTypes() {
    var select = el("admin-batch-type");
    if (!select || !client) return;
    var result = await client.rpc("list_active_assessment_types");
    if (!result.error && result.data) {
      fillSelect(select, result.data, "Choose an assessment type", function (t) { return t.name; });
    }
  }

  window.initializeBatchResultImporter = function (supabaseClient, data) {
    client = supabaseClient;
    if (!el("admin-batch-subject")) return;
    data = data || {};
    fillSelect(el("admin-batch-subject"), data.subjects || [], "Choose a subject", function (s) { return s.name; });
    fillSelect(el("admin-batch-type"), data.assessment_types || [], "Choose an assessment type", function (t) { return t.name; });
    bind();
    refreshTypes();
    el("admin-batch-type").addEventListener("focus", refreshTypes);
  };
})();
