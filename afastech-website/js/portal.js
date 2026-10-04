(function () {
  "use strict";

  var LOGIN_PAGES = {
    student: "portal-student.html",
    staff: "portal-staff.html",
    admin: "portal-admin.html"
  };
  var DASHBOARD_PAGES = {
    student: "portal-student-dashboard.html",
    staff: "portal-staff-dashboard.html",
    admin: "portal-admin-dashboard.html"
  };
  var STUDENT_LOGIN_DOMAIN = "students.afastech.invalid";
  var staffAcademicAssignments = [];
  var staffAcademicAssessments = [];

  function createClient() {
    if (!window.supabase || !window.AFASTECH_SUPABASE_URL || !window.AFASTECH_SUPABASE_ANON_KEY) {
      return null;
    }

    return window.supabase.createClient(
      window.AFASTECH_SUPABASE_URL,
      window.AFASTECH_SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      }
    );
  }

  function showAlert(alertBox, message, kind) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = "alert alert-" + kind + " show";
  }

  function showSetupError(alertBox) {
    showAlert(alertBox, "Portal sign-in is not configured yet. Contact the site administrator.", "error");
  }

  function renderRows(tbody, rows, columns) {
    if (!tbody) return;
    tbody.replaceChildren();

    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      columns.forEach(function (column) {
        var td = document.createElement("td");
        td.textContent = column(row);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function showEmptyState(element, message) {
    if (element) element.textContent = message;
  }

  function setSelectOptions(select, items, placeholder, valueKey, labelBuilder) {
    if (!select) return;
    var previousValue = select.value;
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
    if ((items || []).some(function (item) { return String(item[valueKey]) === previousValue; })) {
      select.value = previousValue;
    }
  }

  async function getProfile(client, userId) {
    var result = await client
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  function setProfileName(profile, email) {
    var greeting = document.querySelector("[data-portal-user]");
    var fullName = profile.full_name || "";
    if (greeting) greeting.textContent = fullName || email || "User";
    var firstName = document.querySelector("[data-student-first-name]");
    if (firstName) firstName.textContent = fullName ? fullName.split(/\s+/)[0] : "Student";
    var studentName = document.querySelector("[data-student-full-name]");
    if (studentName) studentName.textContent = fullName || "Not set";
    var studentEmail = document.querySelector("[data-student-email]");
    var studentLoginMatch = typeof email === "string"
      ? email.match(/^refid-([a-z0-9]{12})@students\.afastech\.invalid$/i)
      : null;
    if (studentEmail) {
      studentEmail.textContent = studentLoginMatch
        ? studentLoginMatch[1].toUpperCase()
        : email || "Not set";
    }
  }

  async function loadStudentDashboard(client, userId) {
    var results = await Promise.all([
      client.from("student_details").select("index_number, programme, residency, form_class, current_term, fees_status").eq("profile_id", userId).maybeSingle(),
      client.from("timetable_entries").select("weekday, morning, afternoon").eq("student_id", userId).order("weekday"),
      client.rpc("student_list_my_academic_results"),
      client.from("portal_announcements").select("title, body, published_at").or("audience.eq.all,audience.eq.student").order("published_at", { ascending: false }).limit(10),
      client.rpc("student_list_my_academic_subjects")
    ]);
    var error = results.find(function (result) { return result.error; });
    if (error) throw error.error;

    var record = results[0].data;
    document.querySelector("[data-student-programme]").textContent = "Not set";
    document.querySelector("[data-student-residency]").textContent = "Not set";
    document.querySelector("[data-student-term]").textContent = "Not set";
    document.querySelector("[data-student-index]").textContent = "Not set";
    document.querySelector("[data-student-form-class]").textContent = "Not set";
    document.querySelector("[data-student-fees]").textContent = "Not set";
    document.querySelector("[data-student-personal-index]").textContent = "Not set";
    document.querySelector("[data-student-personal-class]").textContent = "Not set";
    document.querySelector("[data-student-personal-programme]").textContent = "Not set";
    document.querySelector("[data-student-personal-residency]").textContent = "Not set";
    if (record) {
      document.querySelector("[data-student-programme]").textContent = record.programme || "Not set";
      document.querySelector("[data-student-residency]").textContent = record.residency || "Not set";
      document.querySelector("[data-student-term]").textContent = record.current_term || "Not set";
      document.querySelector("[data-student-index]").textContent = record.index_number || "Not set";
      document.querySelector("[data-student-form-class]").textContent = record.form_class || "Not set";
      document.querySelector("[data-student-fees]").textContent = record.fees_status || "Not set";
      document.querySelector("[data-student-personal-index]").textContent = record.index_number || "Not set";
      document.querySelector("[data-student-personal-class]").textContent = record.form_class || "Not set";
      document.querySelector("[data-student-personal-programme]").textContent = record.programme || "Not set";
      document.querySelector("[data-student-personal-residency]").textContent = record.residency || "Not set";
    }

    var weekdays = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    renderRows(document.getElementById("student-timetable"), results[1].data || [], [
      function (row) { return weekdays[row.weekday] || ""; },
      function (row) { return row.morning; },
      function (row) { return row.afternoon; }
    ]);
    renderRows(document.getElementById("student-results"), results[2].data || [], [
      function (row) { return row.subject; },
      function (row) { return row.assessment; },
      function (row) { return [row.term, row.academic_year].filter(Boolean).join(" · ") || "—"; },
      function (row) {
        var score = Number(row.score);
        var maximum = Number(row.max_score);
        return score.toFixed(2).replace(/\.00$/, "") + " / " + maximum.toFixed(2).replace(/\.00$/, "");
      }
    ]);
    renderRows(document.getElementById("student-subjects"), results[4].data || [], [
      function (row) { return row.subject_name; },
      function (row) { return row.teacher_name || "Not assigned"; },
      function (row) { return [row.class_name, row.programme_name].filter(Boolean).join(" · "); },
      function (row) { return row.academic_year_name; }
    ]);
    renderAnnouncements(results[3].data || []);
    if (!record) showEmptyState(document.getElementById("student-data-status"), "Your school record has not been added yet.");
    if (!results[1].data.length) showEmptyState(document.getElementById("student-timetable-status"), "No timetable entries are available.");
    if (!results[2].data.length) showEmptyState(document.getElementById("student-results-status"), "No results are available.");
    if (!results[4].data.length) showEmptyState(document.getElementById("student-subjects-status"), "Your current class and subject enrolment has not been set up yet.");
  }

  async function loadStaffDashboard(client, userId) {
    var result = await client.from("portal_announcements")
      .select("title, body, published_at")
      .or("audience.eq.all,audience.eq.staff")
      .order("published_at", { ascending: false })
      .limit(10);
    if (result.error) throw result.error;
    renderAnnouncements(result.data || []);
    var houseFeeAccess = await client.rpc("staff_can_manage_house_fees");
    if (houseFeeAccess.error) throw houseFeeAccess.error;
    var houseFeesSection = document.getElementById("house-fees");
    houseFeesSection.hidden = !houseFeeAccess.data;
    if (houseFeeAccess.data) {
      await loadFeeRecords(client, "staff-house-fees", "staff-house-fees-status");
    }
    await initializeStaffAcademicTools(client);
  }

  async function initializeStaffAcademicTools(client) {
    var assignmentSelect = document.getElementById("staff-academic-assignment");
    var assessmentSelect = document.getElementById("staff-academic-assessment");
    var createForm = document.getElementById("staff-academic-assessment-form");
    var loadRosterButton = document.getElementById("staff-academic-load-roster");
    var submitButton = document.getElementById("staff-academic-submit");
    if (!assignmentSelect || !assessmentSelect || !createForm || !loadRosterButton || !submitButton) return;

    var assignmentResult = await client.rpc("staff_list_academic_assignments");
    var assessmentResult = await client.rpc("staff_list_academic_assessments");
    if (assignmentResult.error) throw assignmentResult.error;
    if (assessmentResult.error) throw assessmentResult.error;
    staffAcademicAssignments = assignmentResult.data || [];
    staffAcademicAssessments = assessmentResult.data || [];
    renderRows(document.getElementById("staff-assignments"), staffAcademicAssignments, [
      function (item) { return item.class_name; },
      function (item) { return item.programme_name; },
      function (item) { return item.subject_name; },
      function (item) { return item.academic_year_name; }
    ]);
    setSelectOptions(assignmentSelect, staffAcademicAssignments, "Choose an assigned class", "class_subject_id", function (item) {
      return item.class_name + " — " + item.subject_name + " (" + item.academic_year_name + ")";
    });
    if (!assignmentSelect.value && staffAcademicAssignments.length) {
      assignmentSelect.value = staffAcademicAssignments[0].class_subject_id;
    }
    renderStaffAcademicAssessments(assessmentSelect, staffAcademicAssessments);
    if (!staffAcademicAssignments.length) {
      showEmptyState(document.getElementById("staff-academic-roster-status"), "No academic classes have been assigned to your account.");
      showEmptyState(document.getElementById("staff-assignments-status"), "No class and subject allocations are set up yet.");
    } else {
      showEmptyState(document.getElementById("staff-assignments-status"), "");
    }

    if (!createForm.dataset.academicBound) {
      createForm.dataset.academicBound = "true";
      assignmentSelect.addEventListener("change", async function () {
        var assignment = staffAcademicAssignments.find(function (item) {
          return item.class_subject_id === assignmentSelect.value;
        });
        var terms = document.getElementById("staff-academic-term");
        setSelectOptions(terms, [], assignment ? "Loading semesters…" : "Choose an assigned class", "id", function (item) {
          return item.name;
        });
        if (!assignment) return;
        try {
          var termResult = await client.rpc("staff_list_academic_terms", {
            target_year_id: assignment.academic_year_id
          });
          if (termResult.error) throw termResult.error;
          if (assignmentSelect.value !== assignment.class_subject_id) return;
          setSelectOptions(terms, termResult.data || [], "Choose a semester", "id", function (item) {
            return item.name;
          });
        } catch (error) {
          showAlert(document.getElementById("staff-academic-status"), "Terms could not be loaded. Refresh and try again.", "error");
        }
      });
      createForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var button = createForm.querySelector("button[type='submit']");
        button.disabled = true;
        var saved;
        try {
          saved = await client.rpc("staff_save_academic_assessment", {
            target_class_subject_id: assignmentSelect.value,
            target_term_id: document.getElementById("staff-academic-term").value,
            target_title: document.getElementById("staff-academic-assessment-title").value,
            target_max_score: Number(document.getElementById("staff-academic-assessment-max").value)
          });
          if (saved.error) throw saved.error;
        } catch (error) {
          showAlert(document.getElementById("staff-academic-status"), "Assessment could not be created. Check the class, term, and mark range.", "error");
          button.disabled = false;
          return;
        }
        document.getElementById("staff-academic-assessment-title").value = "";
        showAlert(document.getElementById("staff-academic-status"), "Assessment created. Enter marks for the whole class.", "success");
        try {
          await initializeStaffAcademicTools(client);
          assessmentSelect.value = saved.data;
        } catch (error) {
          showAlert(document.getElementById("staff-academic-status"), "Assessment was created, but the list could not be refreshed. Reload the page.", "error");
        }
        button.disabled = false;
      });
      loadRosterButton.addEventListener("click", function () {
        loadStaffAcademicRoster(client, staffAcademicAssessments, staffAcademicAssignments, assignmentSelect, assessmentSelect, submitButton);
      });
      submitButton.addEventListener("click", async function () {
        submitButton.disabled = true;
        var submitted;
        try {
          submitted = await client.rpc("staff_submit_academic_assessment", {
            target_assessment_id: assessmentSelect.value
          });
          if (submitted.error) throw submitted.error;
        } catch (error) {
          showAlert(document.getElementById("staff-academic-status"), "Marks could not be submitted. Enter every student's mark before submitting.", "error");
          submitButton.disabled = false;
          return;
        }
        showAlert(document.getElementById("staff-academic-status"), "Marks submitted to the administrator for review.", "success");
        document.getElementById("staff-academic-roster").replaceChildren();
        showEmptyState(document.getElementById("staff-academic-roster-status"), "Submitted marks are locked until the administrator reviews them.");
        try {
          await initializeStaffAcademicTools(client);
        } catch (error) {
          showAlert(document.getElementById("staff-academic-status"), "Marks were submitted, but the list could not be refreshed. Reload the page.", "error");
        }
      });
    }

    if (assignmentSelect.value) assignmentSelect.dispatchEvent(new Event("change"));
  }

  function renderStaffAcademicAssessments(select, assessments) {
    setSelectOptions(select, assessments, "Choose an assessment", "id", function (item) {
      return item.class_name + " — " + item.subject_name + " · " + item.title + " (" + item.status + ")";
    });
  }

  async function loadStaffAcademicRoster(client, assessments, assignments, assignmentSelect, assessmentSelect, submitButton) {
    var assessment = assessments.find(function (item) { return item.id === assessmentSelect.value; });
    if (!assessment) {
      showEmptyState(document.getElementById("staff-academic-roster-status"), "Choose an assessment first.");
      return;
    }
    var tbody = document.getElementById("staff-academic-roster");
    tbody.replaceChildren();
    submitButton.disabled = assessment.status !== "draft";
    var roster;
    try {
      roster = await client.rpc("staff_list_academic_students", {
        target_class_subject_id: assessment.class_subject_id,
        target_assessment_id: assessment.id
      });
      if (roster.error) throw roster.error;
    } catch (error) {
      showEmptyState(document.getElementById("staff-academic-roster-status"), "The student list could not be loaded. Refresh and try again.");
      return;
    }
    var students = roster.data || [];
    if (!students.length) {
      showEmptyState(document.getElementById("staff-academic-roster-status"), "No students are enrolled in this class for the selected year.");
      submitButton.disabled = true;
      return;
    }
    students.forEach(function (student) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      var index = document.createElement("td");
      var scoreCell = document.createElement("td");
      var actionCell = document.createElement("td");
      var score = document.createElement("input");
      var save = document.createElement("button");
      name.textContent = student.full_name || "Name not provided";
      index.textContent = student.index_number || "Not set";
      score.type = "number";
      score.min = "0";
      score.max = String(assessment.max_score);
      score.step = "0.01";
      score.required = true;
      score.value = student.score === null ? "" : String(student.score);
      score.disabled = assessment.status !== "draft";
      score.setAttribute("aria-label", "Mark for " + (student.full_name || "student"));
      save.className = "btn btn-outline";
      save.type = "button";
      save.textContent = "Save mark";
      save.disabled = assessment.status !== "draft";
      save.addEventListener("click", async function () {
        if (!score.value.trim()) {
          showAlert(document.getElementById("staff-academic-status"), "Enter a mark before saving.", "error");
          score.focus();
          return;
        }
        save.disabled = true;
        try {
          var saved = await client.rpc("staff_save_academic_result", {
            target_assessment_id: assessment.id,
            target_student_id: student.student_id,
            target_score: Number(score.value)
          });
          if (saved.error) throw saved.error;
          student.score = Number(score.value);
          showAlert(document.getElementById("staff-academic-status"), "Mark saved. It remains private until submitted and published.", "success");
        } catch (error) {
          save.disabled = false;
          showAlert(document.getElementById("staff-academic-status"), "Mark not saved. Enter a valid mark within the assessment maximum.", "error");
          return;
        }
        save.disabled = false;
      });
      scoreCell.appendChild(score);
      actionCell.appendChild(save);
      row.append(name, index, scoreCell, actionCell);
      tbody.appendChild(row);
    });
    showEmptyState(
      document.getElementById("staff-academic-roster-status"),
      assessment.status === "draft" ? "Save a mark for each student, then submit the assessment for review." : "This assessment has been submitted and is locked for editing."
    );
    submitButton.disabled = assessment.status !== "draft";
  }

  async function loadFeeRecords(client, tbodyId, statusId) {
    var result = await client.rpc("list_house_fee_records");
    if (result.error) throw result.error;

    var tbody = document.getElementById(tbodyId);
    tbody.replaceChildren();
    var records = result.data || [];
    if (!records.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 4;
      emptyCell.textContent = "No student fee records are available for your assigned houses.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      showEmptyState(document.getElementById(statusId), "");
      return;
    }

    records.forEach(function (record) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      var house = document.createElement("td");
      var status = document.createElement("td");
      var action = document.createElement("td");
      var input = document.createElement("input");
      var button = document.createElement("button");
      name.textContent = record.full_name || "Name not provided";
      house.textContent = record.house_name || "No house assigned";
      input.type = "text";
      input.maxLength = 120;
      input.value = record.fees_status || "";
      input.placeholder = "Not set";
      input.setAttribute("aria-label", "Fee status for " + (record.full_name || "student"));
      button.className = "btn btn-outline";
      button.type = "button";
      button.textContent = "Save";
      button.addEventListener("click", async function () {
        button.disabled = true;
        var update;
        try {
          update = await client.rpc("update_student_fee_status", {
            target_student_id: record.student_id,
            next_status: input.value
          });
        } catch (error) {
          button.disabled = false;
          showAlert(
            document.getElementById("portal-data-alert"),
            "The fee status could not be saved. Check your connection and try again.",
            "error"
          );
          return;
        }
        if (update.error) {
          button.disabled = false;
          showAlert(
            document.getElementById("portal-data-alert"),
            "The fee status could not be saved. Check the value and your access, then try again.",
            "error"
          );
          return;
        }
        showAlert(
          document.getElementById("portal-data-alert"),
          "Fee status saved. The student's dashboard will update automatically.",
          "success"
        );
      });
      action.appendChild(button);
      row.append(name, house, status, action);
      status.appendChild(input);
      tbody.appendChild(row);
    });
    showEmptyState(document.getElementById(statusId), "");
  }

  async function loadAdminDashboard(client) {
    var results = await Promise.all([
      client.rpc("admin_list_profiles"),
      client.rpc("admin_list_houses"),
      client.rpc("list_house_fee_records"),
      client.rpc("admin_list_house_assignable_people"),
      client.rpc("admin_list_staff_details")
    ]);
    var error = results.find(function (result) { return result.error; });
    if (error) throw error.error;

    var profiles = results[0].data || [];
    var houses = results[1].data || [];
    document.querySelector("[data-admin-total]").textContent = String(profiles.length);
    document.querySelector("[data-admin-staff-count]").textContent = String(
      profiles.filter(function (profile) { return profile.role === "staff"; }).length
    );
    renderFeeRecordsFromData(results[2].data || [], "admin-student-fees", client);
    renderAdminHouseControls(client, results[3].data || [], houses);
    renderAdminStaffDetails(client, results[4].data || []);

    var tbody = document.getElementById("admin-profiles");
    tbody.replaceChildren();
    profiles.forEach(function (profile) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      var email = document.createElement("td");
      var role = document.createElement("td");
      var actions = document.createElement("td");
      name.textContent = profile.full_name || "Name not provided";
      email.textContent = profile.email || "No email";
      role.textContent = profile.role || "Pending";
      row.append(name, email, role);

      if (profile.role !== "admin") {
        ["student", "staff"].forEach(function (assignedRole) {
          var button = document.createElement("button");
          button.className = "btn btn-outline";
          button.type = "button";
          button.textContent = "Set " + (assignedRole === "student" ? "Student" : "Staff");
          button.disabled = profile.role === assignedRole;
          button.addEventListener("click", async function () {
            button.disabled = true;
            var assignment;
            try {
              assignment = await client.rpc("admin_assign_profile_role", {
                target_user_id: profile.id,
                target_role: assignedRole
              });
            } catch (error) {
              button.disabled = false;
              showAlert(
                document.getElementById("portal-data-alert"),
                "The role could not be assigned. Check your connection and try again.",
                "error"
              );
              return;
            }
            if (assignment.error) {
              button.disabled = false;
              showAlert(
                document.getElementById("portal-data-alert"),
                "The role could not be assigned. Refresh the page and try again.",
                "error"
              );
              return;
            }
            showAlert(
              document.getElementById("portal-data-alert"),
              "Portal role updated successfully.",
              "success"
            );
            try {
              await loadAdminDashboard(client);
            } catch (error) {
              showAlert(
                document.getElementById("portal-data-alert"),
                "The role was assigned, but the account list could not be refreshed. Reload the page.",
                "error"
              );
            }
          });
          actions.appendChild(button);
        });
      } else {
        actions.textContent = "—";
      }

      row.appendChild(actions);
      tbody.appendChild(row);
    });
    if (!profiles.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 4;
      emptyCell.textContent = "No portal accounts have been invited yet.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }
    await loadAdminAcademicData(client);
  }

  function renderAdminStaffDetails(client, staff) {
    var tbody = document.getElementById("admin-staff-details");
    tbody.replaceChildren();
    if (!staff.length) {
      appendMessageRow(tbody, 4, "No staff accounts are available.");
      return;
    }
    var titles = [
      "Teacher", "House Master", "House Mistress", "Head of Department",
      "Assistant Head", "Headteacher", "Non-Teaching Staff"
    ];
    var departments = [
      "MATHS/ICT", "SCIENCE", "ENGLISH", "BUSINESS", "TECHNICAL", "HOME ECONOMICS"
    ];
    staff.forEach(function (member) {
      var row = document.createElement("tr");
      var identity = document.createElement("td");
      var titleCell = document.createElement("td");
      var departmentCell = document.createElement("td");
      var actionCell = document.createElement("td");
      var titleSelect = document.createElement("select");
      titleSelect.multiple = true;
      titleSelect.size = 4;
      titleSelect.setAttribute("aria-label", "Job titles for " + (member.full_name || "staff member"));
      var departmentSelect = document.createElement("select");
      var save = document.createElement("button");
      identity.textContent = (member.full_name || "Staff member") + " — " + member.email;

      titles.forEach(function (title) {
        var option = document.createElement("option");
        option.value = title;
        option.textContent = title;
        titleSelect.appendChild(option);
      });
      var selectedTitles = String(member.job_title || "").split(",").map(function (title) {
        return title.trim();
      });
      Array.from(titleSelect.options).forEach(function (option) {
        option.selected = selectedTitles.indexOf(option.value) !== -1;
      });

      var departmentPlaceholder = document.createElement("option");
      departmentPlaceholder.value = "";
      departmentPlaceholder.textContent = "No department";
      departmentSelect.appendChild(departmentPlaceholder);
      departments.forEach(function (department) {
        var option = document.createElement("option");
        option.value = department;
        option.textContent = department;
        departmentSelect.appendChild(option);
      });
      departmentSelect.value = member.department || "";
      save.className = "btn btn-outline";
      save.type = "button";
      save.textContent = "Save";
      save.addEventListener("click", async function () {
        save.disabled = true;
        try {
          var update = await client.rpc("admin_update_staff_details", {
            target_staff_id: member.id,
            target_position: Array.from(titleSelect.selectedOptions).map(function (option) {
              return option.value;
            }).join(", "),
            target_department: departmentSelect.value
          });
          if (update.error) throw update.error;
          showAlert(document.getElementById("portal-data-alert"), "Staff job details updated.", "success");
          await loadAdminDashboard(client);
        } catch (error) {
          save.disabled = false;
          showAlert(document.getElementById("portal-data-alert"), "Staff details could not be updated. Choose a valid job title and try again.", "error");
        }
      });
      titleCell.appendChild(titleSelect);
      departmentCell.appendChild(departmentSelect);
      actionCell.appendChild(save);
      row.append(identity, titleCell, departmentCell, actionCell);
      tbody.appendChild(row);
    });
  }

  function bindAdminAcademicForm(client, formId, rpcName, argsFactory) {
    var form = document.getElementById(formId);
    if (!form || form.dataset.academicBound) return;
    form.dataset.academicBound = "true";
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        var result = await client.rpc(rpcName, argsFactory(form));
        if (result.error) throw result.error;
        form.reset();
        showAlert(document.getElementById("admin-academic-status"), "Academic information saved.", "success");
      } catch (error) {
        showAlert(
          document.getElementById("admin-academic-status"),
          "Academic information could not be saved. Check the values and your access, then try again.",
          "error"
        );
        button.disabled = false;
        return;
      }
      try {
        await loadAdminAcademicData(client);
      } catch (error) {
        showAlert(document.getElementById("admin-academic-status"), "Academic information was saved, but the lists could not be refreshed. Reload the page.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadAdminAcademicData(client) {
    var result = await client.rpc("admin_list_academic_data");
    if (result.error) throw result.error;
    var data = result.data || {};
    var years = data.years || [];
    var programmes = data.programmes || [];
    var classes = data.classes || [];
    var departments = data.departments || [];
    var subjects = data.subjects || [];
    var students = data.students || [];
    var staff = data.staff || [];

    setSelectOptions(document.getElementById("admin-academic-term-year"), years, "Choose a year", "id", function (item) {
      return item.name + (item.is_current ? " (current)" : "");
    });
    setSelectOptions(document.getElementById("admin-academic-enrol-year"), years, "Choose a year", "id", function (item) {
      return item.name + (item.is_current ? " (current)" : "");
    });
    setSelectOptions(document.getElementById("admin-student-import-year"), years, "Choose an academic year", "name", function (item) {
      return item.name + (item.is_current ? " (current)" : "");
    });
    setSelectOptions(document.getElementById("admin-academic-class-programme"), programmes, "Choose a programme", "id", function (item) {
      return item.name;
    });
    setSelectOptions(document.getElementById("admin-academic-enrol-class"), classes, "Choose a class", "id", function (item) {
      return item.name + " — " + item.programme;
    });
    setSelectOptions(document.getElementById("admin-academic-allocation-class"), classes, "Choose a class", "id", function (item) {
      return item.name + " — " + item.programme;
    });
    setSelectOptions(document.getElementById("admin-academic-allocation-subject"), subjects, "Choose a subject", "id", function (item) {
      return (item.code ? item.name + " (" + item.code + ")" : item.name) +
        (item.department ? " — " + item.department : "");
    });
    setSelectOptions(document.getElementById("admin-academic-subject-department"), departments, "No department", "id", function (item) {
      return item.name;
    });
    setSelectOptions(document.getElementById("admin-academic-allocation-year"), years, "Choose a year", "id", function (item) {
      return item.name + (item.is_current ? " (current)" : "");
    });
    setSelectOptions(document.getElementById("admin-academic-student"), students, "Choose a student", "id", function (item) {
      return item.index_number ? item.full_name + " — " + item.index_number : item.full_name || "Student";
    });
    setSelectOptions(document.getElementById("admin-academic-allocation-teacher"), staff, "Unassigned", "id", function (item) {
      return item.full_name || "Staff member";
    });

    var structure = document.getElementById("admin-academic-structure");
    structure.replaceChildren();
    if (!(data.allocations || []).length) {
      appendMessageRow(structure, 4, "No class, subject, and teacher allocations are set up yet.");
    } else {
      data.allocations.forEach(function (item) {
        appendTableRow(structure, [
          item.year_name,
          item.programme + " — " + item.class_name,
          item.subject_name,
          item.teacher_name || "Unassigned"
        ]);
      });
    }

    renderAdminAcademicAssessments(client, data.assessments || []);
    bindAdminAcademicForm(client, "admin-academic-year-form", "admin_save_academic_year", function () {
      return {
        target_name: document.getElementById("admin-academic-year-name").value,
        target_starts_on: document.getElementById("admin-academic-year-start").value,
        target_ends_on: document.getElementById("admin-academic-year-end").value,
        target_is_current: document.getElementById("admin-academic-year-current").checked
      };
    });
    bindAdminAcademicForm(client, "admin-academic-term-form", "admin_save_academic_term", function () {
      return {
        target_year_id: document.getElementById("admin-academic-term-year").value,
        target_name: document.getElementById("admin-academic-term-name").value,
        target_sequence_no: Number(document.getElementById("admin-academic-term-sequence").value),
        target_starts_on: document.getElementById("admin-academic-term-start").value,
        target_ends_on: document.getElementById("admin-academic-term-end").value,
        target_is_current: document.getElementById("admin-academic-term-current").checked
      };
    });
    bindAdminAcademicForm(client, "admin-academic-programme-form", "admin_save_academic_programme", function () {
      return { target_name: document.getElementById("admin-academic-programme-name").value };
    });
    bindAdminAcademicForm(client, "admin-academic-class-form", "admin_save_academic_class", function () {
      return {
        target_name: document.getElementById("admin-academic-class-name").value,
        target_programme_id: document.getElementById("admin-academic-class-programme").value
      };
    });
    bindAdminAcademicForm(client, "admin-academic-subject-form", "admin_save_academic_subject", function () {
      return {
        target_name: document.getElementById("admin-academic-subject-name").value,
        target_code: document.getElementById("admin-academic-subject-code").value,
        target_department_id: document.getElementById("admin-academic-subject-department").value || null
      };
    });
    bindAdminAcademicForm(client, "admin-academic-department-form", "admin_save_academic_department", function () {
      return { target_name: document.getElementById("admin-academic-department-name").value };
    });
    bindAdminAcademicForm(client, "admin-academic-enrolment-form", "admin_assign_student_class", function () {
      return {
        target_student_id: document.getElementById("admin-academic-student").value,
        target_class_id: document.getElementById("admin-academic-enrol-class").value,
        target_year_id: document.getElementById("admin-academic-enrol-year").value
      };
    });
    bindAdminAcademicForm(client, "admin-academic-allocation-form", "admin_assign_class_subject", function () {
      return {
        target_class_id: document.getElementById("admin-academic-allocation-class").value,
        target_subject_id: document.getElementById("admin-academic-allocation-subject").value,
        target_year_id: document.getElementById("admin-academic-allocation-year").value,
        target_teacher_id: document.getElementById("admin-academic-allocation-teacher").value || null
      };
    });
  }

  function renderAdminAcademicAssessments(client, assessments) {
    var tbody = document.getElementById("admin-academic-assessments");
    tbody.replaceChildren();
    if (!assessments.length) {
      appendMessageRow(tbody, 5, "No assessments have been submitted for review.");
      return;
    }
    assessments.forEach(function (assessment) {
      var row = document.createElement("tr");
      [assessment.year_name + " · " + assessment.term_name, assessment.class_name,
        assessment.subject_name, assessment.title].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value || "—";
        row.appendChild(cell);
      });
      var actionCell = document.createElement("td");
      actionCell.textContent = assessment.status;
      if (assessment.status === "submitted") {
        var button = document.createElement("button");
        button.className = "btn btn-primary";
        button.type = "button";
        button.textContent = "Publish results";
        button.addEventListener("click", async function () {
          button.disabled = true;
          try {
            var publish = await client.rpc("admin_publish_academic_assessment", {
              target_assessment_id: assessment.id
            });
            if (publish.error) throw publish.error;
          } catch (error) {
            button.disabled = false;
            showAlert(document.getElementById("admin-academic-status"), "Results could not be published. Refresh and try again.", "error");
            return;
          }
          showAlert(document.getElementById("admin-academic-status"), "Results published to enrolled students.", "success");
          try {
            await loadAdminAcademicData(client);
          } catch (error) {
            showAlert(document.getElementById("admin-academic-status"), "Results were published, but the assessment list could not be refreshed.", "error");
          }
        });
        actionCell.replaceChildren(button);
      }
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }

  function appendTableRow(tbody, values) {
    var row = document.createElement("tr");
    values.forEach(function (value) {
      var cell = document.createElement("td");
      cell.textContent = value || "—";
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  }

  function appendMessageRow(tbody, columnCount, message) {
    var row = document.createElement("tr");
    var cell = document.createElement("td");
    cell.colSpan = columnCount;
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function renderFeeRecordsFromData(records, tbodyId, client) {
    var tbody = document.getElementById(tbodyId);
    tbody.replaceChildren();
    if (!records.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 4;
      emptyCell.textContent = "No student fee records are available.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    records.forEach(function (record) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      var house = document.createElement("td");
      var status = document.createElement("td");
      var actions = document.createElement("td");
      var input = document.createElement("input");
      var button = document.createElement("button");
      name.textContent = record.full_name || "Name not provided";
      house.textContent = record.house_name || "No house assigned";
      input.type = "text";
      input.maxLength = 120;
      input.value = record.fees_status || "";
      input.placeholder = "Not set";
      input.setAttribute("aria-label", "Fee status for " + (record.full_name || "student"));
      button.className = "btn btn-outline";
      button.type = "button";
      button.textContent = "Save";
      button.addEventListener("click", async function () {
        button.disabled = true;
        try {
          var update = await client.rpc("update_student_fee_status", {
            target_student_id: record.student_id,
            next_status: input.value
          });
          if (update.error) throw update.error;
          showAlert(
            document.getElementById("portal-data-alert"),
            "Fee status saved. The student's dashboard will update automatically.",
            "success"
          );
        } catch (error) {
          button.disabled = false;
          showAlert(
            document.getElementById("portal-data-alert"),
            "The fee status could not be saved. Check the value and try again.",
            "error"
          );
        }
      });
      status.appendChild(input);
      actions.appendChild(button);
      row.append(name, house, status, actions);
      tbody.appendChild(row);
    });
  }

  function renderAdminHouseControls(client, assignablePeople, houses) {
    var personSelect = document.getElementById("admin-house-person");
    var houseSelect = document.getElementById("admin-house-select");
    personSelect.replaceChildren();
    houseSelect.replaceChildren();

    var personPlaceholder = document.createElement("option");
    personPlaceholder.value = "";
    personPlaceholder.textContent = "Choose a student or House Master";
    personPlaceholder.disabled = true;
    personPlaceholder.selected = true;
    personSelect.appendChild(personPlaceholder);
    assignablePeople.forEach(function (profile) {
      var option = document.createElement("option");
      option.value = profile.id;
      option.textContent = (profile.role === "staff" ? profile.job_title + " — " : "Student — ") +
        (profile.full_name || profile.email || profile.id);
      personSelect.appendChild(option);
    });

    var housePlaceholder = document.createElement("option");
    housePlaceholder.value = "";
    housePlaceholder.textContent = "Choose a house";
    housePlaceholder.disabled = true;
    housePlaceholder.selected = true;
    houseSelect.appendChild(housePlaceholder);
    houses.forEach(function (house) {
      var option = document.createElement("option");
      option.value = house.id;
      option.textContent = house.name;
      houseSelect.appendChild(option);
    });

    var houseForm = document.getElementById("admin-house-form");
    if (houseForm.dataset.handlerBound) return;
    houseForm.dataset.handlerBound = "true";
    houseForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = houseForm.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        var result = await client.rpc("admin_save_house", {
          target_name: document.getElementById("admin-house-name").value
        });
        if (result.error) throw result.error;
        houseForm.reset();
        showAlert(
          document.getElementById("admin-house-status"),
          "House created.",
          "success"
        );
        await loadAdminDashboard(client);
      } catch (error) {
        showAlert(
          document.getElementById("admin-house-status"),
          "House could not be created. Check that its name is unique and try again.",
          "error"
        );
      } finally {
        button.disabled = false;
      }
    });

    var assignmentForm = document.getElementById("admin-house-assignment-form");
    if (assignmentForm.dataset.handlerBound) return;
    assignmentForm.dataset.handlerBound = "true";
    assignmentForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = assignmentForm.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        var result = await client.rpc("admin_assign_person_to_house", {
          target_user_id: personSelect.value,
          target_house_id: houseSelect.value
        });
        if (result.error) throw result.error;
        showAlert(
          document.getElementById("admin-house-status"),
          "House assignment saved.",
          "success"
        );
        await loadAdminDashboard(client);
      } catch (error) {
        showAlert(
          document.getElementById("admin-house-status"),
          "House assignment could not be saved. Refresh the page and try again.",
          "error"
        );
      } finally {
        button.disabled = false;
      }
    });
  }

  function initializeStaffInvite(client) {
    var form = document.getElementById("admin-staff-form");
    var status = document.getElementById("admin-staff-status");
    if (!form) return;
    var passwordInput = document.getElementById("admin-staff-password");
    var showPassword = document.getElementById("admin-staff-show-password");
    showPassword.addEventListener("change", function () {
      passwordInput.type = showPassword.checked ? "text" : "password";
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      var data = new FormData(form);
      var temporaryPassword = String(data.get("temporary_password") || "");
      button.disabled = true;
      showAlert(status, "Creating the Staff Portal account…", "success");

      try {
        var result = await client.functions.invoke("invite-staff", {
          body: {
            full_name: String(data.get("full_name") || "").trim(),
            email: String(data.get("email") || "").trim().toLowerCase(),
            position: data.getAll("position").map(function (position) {
              return String(position).trim();
            }),
            department: String(data.get("department") || "").trim(),
            temporary_password: temporaryPassword
          }
        });
        if (result.error) throw result.error;

        showAlert(
          status,
          "Staff account created in Supabase Auth. Share the temporary password privately; the staff member should change it after signing in.",
          "success"
        );
        form.reset();
        passwordInput.type = "password";
        passwordInput.value = temporaryPassword;
        try {
          await loadAdminDashboard(client);
        } catch (error) {
          showAlert(
            status,
            "Staff account created, but the account list could not be refreshed. Reload the page; share the temporary password privately.",
            "error"
          );
        }
      } catch (error) {
        showAlert(
          status,
          error && error.message
            ? "The staff account could not be created: " + error.message
            : "The staff account could not be created. Check the email address and Edge Function setup, then try again.",
          "error"
        );
      } finally {
        button.disabled = false;
      }
    });
  }

  function initializePasswordChange(client, formId, statusId) {
    var form = document.getElementById(formId);
    if (!form) return;
    var status = document.getElementById(statusId);
    var prefix = formId === "student-password-form" ? "student" : "staff";

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var password = document.getElementById(prefix + "-new-password").value;
      var confirmation = document.getElementById(prefix + "-confirm-password").value;
      if (password.length < 10) {
        showAlert(status, "Your new password must contain at least 10 characters.", "error");
        return;
      }
      if (password !== confirmation) {
        showAlert(status, "The new passwords do not match.", "error");
        return;
      }

      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      showAlert(status, "Updating your password…", "success");
      try {
        var result = await client.auth.updateUser({ password: password });
        if (result.error) throw result.error;
        form.reset();
        showAlert(status, "Password changed. Keep it private.", "success");
      } catch (error) {
        showAlert(status, "Your password could not be changed. Check your connection and try again.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function parseDelimitedLine(line, delimiter) {
    var values = [];
    var value = "";
    var quoted = false;
    for (var index = 0; index < line.length; index += 1) {
      var character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === delimiter && !quoted) {
        values.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    if (quoted) throw new Error("A roster row contains an unmatched quotation mark.");
    values.push(value.trim());
    return values;
  }

  function parseStudentRoster(text) {
    var lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (line) {
      return line.trim() !== "";
    });
    if (lines.length < 2) throw new Error("Paste the header and at least one student row.");

    var delimiter = lines[0].indexOf("\t") !== -1 ? "\t" : ",";
    var headers = parseDelimitedLine(lines[0], delimiter).map(function (header) {
      return header.toLowerCase().replace(/[^a-z0-9]/g, "");
    });
    var columnIndexes = {
      school_code: headers.indexOf("schoolcode"),
      full_name: headers.indexOf("name"),
      index_number: headers.indexOf("cassrefid"),
      learning_area: headers.indexOf("learningarea"),
      year_of_entry: headers.indexOf("yearofentry")
    };
    if (Object.keys(columnIndexes).some(function (key) { return columnIndexes[key] < 0; })) {
      throw new Error("Required columns are School Code, Name, CassRefID, LEARNING_AREA, and YearOfEntry.");
    }

    return lines.slice(1).map(function (line, index) {
      var values = parseDelimitedLine(line, delimiter);
      if (values.length !== headers.length) {
        throw new Error("Roster row " + (index + 2) + " does not have the same number of columns as the header.");
      }
      var student = {};
      Object.keys(columnIndexes).forEach(function (key) {
        student[key] = values[columnIndexes[key]];
      });
      return student;
    });
  }

  function csvCell(value) {
    var text = String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function downloadStudentCredentials(credentials, academicYear) {
    var header = ["CassRefID", "Name", "Temporary password"];
    var rows = credentials.map(function (credential) {
      return [
        csvCell(credential.index_number),
        csvCell(credential.full_name),
        csvCell(credential.temporary_password)
      ].join(",");
    });
    var content = "\uFEFF" + [header.map(csvCell).join(",")].concat(rows).join("\r\n");
    var blobUrl = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    var link = document.createElement("a");
    link.href = blobUrl;
    link.download = "afastech-shs3-credentials-" + academicYear.replace(/[^0-9]/g, "-") + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
  }

  function initializeStudentImport(client) {
    var form = document.getElementById("admin-student-import-form");
    if (!form) return;
    var status = document.getElementById("admin-student-import-status");
    var rosterInput = document.getElementById("admin-student-import-data");
    var fileInput = document.getElementById("admin-student-import-file");
    var downloadButton = document.getElementById("admin-student-import-download");
    var pendingCredentials = [];
    var pendingYear = "";

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        showAlert(status, "Roster file must be smaller than 1 MB.", "error");
        fileInput.value = "";
        return;
      }
      var reader = new FileReader();
      reader.addEventListener("load", function () {
        rosterInput.value = String(reader.result || "");
        showAlert(status, "Roster loaded. Review it before creating accounts.", "success");
      });
      reader.addEventListener("error", function () {
        showAlert(status, "Roster file could not be read. Try pasting its contents instead.", "error");
      });
      reader.readAsText(file);
    });

    downloadButton.addEventListener("click", function () {
      if (!pendingCredentials.length) return;
      downloadStudentCredentials(pendingCredentials, pendingYear);
      pendingCredentials = [];
      pendingYear = "";
      downloadButton.hidden = true;
      showAlert(status, "Credential file downloaded. Keep it private; the passwords cannot be retrieved from the portal again.", "success");
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (pendingCredentials.length) {
        showAlert(status, "Download the previous credential file before starting another import.", "error");
        return;
      }
      var academicYear = document.getElementById("admin-student-import-year").value;
      var makeCurrent = document.getElementById("admin-student-import-current").checked;
      var students;
      try {
        students = parseStudentRoster(rosterInput.value);
      } catch (error) {
        showAlert(status, error.message, "error");
        return;
      }
      if (students.length > 500) {
        showAlert(status, "Import no more than 500 students at a time.", "error");
        return;
      }
      if (!academicYear) {
        showAlert(status, "Choose an academic year before importing.", "error");
        return;
      }
      var confirmed = window.confirm(
        "Create " + students.length + " SHS 3 student accounts for " + academicYear +
        " and generate a different temporary password for each student? The credentials will be downloadable only once."
      );
      if (!confirmed) return;

      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      showAlert(status, "Creating student accounts and academic enrolments…", "success");
      try {
        var result = await client.functions.invoke("import-student-roster", {
          body: {
            academic_year: academicYear,
            class_name: "SHS 3",
            make_current: makeCurrent,
            students: students
          }
        });
        if (result.error || !result.data || !Array.isArray(result.data.credentials)) {
          var functionMessage = result.data && result.data.error;
          throw new Error(functionMessage || "Student roster import failed. No credentials were issued.");
        }
        pendingCredentials = result.data.credentials;
        pendingYear = result.data.academic_year;
        rosterInput.value = "";
        fileInput.value = "";
        downloadButton.hidden = false;
        showAlert(
          status,
          result.data.imported + " students were registered and enrolled in " +
            result.data.class_name + " for " + result.data.academic_year +
            ". Download the one-time credential file now.",
          "success"
        );
        try {
          await loadAdminDashboard(client);
        } catch (refreshError) {
          showAlert(
            status,
            "Students were imported, but the dashboard could not refresh. Download the credentials, then reload the page.",
            "error"
          );
        }
      } catch (error) {
        showAlert(status, error.message || "Student roster import failed. Check the roster and try again.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function watchStudentFeeChanges(client, studentId) {
    client
      .channel("student-fees-" + studentId)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
      table: "student_details",
      filter: "profile_id=eq." + studentId
      }, function (payload) {
        var fees = document.querySelector("[data-student-fees]");
        if (fees) fees.textContent = payload.new.fees_status || "Not set";
      })
      .subscribe(function (status) {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          showAlert(
            document.getElementById("portal-data-alert"),
            "Live fee updates are unavailable. Refresh the dashboard to see the latest status.",
            "error"
          );
        }
      });
  }

  function initializeStudentNavigation() {
    var layout = document.querySelector(".student-portal-layout");
    var toggle = document.querySelector(".student-sidebar-toggle");
    var backdrop = document.querySelector(".student-sidebar-backdrop");
    if (!layout || !toggle || !backdrop) return;

    function closeMenu() {
      layout.classList.remove("is-sidebar-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open student portal menu");
    }

    toggle.addEventListener("click", function () {
      var isOpen = layout.classList.toggle("is-sidebar-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close student portal menu" : "Open student portal menu");
    });
    backdrop.addEventListener("click", closeMenu);
    layout.querySelectorAll(".student-portal-nav a").forEach(function (link) {
      link.addEventListener("click", function () {
        layout.querySelectorAll(".student-portal-nav a").forEach(function (item) {
          item.classList.remove("is-current");
          item.removeAttribute("aria-current");
        });
        link.classList.add("is-current");
        link.setAttribute("aria-current", "page");
        closeMenu();
      });
    });
  }

  function renderAnnouncements(announcements) {
    var list = document.getElementById("portal-announcements");
    if (!list) return;
    list.replaceChildren();

    if (!announcements.length) {
      showEmptyState(list, "No current announcements.");
      return;
    }

    announcements.forEach(function (announcement) {
      var article = document.createElement("article");
      article.className = "card";
      article.style.marginBottom = "1rem";
      var heading = document.createElement("h4");
      heading.textContent = announcement.title;
      var body = document.createElement("p");
      body.style.color = "var(--stone)";
      body.textContent = announcement.body;
      article.append(heading, body);
      list.appendChild(article);
    });
  }

  function watchSignOut(client, requiredRole) {
    var signOut = document.querySelector("[data-portal-signout]");
    if (!signOut) return;

    signOut.addEventListener("click", async function (event) {
      event.preventDefault();
      signOut.setAttribute("aria-disabled", "true");
      await client.auth.signOut({ scope: "local" });
      window.location.replace(LOGIN_PAGES[requiredRole]);
    });
  }

  async function initializeLogin(client, loginForm) {
    var alertBox = document.getElementById("portal-alert");
    var portalType = loginForm.getAttribute("data-portal");
    if (!client) {
      showSetupError(alertBox);
      loginForm.addEventListener("submit", function (event) { event.preventDefault(); showSetupError(alertBox); });
      return;
    }

    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var submitButton = loginForm.querySelector("button[type='submit']");
      var identifier = loginForm.querySelector("#portalId").value.trim();
      var email = identifier.toLowerCase();
      if (portalType === "student" && identifier.indexOf("@") === -1) {
        var normalizedIndex = identifier.toUpperCase();
        if (!/^[A-Z0-9]{12}$/.test(normalizedIndex)) {
          showAlert(alertBox, "Enter a valid CassRefID or school email address.", "error");
          return;
        }
        email = "refid-" + normalizedIndex.toLowerCase() + "@" + STUDENT_LOGIN_DOMAIN;
      }
      var password = loginForm.querySelector("#portalPass").value;
      submitButton.disabled = true;
      showAlert(alertBox, "Signing in…", "success");

      var signIn;
      try {
        signIn = await client.auth.signInWithPassword({ email: email, password: password });
      } catch (error) {
        showAlert(alertBox, "The sign-in service is unavailable. Please try again later.", "error");
        submitButton.disabled = false;
        return;
      }
      if (signIn.error) {
        showAlert(alertBox, "Sign-in failed. Check your email and password, then try again.", "error");
        submitButton.disabled = false;
        return;
      }

      try {
        var profile = await getProfile(client, signIn.data.user.id);
        if (!profile || !profile.role) {
          await client.auth.signOut({ scope: "local" });
          showAlert(alertBox, "This account is awaiting portal access. Contact the school administrator.", "error");
        } else if (profile.role !== portalType) {
          await client.auth.signOut({ scope: "local" });
          showAlert(alertBox, "This account is not authorized for this portal.", "error");
        } else {
          showAlert(alertBox, "Signed in. Opening your dashboard…", "success");
          window.location.replace(DASHBOARD_PAGES[portalType]);
        }
      } catch (error) {
        await client.auth.signOut({ scope: "local" });
        showAlert(alertBox, "We could not verify this account. Contact the site administrator.", "error");
      }
      submitButton.disabled = false;
    });
  }

  async function initializeDashboard(client, page) {
    var requiredRole = page === "staff-dashboard" ? "staff" : page === "admin-dashboard" ? "admin" : "student";
    var alertBox = document.getElementById("portal-data-alert");
    if (!client) {
      window.location.replace(LOGIN_PAGES[requiredRole]);
      return;
    }

    watchSignOut(client, requiredRole);
    client.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") window.location.replace(LOGIN_PAGES[requiredRole]);
    });

    var sessionResult = await client.auth.getSession();
    var session = sessionResult.data && sessionResult.data.session;
    if (sessionResult.error || !session) {
      window.location.replace(LOGIN_PAGES[requiredRole]);
      return;
    }

    try {
      var profile = await getProfile(client, session.user.id);
      if (!profile || !profile.role) {
        await client.auth.signOut({ scope: "local" });
        window.location.replace(LOGIN_PAGES[requiredRole]);
        return;
      }
      if (profile.role !== requiredRole) {
        window.location.replace(DASHBOARD_PAGES[profile.role]);
        return;
      }

      setProfileName(profile, session.user.email);
      document.querySelector("[data-dashboard-content]").hidden = false;
      if (requiredRole === "student") {
        await loadStudentDashboard(client, session.user.id);
        watchStudentFeeChanges(client, session.user.id);
        initializePasswordChange(client, "student-password-form", "student-password-status");
      }
      else if (requiredRole === "staff") {
        await loadStaffDashboard(client, session.user.id);
        initializePasswordChange(client, "staff-password-form", "staff-password-status");
      }
      else {
        await loadAdminDashboard(client);
        initializeStaffInvite(client);
        initializeStudentImport(client);
      }
    } catch (error) {
      showAlert(alertBox, "Portal data could not be loaded. Please refresh or contact the site administrator.", "error");
    }
  }

  var loginForm = document.getElementById("portal-login");
  var client = createClient();
  if (loginForm) initializeLogin(client, loginForm);

  var page = document.body.getAttribute("data-page");
  if (page === "student-dashboard") initializeStudentNavigation();
  if (page === "student-dashboard" || page === "staff-dashboard" || page === "admin-dashboard") initializeDashboard(client, page);
})();
