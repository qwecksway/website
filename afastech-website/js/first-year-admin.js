(function () {
  "use strict";
  var areas = ["General Arts", "Business", "Applied Technology", "Home Economics", "Agriculture", "Languages"];
  var fields = [
    ["SURNAME", "surname"], ["FIRSTNAME", "firstname"], ["OTHERNAMES", "othernames"],
    ["NATIONALIDNO", "nationalid"], ["GENDER", "gender"], ["DISABILITYSTATUS", "disability"],
    ["CANREADBRAILLE", "braille"], ["DATEOFBIRTH", "dob"], ["GUARDIAN", "guardian"],
    ["RELATIONSHIPTOSTUDENT", "relationship"], ["PHONENUM", "phone"], ["PROFESSION", "profession"],
    ["ADDRESS", "address"], ["YEAROFENTRY", "year"]
  ];
  var headers = fields.map(function (field) { return field[0]; }).concat(
    ["LEARNING AREA", "OPTION", "ELECTIVE 1", "ELECTIVE 2", "ELECTIVE 3", "ELECTIVE 4", "ELECTIVE 5"]
  );
  var client;
  var status = document.getElementById("first-year-admin-status");
  var refresh = document.getElementById("first-year-refresh");
  var download = document.getElementById("first-year-export");
  var toggle = document.getElementById("first-year-toggle");
  var openStatus = document.getElementById("first-year-open-status");
  var initialized = false;
  var busy = false;
  var isOpen = null;

  function showStatus(message, kind) {
    status.textContent = message;
    status.className = message ? "alert alert-" + kind + " show" : "alert";
  }
  function setBusy(value) {
    busy = value;
    refresh.disabled = value;
    download.disabled = value;
    toggle.disabled = value || isOpen === null;
  }
  function renderStatus(value) {
    if (typeof value !== "boolean") throw new Error("The registration status response was invalid.");
    isOpen = value;
    openStatus.textContent = value
      ? "Registration is open. Anyone with the link can submit."
      : "Registration is closed. New submissions are blocked.";
    toggle.textContent = value ? "Close registration" : "Open registration";
    toggle.disabled = busy;
  }
  async function loadStatus() {
    var result = await client.rpc("admin_get_first_year_registration_status");
    if (result.error) throw result.error;
    renderStatus(result.data);
  }
  async function toggleStatus() {
    if (busy || isOpen === null) return;
    var target = !isOpen;
    if (!window.confirm(target ? "Open first year registration to new submissions?" : "Close first year registration and block new submissions?")) return;
    setBusy(true);
    try {
      var result = await client.rpc("admin_set_first_year_registration_status", { registrations_open: target });
      if (result.error) throw result.error;
      renderStatus(result.data);
      showStatus(target ? "Registration is open." : "Registration is closed.", "success");
    } catch (error) {
      console.error("Registration status could not be changed:", error);
      isOpen = null;
      openStatus.textContent = "Registration status could not be confirmed. Refresh before trying again.";
      showStatus("The registration status could not be confirmed. Refresh and try again.", "error");
    } finally {
      setBusy(false);
    }
  }
  async function fetchAll() {
    var records = [];
    var size = 500;
    for (var start = 0; ; start += size) {
      var result = await client.rpc("admin_list_first_year_registrations")
        .order("created_at").order("id").range(start, start + size - 1);
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error("The registration response was invalid.");
      records = records.concat(result.data);
      if (result.data.length < size) return records;
    }
  }
  function render(records) {
    var rows = document.getElementById("first-year-rows");
    rows.replaceChildren();
    records.forEach(function (record) {
      var tr = document.createElement("tr");
      [record.details.surname, record.details.firstname, record.learning_area,
        "Option " + record.option_number, record.electives.join(", "), record.details.phone
      ].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value;
        tr.appendChild(cell);
      });
      rows.appendChild(tr);
    });
    document.getElementById("first-year-count").textContent = records.length + " registration" + (records.length === 1 ? "" : "s") + " loaded.";
  }
  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload = function () {
        if (window.XLSX) resolve(window.XLSX);
        else reject(new Error("Excel library did not load."));
      };
      script.onerror = function () { reject(new Error("Excel library could not be downloaded.")); };
      document.head.appendChild(script);
    });
  }
  function excelRow(record) {
    return fields.map(function (field) {
      var value = record.details[field[1]] || "";
      return field[1] === "dob" ? value.replace(/-/g, "") : String(value);
    }).concat([record.learning_area, "Option " + record.option_number],
      [0, 1, 2, 3, 4].map(function (index) { return record.electives[index] || ""; }));
  }
  async function run(exportFile) {
    if (busy) return;
    setBusy(true);
    showStatus("Loading registrations…", "success");
    try {
      await loadStatus();
      var records = await fetchAll();
      render(records);
      if (exportFile) {
        if (!records.length) {
          showStatus("There are no registrations to download yet.", "error");
          return;
        }
        var XLSX = await loadSheetJs();
        var workbook = XLSX.utils.book_new();
        [["All registrations", records]].concat(areas.map(function (area) {
          return [area, records.filter(function (record) { return record.learning_area === area; })];
        })).forEach(function (sheet) {
          var data = [headers].concat(sheet[1].map(excelRow));
          var worksheet = XLSX.utils.aoa_to_sheet(data);
          worksheet["!cols"] = headers.map(function (header) { return { wch: Math.max(16, header.length + 2) }; });
          XLSX.utils.book_append_sheet(workbook, worksheet, sheet[0]);
        });
        XLSX.writeFile(workbook, "Afadjato_Registration_2026_2027.xlsx");
        showStatus("Excel download started. Keep the file secure.", "success");
      } else {
        showStatus("", "");
      }
    } catch (error) {
      console.error("First year registrations could not be loaded or exported:", error);
      showStatus("Registrations could not be loaded or exported. Check your connection and database setup, then try again.", "error");
    } finally {
      setBusy(false);
    }
  }
  window.initializeFirstYearRegistrations = function (supabaseClient) {
    if (initialized) return;
    initialized = true;
    client = supabaseClient;
    refresh.addEventListener("click", function () { run(false); });
    download.addEventListener("click", function () { run(true); });
    toggle.addEventListener("click", toggleStatus);
    if (new URLSearchParams(window.location.search).get("view") === "first-year-registrations" ||
      window.location.hash === "#view-first-year-registrations") run(false);
  };
})();
