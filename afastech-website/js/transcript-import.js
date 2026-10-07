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

  function parseTranscriptPage(lines, pageWidth, inheritedYear, inheritedTableState, pageNumber) {
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
      var sem1Grade = normalizeCell(columns[2]);
      var sem2Gpa = normalizeCell(columns[3]);
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
        if (semesterOne.grade_point_average || semesterOne.final_grade) entries.push(semesterOne);
        if (semesterTwo.grade_point_average || semesterTwo.final_grade) entries.push(semesterTwo);
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

  async function parsePdf(file) {
    if (!window.pdfjsLib) {
      throw new Error("The local PDF reader did not load. Check the connection and reload the Admin portal.");
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "assets/vendor/pdfjs-4.10.38/pdf.worker.min.mjs";
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
        var lines = groupPageLines(content.items);
        var isTranscriptStart = lines.some(function (line) {
          return /official transcript/i.test(line.text);
        });

        if (isTranscriptStart) {
          current = {
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
          pageNumber
        );
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

  function buildRecordCard(record, index) {
    var card = document.createElement("article");
    card.className = "transcript-record-review";
    var heading = document.createElement("h3");
    heading.textContent = "Transcript " + (index + 1) + " · PDF pages " + record.pages.join(", ");
    card.appendChild(heading);

    var matchField = document.createElement("div");
    matchField.className = "field";
    var label = document.createElement("label");
    label.textContent = "Match this transcript to an existing student account";
    var select = createSelect("Student for transcript " + (index + 1), [
      { value: "", label: "Choose student" }
    ].concat(students.map(function (student) {
      return {
        value: student.id,
        label: (student.full_name || "Student") +
          (student.index_number ? " — " + student.index_number : "")
      };
    })), "");
    label.appendChild(select);
    matchField.appendChild(label);
    card.appendChild(matchField);

    var notice = document.createElement("p");
    notice.className = "transcript-review-note";
    notice.textContent = record.manualEntries.length
      ? record.manualEntries.length + " table row(s) on continuation pages need manual entry. Check the PDF preview and complete or remove those placeholders."
      : "Check every extracted row against the PDF preview before saving.";
    card.appendChild(notice);

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
    card.appendChild(tableWrap);

    record.studentSelect = select;
    record.card = card;
    record.tableBody = body;
    record.manualCount = record.manualEntries.length;
    record.entries.forEach(function (entry) { makeTranscriptRow(record, entry); });

    var actions = document.createElement("div");
    actions.className = "transcript-record-actions";
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
    actions.appendChild(addButton);
    card.appendChild(actions);

    var reviewed = document.createElement("label");
    reviewed.className = "transcript-review-confirm";
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.required = true;
    checkbox.setAttribute("aria-label", "Confirm transcript " + (index + 1) + " was reviewed");
    reviewed.append(checkbox, document.createTextNode(" I checked the full local PDF and reviewed or corrected all transcript rows."));
    card.appendChild(reviewed);
    record.reviewed = checkbox;
    return card;
  }

  function renderReview(records) {
    var host = document.getElementById("admin-transcript-records");
    host.replaceChildren();
    reviewRecords = records;
    records.forEach(function (record, index) {
      host.appendChild(buildRecordCard(record, index));
    });
    document.getElementById("admin-transcript-review").hidden = false;
    document.getElementById("admin-transcript-save-drafts").disabled = !records.length;
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
        throw new Error("Complete or remove every blank transcript row before saving.");
      }
      if (entry.grade_point_average && !/^\d{1,6}(?:\.\d{1,3})?$/.test(entry.grade_point_average)) {
        throw new Error("Enter each GPA as a number with up to three decimal places.");
      }
      entries.push(entry);
    });
    if (!entries.length) throw new Error("Each transcript needs at least one completed subject row.");
    return entries;
  }

  async function saveDrafts() {
    var button = document.getElementById("admin-transcript-save-drafts");
    var studentIds = reviewRecords.map(function (record) { return record.studentSelect.value; });
    if (studentIds.some(function (id) { return !id; })) {
      setStatus("Match every transcript to an existing student account before saving.", "error");
      return;
    }
    if (new Set(studentIds).size !== studentIds.length) {
      setStatus("Each transcript in this PDF must be matched to a different student account.", "error");
      return;
    }
    if (reviewRecords.some(function (record) { return !record.reviewed.checked; })) {
      setStatus("Confirm that you reviewed each complete PDF transcript before saving.", "error");
      return;
    }

    var payloads;
    try {
      payloads = reviewRecords.map(function (record) {
        return { studentId: record.studentSelect.value, entries: readRecordEntries(record) };
      });
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    button.disabled = true;
    var saved = 0;
    for (var index = 0; index < payloads.length; index += 1) {
      var result;
      try {
        result = await client.rpc("admin_stage_student_transcript", {
          target_student_id: payloads[index].studentId,
          target_entries: payloads[index].entries
        });
      } catch (error) {
        setStatus(
          saved
            ? saved + " transcript draft(s) were saved; the next save failed. " + error.message
            : "Transcript draft could not be saved. " + error.message,
          "error"
        );
        button.disabled = false;
        try {
          await loadSavedTranscripts();
        } catch (refreshError) {
          setStatus("Some drafts were saved, but the saved-transcript list could not be refreshed. " + refreshError.message, "error");
        }
        return;
      }
      if (result.error) {
        setStatus(
          saved
            ? saved + " transcript draft(s) were saved; the next one failed. " + result.error.message
            : "Transcript draft could not be saved. " + result.error.message,
          "error"
        );
        button.disabled = false;
        try {
          await loadSavedTranscripts();
        } catch (refreshError) {
          setStatus("Some drafts were saved, but the saved-transcript list could not be refreshed. " + refreshError.message, "error");
        }
        return;
      }
      saved += 1;
    }
    button.disabled = false;
    setStatus(saved + " reviewed transcript draft(s) saved. They remain private until published.", "success");
    try {
      await loadSavedTranscripts();
    } catch (error) {
      setStatus("Transcript drafts were saved, but the saved-transcript list could not be refreshed. " + error.message, "error");
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
      if (transcript.status === "draft") {
        actionCell.appendChild(buildSavedEntryReview(transcript.entries || []));
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
        actionCell.textContent = "Published";
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
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        setStatus("Choose a PDF transcript first.", "error");
        return;
      }
      if (file.size > 25000000) {
        setStatus("This PDF exceeds the 25 MB local processing limit. Split it into smaller files and try again.", "error");
        return;
      }
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        setStatus("Select a PDF file.", "error");
        return;
      }
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      closeLocalPreview();
      setStatus("Reading the PDF locally in this browser. The file is not being uploaded.", "");
      try {
        var records = await parsePdf(file);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(file);
        var frame = document.getElementById("admin-transcript-pdf-preview");
        frame.src = objectUrl;
        frame.hidden = false;
        renderReview(records);
        var extracted = records.reduce(function (count, record) { return count + record.entries.length; }, 0);
        var manual = records.reduce(function (count, record) { return count + record.manualCount; }, 0);
        setStatus(
          records.length + " transcript section(s) found; " + extracted +
          " semester row(s) extracted; " + manual +
          " row(s) need manual completion. Match and review every record before saving.",
          "success"
        );
      } catch (error) {
        setStatus(error.message || "The PDF could not be read. Try another copy or enter its rows manually.", "error");
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("admin-transcript-save-drafts").addEventListener("click", saveDrafts);
    document.getElementById("admin-transcript-close-review").addEventListener("click", function () {
      document.getElementById("admin-transcript-review").hidden = true;
      document.getElementById("admin-transcript-records").replaceChildren();
      reviewRecords = [];
      document.getElementById("admin-transcript-file").value = "";
      closeLocalPreview();
      setStatus("Local PDF preview closed and its temporary browser URL revoked.", "success");
    });
  }

  var batchClient = null;

  function initializeBatchResultImporter(supabaseClient, allAssessments) {
    batchClient = supabaseClient;
    
    if (!allAssessments || !Array.isArray(allAssessments)) return;

    var assessmentSelect = document.getElementById("admin-batch-assessment");
    if (!assessmentSelect) return;

    setSelectOptions(assessmentSelect, allAssessments, "Choose an assessment", "id", function (item) {
      return (item.class_name || "") + " — " + (item.subject_name || "") + " · " + (item.title || "");
    });

    if (assessmentSelect.value && allAssessments.length) {
      assessmentSelect.value = "";
    }
  }

  function detectClassResultsFormat(lines, pageWidth) {
    var hasHeader = false;
    var headerLine = null;
    
    lines.forEach(function (line, index) {
      var text = line.text.toLowerCase();
      if (text.includes("index") || text.includes("name") || text.includes("student") ||
          text.includes("score") || text.includes("mark") || text.includes("total")) {
        hasHeader = true;
        headerLine = index;
      }
    });

    return hasHeader && headerLine !== null ? headerLine : -1;
  }

  function extractBatchResults(lines, pageWidth, headerLine) {
    var columnIndex = { 0: "student_id", 1: "index_number", 2: "student_name", 3: "score", 4: "raw" };
    var columnIndexLabels = { 0: "Student ID", 1: "Index #", 2: "Name", 3: "Score" };
    var results = [];
    var inTable = headerLine >= 0;

    lines.forEach(function (line, index) {
      if (index <= headerLine) return;

      var text = line.text;
      if (!text.trim()) return;

      var cells = [];
      line.items.forEach(function (item) {
        cells.push(item.text.trim());
      });

      if (cells.length >= 3) {
        var possibleScore = cells[cells.length - 1];
        var scoreNum = parseFloat(possibleScore);
        if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) return;

        var row = {};
        cells.forEach(function (cell, cellIndex) {
          if (cellIndex < 5) {
            row[Object.keys(columnIndexLabels)[cellIndex]] = cell;
          }
        });

        if (row.Index != null && row.Score != null) {
          results.push({
            index_number: row.Index || "",
            student_name: row.Name || "",
            score: scoreNum,
            raw_text: text
          });
        }
      }
    });

    return results;
  }

  function bindBatchResultsForm() {
    var form = document.getElementById("admin-batch-results-form");
    if (!form || form.dataset.batchBound) return;
    form.dataset.batchBound = "true";

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;

      var assessmentSelect = document.getElementById("admin-batch-assessment");
      var fileInput = document.getElementById("admin-batch-file");
      var file = fileInput.files && fileInput.files[0];
      var statusEl = document.getElementById("admin-batch-status");
      var previewEl = document.getElementById("admin-batch-preview");

      if (!file) {
        setBatchStatusLocal("admin-batch-status", "Choose a PDF file first.", "error");
        button.disabled = false;
        return;
      }

      if (file.size > 50000000) {
        setBatchStatusLocal("admin-batch-status", "PDF must be smaller than 50 MB.", "error");
        button.disabled = false;
        return;
      }

      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        setBatchStatusLocal("admin-batch-status", "Select a PDF file.", "error");
        button.disabled = false;
        return;
      }

      setBatchStatusLocal("admin-batch-status", "Reading PDF locally in this browser...", "success");

      var iframe = document.getElementById("admin-batch-pdf-preview");

      try {
        var pdfReader = new FileReader();
        pdfReader.onload = async function () {
          try {
            var bytes = new Uint8Array(pdfReader.result);
            var loadingTask = window.pdfjsLib.getDocument({ data: bytes.slice() });
            var pdf;

            try {
              pdf = await loadingTask.promise;
              if (pdf.numPages > 150) {
                throw new Error("PDF has more than 150 pages. Split it into smaller files.");
              }

              var firstPage = await pdf.getPage(1);
              var viewport = firstPage.getViewport({ scale: 1 });
              var content = await firstPage.getTextContent();
              var lines = groupPageLines(content.items);

              var assignmentSelect = document.getElementById("admin-batch-class-subject");
              if (assignmentSelect && !assignmentSelect.value) {
                assignmentSelect.value = assessmentSelect.value;
              }

              if (window.objectUrl) {
                URL.revokeObjectURL(window.objectUrl);
              }
              window.objectUrl = URL.createObjectURL(file);
              iframe.src = window.objectUrl;
              previewEl.hidden = false;

              var headerLine = detectClassResultsFormat(lines, viewport.width);
              if (headerLine < 0) {
                throw new Error("Could not detect class results table format. Ensure the PDF contains a clear results table.");
              }

              var extracted = extractBatchResults(lines, viewport.width, headerLine);
              await stageBatchResults(extracted);

            } finally {
              if (pdf) await pdf.destroy();
              else await loadingTask.destroy();
            }
          } catch (error) {
            setBatchStatusLocal("admin-batch-status", error.message, "error");
            previewEl.hidden = true;
          } finally {
            button.disabled = false;
          }
        };
        pdfReader.readAsArrayBuffer(file);
      } catch (error) {
        setBatchStatusLocal("admin-batch-status", "Could not read the PDF: " + error.message, "error");
        previewEl.hidden = true;
        button.disabled = false;
      }
    });

    document.getElementById("admin-batch-clear").addEventListener("click", function () {
      var iframe = document.getElementById("admin-batch-pdf-preview");
      iframe.src = "about:blank";
      document.getElementById("admin-batch-results-list").replaceChildren();
      document.getElementById("admin-batch-preview").hidden = true;
      document.getElementById("admin-batch-file").value = "";
      document.getElementById("admin-batch-status").textContent = "";
      document.getElementById("admin-batch-status").className = "alert";
    });

    document.getElementById("admin-batch-apply").addEventListener("click", async function () {
      var applyBtn = this;
      applyBtn.disabled = true;
      setBatchStatusLocal("admin-batch-status", "Applying results to database...", "success");

      try {
        var assessmentId = document.getElementById("admin-batch-assessment").value;
        var resultsToApply = batchResultsData.filter(function(r) { return r.student_id !== undefined; });

        if (!resultsToApply.length) {
          throw new Error("No results to apply.");
        }

        var applied = 0;
        for (var i = 0; i < resultsToApply.length; i++) {
          var r = resultsToApply[i];
          var result;
          try {
            result = await batchClient.rpc("admin_save_batch_academic_result", {
              target_assessment_id: assessmentId,
              target_student_id: r.student_id,
              target_score: r.score
            });
          } catch (err) {
            console.warn("Could not save result for student", r.student_id, err);
            continue;
          }
          if (!result.error) applied++;
        }

        setBatchStatusLocal("admin-batch-status", applied + " results saved to database.", "success");

        document.getElementById("admin-batch-preview").hidden = true;
        document.getElementById("admin-batch-file").value = "";
        batchResultsData = [];
      } catch (error) {
        setBatchStatusLocal("admin-batch-status", "Could not apply results: " + (error.message || "Unknown error"), "error");
      } finally {
        applyBtn.disabled = false;
      }
    });
  }

  var batchResultsData = [];

  async function stageBatchResults(extractedResults) {
    var statusEl = document.getElementById("admin-batch-status");
    var listEl = document.getElementById("admin-batch-results-list");
    var assessmentId = document.getElementById("admin-batch-assessment").value;

    if (!assessmentId) {
      statusEl.textContent = "Select an assessment first!";
      statusEl.className = "alert alert-error show";
      return;
    }

    batchResultsData = extractedResults.map(function(r) {
      return {
        index_number: r.index_number,
        student_name: r.student_name,
        score: r.score
      };
    });

    var studentsList = await batchClient.rpc("admin_get_unmatched_batch_students", {
      target_class_subject_id: assessmentId
    });

    var studentMap = {};
    if (!studentsList.error && studentsList.data) {
      studentsList.data.forEach(function (s) {
        studentMap[(s.index_number || "").toUpperCase()] = s;
      });
    }

    listEl.replaceChildren();
    var unmatchedCount = 0;

    extractedResults.forEach(function (result, idx) {
      var indexKey = (result.index_number || "").toUpperCase();
      var student = studentMap[indexKey];

      var row = document.createElement("tr");
      var nameCell = document.createElement("td");
      var indexCell = document.createElement("td");
      var scoreCell = document.createElement("td");
      var scoreInput = document.createElement("input");

      if (student) {
        indexCell.textContent = student.index_number || result.index_number;
        nameCell.textContent = student.full_name || result.student_name || "(matched)";

        scoreInput.type = "number";
        scoreInput.min = "0";
        scoreInput.max = "100";
        scoreInput.step = "0.01";
        scoreInput.value = result.score;
        scoreInput.className = "btn btn-outline";

        scoreInput.dataset.resultIndex = idx;

        scoreInput.addEventListener("change", function () {
          var changeIdx = Number(this.dataset.resultIndex);
          var newScore = parseFloat(this.value);
          if (newScore >= 0 && newScore <= 100) {
            batchResultsData[changeIdx].score = newScore;
            this.value = newScore.toFixed(2).replace(/\.00$/, "");
          } else {
            this.value = batchResultsData[changeIdx].score.toFixed(2).replace(/\.00$/, "");
          }
        });

        row.append(nameCell, indexCell, scoreInput);
      } else {
        nameCell.textContent = result.student_name || "(unmatched)";
        indexCell.textContent = result.index_number || "???";
        scoreCell.textContent = result.score.toFixed(2).replace(/\.00$/, "");
        row.append(nameCell, indexCell, scoreCell);
        unmatchedCount++;
      }

      listEl.appendChild(row);
    });

    var applyBtn = document.getElementById("admin-batch-apply");
    if (unmatchedCount > 0) {
      var statusText = unmatchedCount + " result(s) could not be matched. Preview requires students in the class.";
      statusEl.textContent = statusText;
      statusEl.className = "alert alert-error show";
      applyBtn.disabled = true;
      document.getElementById("admin-batch-unmatched-status").className = "alert alert-error";
    } else {
      applyBtn.disabled = !batchResultsData.length || (studentsList.data && studentsList.data.length === 0);
      document.getElementById("admin-batch-unmatched-status").textContent = "";
      document.getElementById("admin-batch-unmatched-status").className = "alert";
    }

    if (!applyBtn.disabled) {
      statusEl.textContent = batchResultsData.length + " result(s) extracted. Review and edit scores, then click 'Save results to database'.";
      statusEl.className = "alert alert-success show";
    }

    document.getElementById("admin-batch-apply").disabled = unmatchedCount > 0 || !batchResultsData.length;
  }

  function setBatchStatusLocal(id, message, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || "";
    el.className = "alert" + (kind ? " alert-" + kind : "");
  }

  window.initializeBatchResultImporter = function (client, assessments) {
    initializeBatchResultImporter(client, assessments);
    bindBatchResultsForm();
  };
  window.groupPageLines = groupPageLines;
  window.extractBatchResults = extractBatchResults;
  window.detectClassResultsFormat = detectClassResultsFormat;
  window.setBatchSetOptions = setSelectOptions;
  window.setBatchStatus = setBatchStatusLocal;
  window.batchClient = function () { return batchClient; };
})();
