(function () {
  "use strict";

  var BUCKET = "student-photos";
  var MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  var PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var CONTACT_PATTERN = /^[0-9+ ()-]{7,30}$/;
  var PAGE_SIZE = 25;

  function byId(id) { return document.getElementById(id); }

  function showAlert(box, message, kind) {
    if (!box) return;
    box.textContent = message;
    box.className = "alert alert-" + kind + " show";
  }

  function clearAlert(box) {
    if (!box) return;
    box.textContent = "";
    box.className = "alert";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var parts = String(iso).split("-");
    return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : String(iso);
  }

  function displayName(record) {
    var composed = [record.first_name, record.other_names, record.last_name].filter(Boolean).join(" ");
    return composed || record.full_name || "Name not provided";
  }

  function validatePhoto(file) {
    if (!file) return "Choose a photograph first.";
    if (!PHOTO_TYPES[file.type]) return "The photograph must be a JPEG, PNG or WebP image.";
    if (file.size > MAX_PHOTO_BYTES) return "The photograph must be 2 MB or smaller.";
    return "";
  }

  async function signedPhotoUrl(client, path) {
    if (!path) return "";
    var result = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
    return result.error || !result.data ? "" : result.data.signedUrl;
  }

  async function uploadPhoto(client, profileId, file, previousPath) {
    var problem = validatePhoto(file);
    if (problem) throw new Error(problem);
    var path = profileId + "/passport-" + Date.now() + "." + PHOTO_TYPES[file.type];
    var upload = await client.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false
    });
    if (upload.error) throw upload.error;
    var saved = await client.rpc("admin_set_student_photo", {
      target_student_id: profileId,
      target_photo_path: path
    });
    if (saved.error) {
      await client.storage.from(BUCKET).remove([path]);
      throw saved.error;
    }
    if (previousPath && previousPath !== path) {
      await client.storage.from(BUCKET).remove([previousPath]);
    }
    return path;
  }

  function setPhoto(img, placeholder, url) {
    if (!img || !placeholder) return;
    if (url) {
      img.src = url;
      img.hidden = false;
      placeholder.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      placeholder.hidden = false;
    }
  }

  /* ----------------------------- Admin side ----------------------------- */

  var admin = { client: null, records: [], selected: null, lastSearch: null, bound: false };

  function renderResults(rows, total) {
    var tbody = byId("sr-results");
    if (!tbody) return;
    tbody.replaceChildren();
    if (!rows.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 5;
      emptyCell.textContent = "No students match your search.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }
    rows.forEach(function (record) {
      var row = document.createElement("tr");
      var nameCell = document.createElement("td");
      var name = document.createElement("strong");
      name.textContent = displayName(record);
      var email = document.createElement("small");
      email.style.display = "block";
      email.textContent = record.email || "";
      nameCell.append(name, email);
      var indexCell = document.createElement("td");
      indexCell.textContent = record.index_number || "—";
      var classCell = document.createElement("td");
      classCell.textContent = record.form_class || "—";
      var dobCell = document.createElement("td");
      dobCell.textContent = formatDate(record.date_of_birth);
      var actionCell = document.createElement("td");
      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn-outline";
      edit.textContent = "View / edit";
      edit.addEventListener("click", function () { openEditor(record); });
      actionCell.appendChild(edit);
      row.append(nameCell, indexCell, classCell, dobCell, actionCell);
      tbody.appendChild(row);
    });
    if (typeof total === "number" && total > rows.length) {
      var more = document.createElement("tr");
      var moreCell = document.createElement("td");
      moreCell.colSpan = 5;
      moreCell.textContent = "Showing the first " + rows.length + " of " + total + " students. Use the search to find others.";
      more.appendChild(moreCell);
      tbody.appendChild(more);
    }
  }

  function showAll() {
    admin.lastSearch = null;
    clearAlert(byId("sr-search-status"));
    renderResults(admin.records.slice(0, PAGE_SIZE), admin.records.length);
  }

  async function runSearch(name, dob) {
    var status = byId("sr-search-status");
    if (!name && !dob) {
      showAlert(status, "Enter a first name, last name, or date of birth to search.", "error");
      return;
    }
    showAlert(status, "Searching…", "success");
    var result = await admin.client.rpc("admin_search_students", {
      target_query: name || null,
      target_dob: dob || null
    });
    if (result.error) {
      showAlert(status, "The search failed: " + result.error.message, "error");
      return;
    }
    admin.lastSearch = { name: name, dob: dob };
    var rows = result.data || [];
    renderResults(rows);
    showAlert(
      status,
      rows.length ? rows.length + " student" + (rows.length === 1 ? "" : "s") + " found." + (rows.length === 50 ? " Showing the first 50; narrow the search." : "") : "No students match your search.",
      rows.length ? "success" : "error"
    );
  }

  async function refreshAfterChange() {
    var all = await admin.client.rpc("admin_list_student_details");
    if (!all.error) admin.records = all.data || [];
    var search = admin.lastSearch;
    if (search) await runSearch(search.name, search.dob);
    else showAll();
    if (admin.selected) {
      var updated = admin.records.find(function (record) { return record.id === admin.selected.id; });
      if (updated) admin.selected = updated;
    }
  }

  function setValue(id, value) {
    var element = byId(id);
    if (element) element.value = value || "";
  }

  async function openEditor(record) {
    admin.selected = record;
    var editor = byId("sr-editor");
    clearAlert(byId("sr-edit-status"));
    setValue("sr-edit-first", record.first_name);
    setValue("sr-edit-other", record.other_names);
    setValue("sr-edit-last", record.last_name);
    setValue("sr-edit-dob", record.date_of_birth);
    setValue("sr-edit-gender", record.gender);
    setValue("sr-edit-pob", record.place_of_birth);
    setValue("sr-edit-hometown", record.hometown);
    setValue("sr-edit-guardian", record.guardian_name);
    setValue("sr-edit-contact", record.guardian_contact);
    setValue("sr-edit-index", record.index_number);
    setValue("sr-edit-class", record.form_class);
    setValue("sr-edit-programme", record.programme);
    setValue("sr-edit-residency", record.residency);
    byId("sr-editor-heading").textContent = "Edit " + displayName(record);
    byId("sr-editor-sub").textContent = record.first_name && record.last_name
      ? "Correct any detail, then save. The student sees the update immediately."
      : "Name on file: " + (record.full_name || "not set") + ". Enter the first, other and last names to complete this record.";
    setPhoto(byId("sr-edit-photo"), byId("sr-edit-photo-empty"), "");
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    var url = await signedPhotoUrl(admin.client, record.photo_path);
    if (admin.selected && admin.selected.id === record.id) {
      setPhoto(byId("sr-edit-photo"), byId("sr-edit-photo-empty"), url);
    }
  }

  function closeEditor() {
    admin.selected = null;
    byId("sr-editor").hidden = true;
  }

  async function saveEditor(event) {
    event.preventDefault();
    var form = byId("sr-edit-form");
    var status = byId("sr-edit-status");
    var record = admin.selected;
    if (!record) return;
    var contact = byId("sr-edit-contact").value.trim();
    if (!byId("sr-edit-first").value.trim() || !byId("sr-edit-last").value.trim() ||
      !byId("sr-edit-dob").value || !byId("sr-edit-index").value.trim() || !byId("sr-edit-programme").value.trim()) {
      showAlert(status, "First name, last name, date of birth, CassRefID and programme are required.", "error");
      return;
    }
    if (contact && !CONTACT_PATTERN.test(contact)) {
      showAlert(status, "Enter a valid contact number (digits, spaces, + ( ) - only).", "error");
      return;
    }
    var button = form.querySelector("button[type='submit']");
    button.disabled = true;
    showAlert(status, "Saving…", "success");
    try {
      var result = await admin.client.rpc("admin_save_student_record", {
        target_student_id: record.id,
        target_first_name: byId("sr-edit-first").value,
        target_other_names: byId("sr-edit-other").value,
        target_last_name: byId("sr-edit-last").value,
        target_date_of_birth: byId("sr-edit-dob").value,
        target_gender: byId("sr-edit-gender").value,
        target_index_number: byId("sr-edit-index").value,
        target_programme: byId("sr-edit-programme").value,
        target_residency: byId("sr-edit-residency").value,
        target_form_class: byId("sr-edit-class").value,
        target_place_of_birth: byId("sr-edit-pob").value,
        target_hometown: byId("sr-edit-hometown").value,
        target_guardian_name: byId("sr-edit-guardian").value,
        target_guardian_contact: contact
      });
      if (result.error) throw result.error;
      await refreshAfterChange();
      if (admin.selected) byId("sr-editor-heading").textContent = "Edit " + displayName(admin.selected);
      showAlert(status, "Saved. The student's portal now shows the updated details.", "success");
    } catch (error) {
      showAlert(status, "The record could not be saved: " + (error.message || "unknown error"), "error");
    } finally {
      button.disabled = false;
    }
  }

  async function handleEditorPhoto(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var status = byId("sr-edit-status");
    input.value = "";
    if (!file || !admin.selected) return;
    var record = admin.selected;
    try {
      showAlert(status, "Uploading photograph…", "success");
      var path = await uploadPhoto(admin.client, record.id, file, record.photo_path);
      record.photo_path = path;
      setPhoto(byId("sr-edit-photo"), byId("sr-edit-photo-empty"), await signedPhotoUrl(admin.client, path));
      showAlert(status, "Photograph updated.", "success");
      await refreshAfterChange();
    } catch (error) {
      showAlert(status, "The photograph could not be uploaded: " + (error.message || "unknown error") +
        ". Save the student's details first if this is a new record.", "error");
    }
  }

  function selectAddTab(which) {
    var single = which === "single";
    byId("sr-tab-single").classList.toggle("is-active", single);
    byId("sr-tab-bulk").classList.toggle("is-active", !single);
    byId("sr-tab-single").setAttribute("aria-selected", String(single));
    byId("sr-tab-bulk").setAttribute("aria-selected", String(!single));
    byId("admin-student-single-form").hidden = !single;
    byId("sr-bulk-panel").hidden = single;
  }

  function downloadTemplate() {
    var header = [
      "School Code", "First Name", "Other Names", "Last Name", "CassRefID", "LEARNING_AREA",
      "YearOfEntry", "DOB", "Gender", "Place of Birth", "Hometown", "Guardian", "Guardian Contact"
    ];
    var example = [
      "0071007", "Ama", "Serwaa", "Mensah", "ABC123456789", "GENERAL SCIENCE",
      "2026", "2010-05-14", "Female", "Kumasi", "Mampong", "Kofi Mensah", "0244000000"
    ];
    var content = "\uFEFF" + header.join(",") + "\r\n" + example.join(",") + "\r\n";
    var url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = "afastech-student-roster-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function initAdmin(client) {
    admin.client = client;
    if (admin.bound || !byId("sr-search-form")) return;
    admin.bound = true;

    byId("sr-search-form").addEventListener("submit", function (event) {
      event.preventDefault();
      runSearch(byId("sr-search-name").value.trim(), byId("sr-search-dob").value);
    });
    byId("sr-search-all").addEventListener("click", function () {
      byId("sr-search-name").value = "";
      byId("sr-search-dob").value = "";
      showAll();
    });
    byId("sr-edit-form").addEventListener("submit", saveEditor);
    byId("sr-editor-close").addEventListener("click", closeEditor);
    byId("sr-edit-cancel").addEventListener("click", closeEditor);
    byId("sr-edit-photo-file").addEventListener("change", handleEditorPhoto);

    var panel = byId("student-import");
    var toggle = byId("sr-add-toggle");
    toggle.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "+ Add student";
      if (open) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    byId("sr-tab-single").addEventListener("click", function () { selectAddTab("single"); });
    byId("sr-tab-bulk").addEventListener("click", function () { selectAddTab("bulk"); });
    byId("sr-template-download").addEventListener("click", downloadTemplate);
    selectAddTab("single");
  }

  function setRecords(rows) {
    admin.records = rows || [];
    if (!admin.bound) return;
    if (admin.lastSearch) return;
    renderResults(admin.records.slice(0, PAGE_SIZE), admin.records.length);
  }

  /* ---------------------------- Student side ---------------------------- */

  var student = { client: null, userId: null, loadedPhotoPath: null, dirty: false };

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach(function (element) {
      element.textContent = value || "Not set";
    });
  }

  function renderStudent(record, preserveForm) {
    var fullName = displayName(record);
    setText("[data-student-full-name]", fullName);
    setText("[data-portal-user]", fullName);
    var avatar = document.querySelector("[data-portal-avatar]");
    if (avatar) avatar.textContent = fullName.trim().charAt(0).toUpperCase() || "S";
    setText("[data-student-first-name]", record.first_name || String(fullName).split(/\s+/)[0]);
    setText("[data-sp-first]", record.first_name);
    setText("[data-sp-other]", record.other_names);
    setText("[data-sp-last]", record.last_name);
    setText("[data-sp-dob]", record.date_of_birth ? formatDate(record.date_of_birth) : "");
    setText("[data-student-personal-index]", record.index_number);
    setText("[data-student-personal-class]", record.form_class);
    setText("[data-student-personal-programme]", record.programme);
    setText("[data-student-personal-residency]", record.residency);
    setText("[data-student-index]", record.index_number);
    setText("[data-student-form-class]", record.form_class);
    setText("[data-student-programme]", record.programme);
    setText("[data-student-residency]", record.residency);

    if (!preserveForm) {
      setValue("sp-gender", record.gender);
      setValue("sp-pob", record.place_of_birth);
      setValue("sp-hometown", record.hometown);
      setValue("sp-guardian", record.guardian_name);
      setValue("sp-contact", record.guardian_contact);
    }

    if (record.photo_path !== student.loadedPhotoPath) {
      student.loadedPhotoPath = record.photo_path;
      signedPhotoUrl(student.client, record.photo_path).then(function (url) {
        if (student.loadedPhotoPath === record.photo_path) {
          setPhoto(byId("sp-photo"), byId("sp-photo-empty"), url);
        }
      });
    }
  }

  async function loadStudent() {
    var result = await student.client.rpc("student_get_my_details");
    if (result.error) throw result.error;
    var record = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!record) return;
    renderStudent(record, student.dirty);
  }

  async function saveStudent(event) {
    event.preventDefault();
    var status = byId("sp-status");
    var contact = byId("sp-contact").value.trim();
    if (contact && !CONTACT_PATTERN.test(contact)) {
      showAlert(status, "Enter a valid contact number (digits, spaces, + ( ) - only).", "error");
      return;
    }
    var button = byId("sp-form").querySelector("button[type='submit']");
    button.disabled = true;
    showAlert(status, "Saving…", "success");
    try {
      var result = await student.client.rpc("student_update_my_details", {
        target_gender: byId("sp-gender").value,
        target_place_of_birth: byId("sp-pob").value,
        target_hometown: byId("sp-hometown").value,
        target_guardian_name: byId("sp-guardian").value,
        target_guardian_contact: contact
      });
      if (result.error) throw result.error;
      student.dirty = false;
      await loadStudent();
      showAlert(status, "Your details have been saved.", "success");
    } catch (error) {
      showAlert(status, "Your details could not be saved: " + (error.message || "unknown error"), "error");
    } finally {
      button.disabled = false;
    }
  }

  async function initStudent(client, userId) {
    student.client = client;
    student.userId = userId;
    var form = byId("sp-form");
    if (!form) return;
    form.addEventListener("input", function () { student.dirty = true; });
    form.addEventListener("submit", saveStudent);
    await loadStudent();
    client
      .channel("student-personal-" + userId)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "student_details",
        filter: "profile_id=eq." + userId
      }, function () {
        loadStudent().catch(function (error) {
          console.error("Could not refresh personal details.", error);
        });
      })
      .subscribe();
  }

  window.AfastechStudents = {
    initAdmin: initAdmin,
    setRecords: setRecords,
    uploadPhoto: function (client, profileId, file) { return uploadPhoto(client, profileId, file, null); },
    validatePhoto: validatePhoto,
    initStudent: initStudent
  };
})();
