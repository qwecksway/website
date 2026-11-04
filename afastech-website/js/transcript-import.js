(function () {
  "use strict";

  var client = null;
  var students = [];
  var objectUrl = null;
  var reviewRecords = [];

  function setStatus(message, type) {
    var status = document.getElementById("admin-transcript-status");
    if (!status) return;
    status.textContent = message || "";
    status.className = "alert" + (type ? " alert-" + type : "");
  }

  function setSelectOptions(select, items, placeholder, valueKey, labelBuilder) {
    if (!select) return;
    select.replaceChildren();
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    (items || []).forEach(function (item) {
      var option = document.createElement("option");
      option.value = item[valueKey];
      option.textContent = labelBuilder(item);
      select.appendChild(option);
    });
  }

  function normalizeCell(value) {
    var normalized = String(value || "").replace(/\s+/g, " ").trim();
    return /^(?:-|—|–|n\/?a|na)$/i.test(normalized) ? "" : normalized;
  }

  function groupPageLines(items) {
    var positioned = items
      .filter(function (item) { return typeof item.str === "string" && item.str.trim(); })
      .map(function (item) {
        return {
          x: item.transform[4],
          y: item.transform[5],
          text: item.str.trim()
        };
      })
      .sort(function (left, right) {
        return right.y - left.y || left.x - right.x;
      });
    var lines = [];
    positioned.forEach(function (item) {
      var line = lines[lines.length - 1];
      if (!line || Math.abs(line.y - item.y) > 2.5) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    });
    lines.forEach(function (line) {
      line.items.sort(function (left, right) { return left.x - right.x; });
      line.text = line.items.map(function (item) { return item.text; }).join(" ");
    });
    return lines;
  }

  function getColumnIndex(x, pageWidth) {
    var position = x / pageWidth;
    if (position < 0.30) return 0;
    if (position < 0.48) return 1;
    if (position < 0.65) return 2;
    if (position < 0.82) return 3;
    return 4;
  }

  function collectTableCells(line, pageWidth) {
    var columns = ["", "", "", "", ""];
    line.items.forEach(function (item) {
      var column = getColumnIndex(item.x, pageWidth);
      columns[column] = [columns[column], item.text].filter(Boolean).join(" ").trim();
    });
    return columns;
  }

  function looksLikeUnmappedTableRow(line, pageWidth) {
    if (line.items.length < 4) return false;
    var firstPosition = line.items[0].x / pageWidth;
    var lastPosition = line.items[line.items.length - 1].x / pageWidth;
    return firstPosition > 0.04 && firstPosition < 0.25 &&
      lastPosition > 0.65 && lastPosition < 0.98 &&
      !/course title|final grade|semester|gpa|academic record|official transcript/i.test(line.text);
  }

  function fixOcrGpa(value) {
    if (/^\d{2}$/.test(value) && Number(value) <= 40) return value.charAt(0) + '.' + value.charAt(1);
    return value;
  }

  function parseTranscriptPage(lines, pageWidth, inheritedYear, inheritedTableState, pageNumber, usedOcr) {
    var yearLevel = inheritedYear || 1;
    var entries = [];
    var manualEntries = [];
    var inTable = Boolean(inheritedTableState);

    lines.forEach(function (line) {
      var yearHeading = line.text.match(/\byear\s*([1-3])\s+academic\s+record\b/i);
      if (yearHeading) {
        yearLevel = Number(yearHeading[1]);
        inTable = true;
        return;
      }
      if (/course title/i.test(line.text)) {
        inTable = true;
        return;
      }
      if (!inTable) return;

      var columns = collectTableCells(line, pageWidth);
      var subject = normalizeCell(columns[0]);
      var sem1Gpa = normalizeCell(columns[1]);
      var sem2Gpa = normalizeCell(columns[3]);
      if (usedOcr) {
        sem1Gpa = fixOcrGpa(sem1Gpa);
        sem2Gpa = fixOcrGpa(sem2Gpa);
      }
      var sem1Grade = normalizeCell(columns[2]);
      var sem2Grade = normalizeCell(columns[4]);
      var hasSemesterData = sem1Gpa || sem1Grade || sem2Gpa || sem2Grade;
      var populatedColumns = columns.filter(Boolean).length;

      if (subject && hasSemesterData && populatedColumns === 5) {
        var semesterOne = {
          year_level: yearLevel,
          semester_no: 1,
          subject_name: subject,
          grade_point_average: /^\d{1,6}(?:\.\d{1,3})?$/.test(sem1Gpa) ? sem1Gpa : "",
          final_grade: sem1Grade,
          source_page: pageNumber
        };
        var semesterTwo = {
          year_level: yearLevel,
          semester_no: 2,
          subject_name: subject,
          grade_point_average: /^\d{1,6}(?:\.\d{1,3})?$/.test(sem2Gpa) ? sem2Gpa : "",
          final_grade: sem2Grade,
          source_page: pageNumber
        };
        [semesterOne, semesterTwo].forEach(function (entry) {
          var hasGpa = entry.grade_point_average && Number(entry.grade_point_average) > 0;
          if (hasGpa || entry.final_grade) entries.push(entry);
        });
        return;
      }

      if (looksLikeUnmappedTableRow(line, pageWidth)) {
        manualEntries.push({
          year_level: "",
          semester_no: "",
          subject_name: "",
          grade_point_average: "",
          final_grade: "",
          source_page: pageNumber
        });
      }
    });

    return {
      yearLevel: yearLevel,
      inTable: inTable,
      entries: entries,
      manualEntries: manualEntries
    };
  }

  var OCR_BASE = "assets/vendor/tesseract-5/";
  var OCR_SCALE = 3;
  var OCR_THRESHOLD = 150;
  var ocrWorkerPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("The local OCR reader could not be loaded.")); };
      document.head.appendChild(script);
    });
  }

  function getOcrWorker() {
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = (async function () {
        if (!window.Tesseract) await loadScript(OCR_BASE + "tesseract.min.js");
        var base = new URL(OCR_BASE, document.baseURI).href;
        return window.Tesseract.createWorker("eng", 1, {
          workerPath: base + "worker.min.js",
          corePath: base,
          langPath: base + "lang",
          workerBlobURL: false,
          gzip: true
        });
      })();
      ocrWorkerPromise.catch(function () { ocrWorkerPromise = null; });
    }
    return ocrWorkerPromise;
  }

  async function terminateOcrWorker() {
    if (!ocrWorkerPromise) return;
    var pending = ocrWorkerPromise;
    ocrWorkerPromise = null;
    try { (await pending).terminate(); } catch (error) { /* worker never started */ }
  }

  function eraseRules(dark, width, height, minRun) {
    var toClear = [];
    var y;
    var x;
    var start;
    for (y = 0; y < height; y += 1) {
      start = -1;
      for (x = 0; x <= width; x += 1) {
        var on = x < width && dark[y * width + x];
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          if (x - start >= minRun) toClear.push([y * width + start, 1, x - start]);
          start = -1;
        }
      }
    }
    for (x = 0; x < width; x += 1) {
      start = -1;
      for (y = 0; y <= height; y += 1) {
        var live = y < height && dark[y * width + x];
        if (live && start < 0) start = y;
        if (!live && start >= 0) {
          if (y - start >= minRun) toClear.push([start * width + x, width, y - start]);
          start = -1;
        }
      }
    }
    toClear.forEach(function (run) {
      for (var step = 0; step < run[2]; step += 1) dark[run[0] + step * run[1]] = 0;
    });
  }
  // Scanned or print-to-PDF pages have no text layer, so the page is read with local OCR.
  async function ocrPageItems(page) {
    var viewport = page.getViewport({ scale: OCR_SCALE });
    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    var context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: viewport }).promise;
    // Drop the pale watermark and shading, then erase long table rules that confuse OCR layout analysis.
    var width = canvas.width;
    var pixels = context.getImageData(0, 0, width, canvas.height);
    var data = pixels.data;
    var dark = new Uint8Array(width * canvas.height);
    for (var pixel = 0; pixel < dark.length; pixel += 1) {
      var at = pixel * 4;
      dark[pixel] = (data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114) < OCR_THRESHOLD ? 1 : 0;
    }
    eraseRules(dark, width, canvas.height, OCR_SCALE * 25);
    for (var index = 0; index < dark.length; index += 1) {
      var target = index * 4;
      var shade = dark[index] ? 0 : 255;
      data[target] = data[target + 1] = data[target + 2] = shade;
    }
    context.putImageData(pixels, 0, 0);    var worker = await getOcrWorker();
    var result = await worker.recognize(canvas);
    var height = canvas.height;
    canvas.width = 0;
    canvas.height = 0;
    return (result.data.words || [])
      .filter(function (word) { return word.text && word.text.trim() && word.confidence > 20; })
      .map(function (word) {
        return {
          str: word.text,
          transform: [1, 0, 0, 1, word.bbox.x0 / OCR_SCALE, (height - (word.bbox.y0 + word.bbox.y1) / 2) / OCR_SCALE]
        };
      });
  }
  function parseDateOfBirth(text) {
    var iso = text.match(/(\d{4})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})/);
    var year;
    var month;
    var day;
    if (iso) {
      year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
    } else {
      var local = text.match(/(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{4})/);
      if (!local) return "";
      day = Number(local[1]); month = Number(local[2]); year = Number(local[3]);
    }
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  // The student block sits in the right-hand side of the first page of each transcript.
  function parseHeader(items, pageWidth) {
    var right = items
      .filter(function (item) {
        if (typeof item.str !== "string" || !item.str.trim()) return false;
        var position = item.transform[4] / pageWidth;
        return position >= 0.55 && position < 0.84;
      })
      .map(function (item) {
        return { x: item.transform[4], y: item.transform[5], text: item.str.trim() };
      })
      .sort(function (left, right) { return right.y - left.y || left.x - right.x; });
    var rows = [];
    right.forEach(function (item) {
      var row = rows[rows.length - 1];
      if (!row || Math.abs(row.y - item.y) > 6) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    });
    var texts = rows.map(function (row) {
      return row.items.sort(function (a, b) { return a.x - b.x; })
        .map(function (item) { return item.text; }).join(" ");
    });
    var header = { full_name: "", study_area: "", date_of_birth: "", year_of_admission: "", ref_id: "" };
    var labelled = /study\s*area|birth|admission|ref\s*id/i;
    texts.forEach(function (text) {
      var match;
      if (/study\s*area/i.test(text)) {
        match = text.match(/area\s*:?\s*(.+)$/i);
        if (match) header.study_area = match[1].replace(/[^A-Za-z0-9 &'\/-]/g, "").trim();
      } else if (/birth/i.test(text)) {
        header.date_of_birth = parseDateOfBirth(text);
      } else if (/admission/i.test(text)) {
        match = text.match(/(\d{4})\s*$/);
        if (match) header.year_of_admission = match[1];
      } else if (/\bref\b|ref\s*id/i.test(text)) {
        match = text.match(/id\s*:?\s*([A-Za-z0-9]{5,})/i) || text.match(/([0-9]{6,})/);
        if (match) header.ref_id = match[1].toUpperCase();
      } else if (!header.full_name && !labelled.test(text) && /[A-Za-z]{2}/.test(text)) {
        header.full_name = text.replace(/[^A-Za-z .'-]/g, "").replace(/\s+/g, " ").trim();
      }
    });
    return header;
  }

  function findSummary(lines) {
    var found = null;
    lines.forEach(function (line) {
      var match = line.text.match(/cumulative\s*gpa\s*:?\s*([\d.]+)\D{0,6}credits\s*earned\s*:?\s*([\d.]+)/i);
      if (match) found = { cumulative_gpa: match[1].replace(/\.$/, ""), credits_earned: match[2].replace(/\.$/, "") };
    });
    return found;
  }
  async function parsePdf(file) {
    if (!window.pdfjsLib) {
      throw new Error("The local PDF reader did not load. Check the connection and reload the Admin portal.");
    }
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "assets/vendor/pdfjs-4.10.38/pdf.worker.min.mjs";
    }
    var bytes = new Uint8Array(await file.arrayBuffer());
    var loadingTask = window.pdfjsLib.getDocument({ data: bytes.slice() });
    var pdf;
    try {
      pdf = await loadingTask.promise;
      if (pdf.numPages > 150) {
        throw new Error("This PDF has more than 150 pages. Split it into smaller files and try again.");
      }

      var records = [];
      var current = null;
      for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        var page = await pdf.getPage(pageNumber);
        var viewport = page.getViewport({ scale: 1 });
        var content = await page.getTextContent();
        var pageItems = content.items;
        var usedOcr = false;
        if (pageItems.filter(function (item) { return item.str && item.str.trim(); }).length < 10) {
          pageItems = await ocrPageItems(page);
          usedOcr = true;
        }
        var lines = groupPageLines(pageItems);
        var isTranscriptStart = lines.some(function (line) {
          return /official transcript/i.test(line.text);
        });

        if (isTranscriptStart) {
          current = {
            header: parseHeader(pageItems, viewport.width),
            summary: null,
            ocr: false,
            pages: [],
            entries: [],
            manualEntries: [],
            lastYearLevel: 1,
            inTable: false
          };
          records.push(current);
        }
        if (!current) continue;

        current.pages.push(pageNumber);
        var parsedPage = parseTranscriptPage(
          lines,
          viewport.width,
          current.lastYearLevel,
          current.inTable,
          pageNumber,
          usedOcr
        );
        if (usedOcr) current.ocr = true;
        var summary = findSummary(lines);
        if (summary) current.summary = summary;
        current.entries = current.entries.concat(parsedPage.entries);
        current.manualEntries = current.manualEntries.concat(parsedPage.manualEntries);
        current.lastYearLevel = parsedPage.yearLevel;
        current.inTable = parsedPage.inTable;
      }

      if (!records.length) {
        throw new Error("No official transcript sections were detected. This PDF may be scanned or use a different transcript layout.");
      }
      if (records.length > 50) {
        throw new Error("More than 50 transcript sections were detected. Split the PDF into smaller files and try again.");
      }
      records.forEach(function (record) {
        record.entries = record.entries.concat(record.manualEntries);
      });
      return records;
    } finally {
      bytes = null;
      if (pdf) await pdf.destroy();
      else await loadingTask.destroy();
    }
  }

  window.AfastechTranscriptParser = { parsePdf: parsePdf };

  function createSelect(label, options, selectedValue) {
    var select = document.createElement("select");
    select.setAttribute("aria-label", label);
    select.required = true;
    options.forEach(function (option) {
      var element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      if (option.value === String(selectedValue)) element.selected = true;
      select.appendChild(element);
    });
    return select;
  }

  function addCell(row, control) {
    var cell = document.createElement("td");
    cell.appendChild(control);
    row.appendChild(cell);
  }

  function makeTranscriptRow(record, entry) {
    var row = document.createElement("tr");
    row.dataset.sourcePage = String(entry.source_page);
    addCell(row, createSelect("Year level, PDF page " + entry.source_page, [
      { value: "", label: "Select year" },
      { value: "1", label: "Year 1" },
      { value: "2", label: "Year 2" },
      { value: "3", label: "Year 3" }
    ], String(entry.year_level)));
    addCell(row, createSelect("Semester, PDF page " + entry.source_page, [
      { value: "", label: "Select semester" },
      { value: "1", label: "Semester 1" },
      { value: "2", label: "Semester 2" }
    ], String(entry.semester_no)));

    var subject = document.createElement("input");
    subject.type = "text";
    subject.maxLength = 120;
    subject.required = true;
    subject.value = entry.subject_name;
    subject.setAttribute("aria-label", "Subject name, PDF page " + entry.source_page);
    addCell(row, subject);

    var gpa = document.createElement("input");
    gpa.type = "text";
    gpa.inputMode = "decimal";
    gpa.maxLength = 10;
    gpa.value = entry.grade_point_average;
    gpa.pattern = "[0-9]{1,6}(\\.[0-9]{1,3})?";
    gpa.title = "Enter the GPA as printed, or leave it blank.";
    gpa.setAttribute("aria-label", "GPA, PDF page " + entry.source_page);
    addCell(row, gpa);

    var grade = document.createElement("input");
    grade.type = "text";
    grade.maxLength = 24;
    grade.value = entry.final_grade;
    grade.setAttribute("aria-label", "Final grade, PDF page " + entry.source_page);
    addCell(row, grade);

    var page = document.createElement("span");
    page.textContent = String(entry.source_page);
    addCell(row, page);

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-outline transcript-row-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove row from PDF page " + entry.source_page);
    remove.addEventListener("click", function () { row.remove(); });
    addCell(row, remove);
    record.tableBody.appendChild(row);
    return row;
  }

  function normalizeRef(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function nameTokens(value) {
    return String(value || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  }

  function nameSimilarity(left, right) {
    var a = nameTokens(left);
    var b = nameTokens(right);
    if (!a.length || !b.length) return 0;
    var shared = a.filter(function (token) { return b.indexOf(token) >= 0; }).length;
    return shared / Math.max(a.length, b.length);
  }

  // Ref ID is the primary key; the printed name only confirms or (as a fallback) suggests a match.
  function autoMatchStudent(header) {
    var ref = normalizeRef(header.ref_id);
    if (ref) {
      var byRef = students.filter(function (student) { return normalizeRef(student.index_number) === ref; });
      if (byRef.length === 1) {
        var similarity = nameSimilarity(header.full_name, byRef[0].full_name);
        return similarity >= 0.5
          ? { studentId: byRef[0].id, kind: "ok", note: "Matched by Ref ID and name." }
          : { studentId: byRef[0].id, kind: "warn", note: "Ref ID matches " + byRef[0].full_name + " but the printed name differs. Confirm before applying." };
      }
    }
    var byName = students.filter(function (student) { return nameSimilarity(header.full_name, student.full_name) === 1; });
    if (byName.length === 1) {
      return { studentId: byName[0].id, kind: "warn", note: "Matched by name only (Ref ID " + (ref ? "not found" : "not read") + "). Confirm before applying." };
    }
    return { studentId: "", kind: "error", note: "No student matched. Choose the student manually or skip." };
  }

  function recordLabel(record) {
    return (record.header.full_name || "Unnamed student") +
      (record.header.ref_id ? " · " + record.header.ref_id : "");
  }

  function readRecordEntries(record) {
    var rows = Array.prototype.slice.call(record.tableBody.querySelectorAll("tr"));
    var entries = [];
    rows.forEach(function (row) {
      var controls = row.querySelectorAll("select, input");
      var entry = {
        year_level: controls[0].value,
        semester_no: controls[1].value,
        subject_name: controls[2].value.trim(),
        grade_point_average: controls[3].value.trim(),
        final_grade: controls[4].value.trim()
      };
      if (!entry.subject_name || (!entry.grade_point_average && !entry.final_grade)) {
        throw new Error("Complete or remove every blank transcript row before applying.");
      }
      if (entry.grade_point_average && !/^\d{1,6}(?:\.\d{1,3})?$/.test(entry.grade_point_average)) {
        throw new Error("Enter each GPA as a number with up to three decimal places.");
      }
      entries.push(entry);
    });
    if (!entries.length) throw new Error("Each transcript needs at least one completed subject row.");
    return entries;
  }

  function buildPayload(record, apply) {
    var header = record.header;
    return {
      target_student_id: record.studentSelect.value,
      target_entries: readRecordEntries(record),
      target_profile: {
        date_of_birth: header.date_of_birth,
        year_of_admission: header.year_of_admission,
        study_area: header.study_area
      },
      target_summary: record.summary || {},
      apply_changes: apply
    };
  }

  var PROFILE_LABELS = { date_of_birth: "date of birth", year_of_admission: "year of admission", study_area: "study area" };

  function describeResult(result) {
    if (!result) return "";
    var parts = [];
    if (result.added) parts.push(result.added + " new");
    if (result.updated) parts.push(result.updated + " updated");
    if (result.unchanged) parts.push(result.unchanged + " already on file");
    if (result.profile_filled && result.profile_filled.length) {
      parts.push("fills " + result.profile_filled.map(function (key) { return PROFILE_LABELS[key] || key; }).join(", "));
    }
    if (result.profile_conflicts && result.profile_conflicts.length) {
      parts.push("differs from profile: " + result.profile_conflicts.map(function (key) { return PROFILE_LABELS[key] || key; }).join(", ") + " (kept)");
    }
    if (result.summary_updated) parts.push("cumulative summary updated");
    return parts.join(" · ");
  }

  function setBadge(record, label, tone, detail) {
    record.badge.textContent = label;
    record.badge.className = "transcript-badge transcript-badge-" + tone;
    record.detail.textContent = detail || "";
  }

  async function previewRecord(record) {
    var token = (record.previewToken || 0) + 1;
    record.previewToken = token;
    record.result = null;
    if (!record.studentSelect.value || record.studentSelect.value === "skip") {
      setBadge(record, record.studentSelect.value === "skip" ? "Skipped" : "Needs student", "muted", "");
      updateApplyState();
      return;
    }
    var payload;
    try {
      payload = buildPayload(record, false);
    } catch (error) {
      setBadge(record, "Check rows", "warn", error.message);
      updateApplyState();
      return;
    }
    setBadge(record, "Checking…", "muted", "");
    var response;
    try {
      response = await client.rpc("admin_apply_student_transcript", payload);
    } catch (error) {
      response = { error: error };
    }
    if (record.previewToken !== token) return;
    if (response.error) {
      setBadge(record, "Error", "error", response.error.message);
    } else {
      record.result = response.data;
      var labels = { "new": "New", updated: "Updated", unchanged: "No new information" };
      setBadge(record, labels[response.data.status] || response.data.status,
        response.data.status === "unchanged" ? "muted" : "ok", describeResult(response.data));
    }
    updateApplyState();
  }

  function updateApplyState() {
    var button = document.getElementById("admin-transcript-save-drafts");
    var confirm = document.getElementById("admin-transcript-confirm");
    var pending = reviewRecords.some(function (record) {
      var value = record.studentSelect.value;
      return !value || (value !== "skip" && !record.result);
    });
    var actionable = reviewRecords.some(function (record) {
      return record.result && record.result.status !== "unchanged";
    });
    button.disabled = !reviewRecords.length || pending || !actionable || !(confirm && confirm.checked);
  }

  function buildRecordCard(record, index) {
    var card = document.createElement("article");
    card.className = "transcript-record-review";
    var heading = document.createElement("h3");
    heading.textContent = recordLabel(record);
    card.appendChild(heading);

    var meta = document.createElement("p");
    meta.className = "transcript-review-note";
    meta.textContent = [
      record.fileName + " · page(s) " + record.pages.join(", "),
      record.header.date_of_birth ? "DOB " + record.header.date_of_birth : "",
      record.header.year_of_admission ? "Admitted " + record.header.year_of_admission : "",
      record.header.study_area || "",
      record.summary ? "CGPA " + record.summary.cumulative_gpa + " · " + record.summary.credits_earned + " credits" : ""
    ].filter(Boolean).join(" · ");
    card.appendChild(meta);

    var matchField = document.createElement("div");
    matchField.className = "field";
    var label = document.createElement("label");
    label.textContent = "Student account";
    var select = createSelect("Student for transcript " + (index + 1), [
      { value: "", label: "Choose student" },
      { value: "skip", label: "Skip this transcript" }
    ].concat(students.map(function (student) {
      return {
        value: student.id,
        label: (student.full_name || "Student") +
          (student.index_number ? " — " + student.index_number : "")
      };
    })), record.match.studentId);
    label.appendChild(select);
    matchField.appendChild(label);
    card.appendChild(matchField);

    var matchNote = document.createElement("p");
    matchNote.className = "transcript-match-note transcript-match-" + record.match.kind;
    matchNote.textContent = record.match.note;
    card.appendChild(matchNote);

    var status = document.createElement("p");
    status.className = "transcript-record-status";
    var badge = document.createElement("span");
    var detail = document.createElement("span");
    detail.className = "transcript-record-detail";
    status.append(badge, detail);
    card.appendChild(status);

    var details = document.createElement("details");
    details.className = "transcript-saved-review";
    var summary = document.createElement("summary");
    summary.textContent = "Review or correct " + record.entries.length + " extracted rows" +
      (record.ocr ? " (read by OCR — check every grade)" : "");
    details.open = Boolean(record.ocr || record.manualEntries.length);
    details.appendChild(summary);

    var tableWrap = document.createElement("div");
    tableWrap.className = "student-table-wrap transcript-review-table-wrap";
    var table = document.createElement("table");
    table.className = "student-data-table transcript-review-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Year", "Semester", "Subject", "GPA", "Final grade", "PDF page", "Row"].forEach(function (text) {
      var th = document.createElement("th");
      th.textContent = text;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    var body = document.createElement("tbody");
    table.append(head, body);
    tableWrap.appendChild(table);
    details.appendChild(tableWrap);

    record.studentSelect = select;
    record.card = card;
    record.tableBody = body;
    record.badge = badge;
    record.detail = detail;
    record.manualCount = record.manualEntries.length;
    record.entries.forEach(function (entry) { makeTranscriptRow(record, entry); });

    var addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-outline";
    addButton.textContent = "Add transcript row";
    addButton.addEventListener("click", function () {
      makeTranscriptRow(record, {
        year_level: record.lastYearLevel || 1,
        semester_no: 1,
        subject_name: "",
        grade_point_average: "",
        final_grade: "",
        source_page: record.pages[0]
      });
    });
    details.appendChild(addButton);
    card.appendChild(details);

    var schedule = function () {
      clearTimeout(record.previewTimer);
      record.previewTimer = setTimeout(function () { previewRecord(record); }, 400);
    };
    select.addEventListener("change", schedule);
    body.addEventListener("change", schedule);
    body.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest(".transcript-row-remove")) schedule();
    });
    return card;
  }

  function renderReview(records) {
    var host = document.getElementById("admin-transcript-records");
    host.replaceChildren();
    reviewRecords = records;
    var confirm = document.getElementById("admin-transcript-confirm");
    if (confirm) confirm.checked = false;
    records.forEach(function (record, index) {
      host.appendChild(buildRecordCard(record, index));
    });
    document.getElementById("admin-transcript-review").hidden = false;
    updateApplyState();
    records.forEach(previewRecord);
  }

  async function applyBatch() {
    var button = document.getElementById("admin-transcript-save-drafts");
    var queue = reviewRecords.filter(function (record) {
      return record.result && record.result.status !== "unchanged" && record.studentSelect.value !== "skip";
    });
    var payloads;
    try {
      payloads = queue.map(function (record) { return buildPayload(record, true); });
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }
    button.disabled = true;
    var totals = { added: 0, updated: 0, students: 0, filled: 0 };
    for (var index = 0; index < payloads.length; index += 1) {
      var response;
      try {
        response = await client.rpc("admin_apply_student_transcript", payloads[index]);
      } catch (error) {
        response = { error: error };
      }
      if (response.error) {
        setStatus(
          totals.students + " transcript(s) applied before " + recordLabel(queue[index]) +
          " failed: " + response.error.message,
          "error"
        );
        reviewRecords.forEach(previewRecord);
        try { await loadSavedTranscripts(); } catch (refreshError) { /* list refresh is best effort here */ }
        return;
      }
      totals.students += 1;
      totals.added += response.data.added || 0;
      totals.updated += response.data.updated || 0;
      totals.filled += (response.data.profile_filled || []).length;
    }
    var skipped = reviewRecords.length - queue.length;
    setStatus(
      totals.students + " transcript(s) applied: " + totals.added + " new row(s), " +
      totals.updated + " updated row(s), " + totals.filled + " profile detail(s) filled. " +
      skipped + " skipped or already up to date. Students see the update immediately.",
      "success"
    );
    reviewRecords.forEach(previewRecord);
    try {
      await loadSavedTranscripts();
    } catch (error) {
      setStatus("Applied, but the saved-transcript list could not be refreshed. " + error.message, "error");
    }
  }
  function appendTextCell(row, value) {
    var cell = document.createElement("td");
    cell.textContent = value || "—";
    row.appendChild(cell);
  }

  function buildSavedEntryReview(entries) {
    var details = document.createElement("details");
    details.className = "transcript-saved-review";
    var summary = document.createElement("summary");
    summary.textContent = "Review " + entries.length + " transcript rows";
    details.appendChild(summary);

    var tableWrap = document.createElement("div");
    tableWrap.className = "student-table-wrap transcript-review-table-wrap";
    var table = document.createElement("table");
    table.className = "student-data-table transcript-review-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Year", "Semester", "Subject", "GPA", "Final grade"].forEach(function (text) {
      var cell = document.createElement("th");
      cell.textContent = text;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    var body = document.createElement("tbody");
    entries.forEach(function (entry) {
      var row = document.createElement("tr");
      [
        "Year " + entry.year_level,
        "Semester " + entry.semester_no,
        entry.subject_name,
        entry.grade_point_average == null ? "—" : String(entry.grade_point_average),
        entry.final_grade || "—"
      ].forEach(function (value) { appendTextCell(row, value); });
      body.appendChild(row);
    });
    table.append(head, body);
    tableWrap.appendChild(table);
    details.appendChild(tableWrap);
    return details;
  }

  async function loadSavedTranscripts() {
    var body = document.getElementById("admin-transcript-list");
    var result = await client.rpc("admin_list_student_transcripts");
    if (result.error) throw result.error;
    body.replaceChildren();
    if (!result.data || !result.data.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 5;
      emptyCell.textContent = "No transcripts have been imported.";
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      return;
    }
    result.data.forEach(function (transcript) {
      var row = document.createElement("tr");
      appendTextCell(row, transcript.student_name);
      appendTextCell(row, transcript.index_number);
      appendTextCell(row, String(transcript.entry_count));
      appendTextCell(row, transcript.status === "published" ? "Published" : "Private draft");
      var actionCell = document.createElement("td");
      actionCell.appendChild(buildSavedEntryReview(transcript.entries || []));
      if (transcript.status === "draft") {
        var publish = document.createElement("button");
        publish.type = "button";
        publish.className = "btn btn-primary";
        publish.textContent = "Publish to student";
        publish.addEventListener("click", async function () {
          publish.disabled = true;
          var published;
          try {
            published = await client.rpc("admin_publish_student_transcript", {
              target_transcript_id: transcript.id
            });
          } catch (error) {
            publish.disabled = false;
            setStatus("Transcript could not be published. " + error.message, "error");
            return;
          }
          if (published.error) {
            publish.disabled = false;
            setStatus("Transcript could not be published. " + published.error.message, "error");
            return;
          }
          setStatus("Transcript published to the selected student's account.", "success");
          try {
            await loadSavedTranscripts();
          } catch (error) {
            setStatus("Transcript was published, but the saved-transcript list could not be refreshed. " + error.message, "error");
          }
        });
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-outline transcript-delete-button";
        remove.textContent = "Delete draft";
        remove.addEventListener("click", async function () {
          if (!window.confirm("Delete this private transcript draft?")) return;
          remove.disabled = true;
          var deleted;
          try {
            deleted = await client.rpc("admin_delete_draft_student_transcript", {
              target_transcript_id: transcript.id
            });
          } catch (error) {
            remove.disabled = false;
            setStatus("Transcript draft could not be deleted. " + error.message, "error");
            return;
          }
          if (deleted.error) {
            remove.disabled = false;
            setStatus("Transcript draft could not be deleted. " + deleted.error.message, "error");
            return;
          }
          setStatus("Private transcript draft deleted.", "success");
          try {
            await loadSavedTranscripts();
          } catch (error) {
            setStatus("Draft was deleted, but the saved-transcript list could not be refreshed. " + error.message, "error");
          }
        });
        actionCell.append(publish, remove);
      } else {
        actionCell.appendChild(document.createTextNode("Published"));
      }
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  function closeLocalPreview() {
    var frame = document.getElementById("admin-transcript-pdf-preview");
    frame.hidden = true;
    frame.src = "about:blank";
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function initializeTranscriptImporter(supabaseClient, studentProfiles) {
    var form = document.getElementById("admin-transcript-file-form");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "true";
    client = supabaseClient;
    students = studentProfiles || [];
    loadSavedTranscripts().catch(function (error) {
      setStatus("Saved transcript records could not be loaded. " + error.message, "error");
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var fileInput = document.getElementById("admin-transcript-file");
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) {
        setStatus("Choose one or more PDF transcripts first.", "error");
        return;
      }
      if (files.length > 40) {
        setStatus("Select at most 40 PDF files per batch.", "error");
        return;
      }
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      closeLocalPreview();
      var records = [];
      var failures = [];
      try {
        for (var fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
          var file = files[fileIndex];
          setStatus("Reading " + file.name + " (" + (fileIndex + 1) + " of " + files.length + ") locally. Nothing is uploaded.", "");
          if (file.size > 25000000) {
            failures.push(file.name + ": exceeds the 25 MB limit");
            continue;
          }
          if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
            failures.push(file.name + ": not a PDF");
            continue;
          }
          try {
            var parsed = await parsePdf(file);
            parsed.forEach(function (record) {
              record.fileName = file.name;
              record.match = autoMatchStudent(record.header);
              records.push(record);
            });
          } catch (error) {
            failures.push(file.name + ": " + (error.message || "could not be read"));
          }
        }
        if (!records.length) {
          setStatus("No transcripts could be read. " + failures.join("; "), "error");
          return;
        }
        if (files.length === 1) {
          objectUrl = URL.createObjectURL(files[0]);
          var frame = document.getElementById("admin-transcript-pdf-preview");
          frame.src = objectUrl;
          frame.hidden = false;
        }
        renderReview(records);
        var matched = records.filter(function (record) { return record.match.studentId; }).length;
        setStatus(
          records.length + " transcript(s) read from " + (files.length - failures.length) + " file(s); " +
          matched + " matched to a student automatically." +
          (failures.length ? " Not read: " + failures.join("; ") + "." : ""),
          failures.length ? "error" : "success"
        );
      } finally {
        await terminateOcrWorker();
        button.disabled = false;
      }
    });

    document.getElementById("admin-transcript-save-drafts").addEventListener("click", applyBatch);
    document.getElementById("admin-transcript-confirm").addEventListener("change", updateApplyState);
    document.getElementById("admin-transcript-close-review").addEventListener("click", function () {
      document.getElementById("admin-transcript-review").hidden = true;
      document.getElementById("admin-transcript-records").replaceChildren();
      reviewRecords = [];
      document.getElementById("admin-transcript-file").value = "";
      closeLocalPreview();
      setStatus("Local PDF preview closed and its temporary browser URL revoked.", "success");
    });
  }

  window.initializeTranscriptImporter = initializeTranscriptImporter;
})();