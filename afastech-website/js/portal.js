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
    var avatar = document.querySelector("[data-portal-avatar]");
    if (avatar) avatar.textContent = (fullName || email || "U").trim().charAt(0).toUpperCase();
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
      client.rpc("student_list_my_academic_subjects"),
      client.rpc("student_list_my_transcript_entries")
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
      document.querySelector("[data-student-form-class]").textContent = (record.form_class || "").replace(/^SHS\s*/, "Year ") || "Not set";
      document.querySelector("[data-student-fees]").textContent = record.fees_status || "Not set";
      document.querySelector("[data-student-personal-index]").textContent = record.index_number || "Not set";
      document.querySelector("[data-student-personal-class]").textContent = (record.form_class || "").replace(/^SHS\s*/, "Year ") || "Not set";
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
    renderRows(document.getElementById("student-transcripts"), results[5].data || [], [
      function (row) { return "Year " + row.year_level; },
      function (row) { return "Semester " + row.semester_no; },
      function (row) { return row.subject_name; },
      function (row) { return row.grade_point_average == null ? "—" : String(row.grade_point_average); },
      function (row) { return row.final_grade || "—"; }
    ]);
    renderAnnouncements(results[3].data || []);
    if (!record) showEmptyState(document.getElementById("student-data-status"), "Your school record has not been added yet.");
    if (!results[1].data.length) showEmptyState(document.getElementById("student-timetable-status"), "No timetable entries are available.");
    if (!results[2].data.length) showEmptyState(document.getElementById("student-results-status"), "No results are available.");
    if (!results[4].data.length) showEmptyState(document.getElementById("student-subjects-status"), "Your current class and subject enrolment has not been set up yet.");
    if (!results[5].data.length) showEmptyState(document.getElementById("student-transcripts-status"), "No published transcript records are available.");
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
    var houseFeesView = document.getElementById("view-house-fees");
    var houseFeesNav = document.getElementById("staff-house-nav");
    houseFeesView.dataset.viewDisabled = String(!houseFeeAccess.data);
    houseFeesNav.hidden = !houseFeeAccess.data;
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

    // Load assessment types
    var assessmentTypeSelect = document.getElementById("staff-academic-assessment-type");
    var weightingInput = document.getElementById("staff-academic-assessment-weighting");
    if (assessmentTypeSelect && !assessmentTypeSelect.dataset.atLoaded) {
      try {
        var atResult = await client.rpc("list_active_assessment_types");
        if (atResult.error) throw atResult.error;
        setSelectOptions(assessmentTypeSelect, atResult.data || [], "Choose assessment type", "id", function (item) {
          return item.name + " (" + item.short_code + ") \u2014 " + item.default_weighting + "% default";
        });
        assessmentTypeSelect.dataset.atLoaded = "true";
        // Auto-set weighting when type changes
        assessmentTypeSelect.addEventListener("change", function () {
          var selected = (atResult.data || []).find(function (item) { return item.id === assessmentTypeSelect.value; });
          if (selected && weightingInput) {
            weightingInput.value = selected.default_weighting;
          }
        });
      } catch (error) {
        console.warn("Could not load assessment types:", error);
      }
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
            target_max_score: Number(document.getElementById("staff-academic-assessment-max").value),
            target_assessment_type_id: assessmentTypeSelect ? assessmentTypeSelect.value : null,
            target_weighting: weightingInput ? Number(weightingInput.value) : 100
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
      client.rpc("admin_list_staff_details"),
      client.rpc("admin_list_student_details")
    ]);
    var rpcNames = [
      "admin_list_profiles", "admin_list_houses", "list_house_fee_records",
      "admin_list_house_assignable_people", "admin_list_staff_details", "admin_list_student_details"
    ];
    var failed = [];
    results.forEach(function (result, index) {
      if (!result.error) return;
      failed.push(rpcNames[index]);
      console.error("Admin dashboard query failed: " + rpcNames[index], result.error);
    });
    if (results[0].error) throw results[0].error;
    if (failed.length) {
      showAlert(
        document.getElementById("portal-data-alert"),
        "Some dashboard data could not be loaded (" + failed.join(", ") +
          "). Apply the latest Supabase migrations (supabase db push) and reload.",
        "error"
      );
    }

    var profiles = results[0].data || [];
    var houses = results[1].data || [];
    document.querySelector("[data-admin-total]").textContent = String(profiles.length);
    var staffTotal = String(profiles.filter(function (profile) { return profile.role === "staff"; }).length);
    var studentTotal = String(profiles.filter(function (profile) { return profile.role === "student"; }).length);
    [
      ["[data-admin-staff-count]", staffTotal],
      ["[data-report-staff]", staffTotal],
      ["[data-admin-student-count]", studentTotal],
      ["[data-report-students]", studentTotal]
    ].forEach(function (pair) {
      var el = document.querySelector(pair[0]);
      if (el) el.textContent = pair[1];
    });
    [
      ["fee records", function () { renderFeeRecordsFromData(results[2].data || [], "admin-student-fees", client); }],
      ["house controls", function () { renderAdminHouseControls(client, results[3].data || [], houses); }],
      ["staff details", function () { renderAdminStaffDetails(client, results[4].data || []); }],
      ["student records", function () {
        window.AfastechStudents.initAdmin(client);
        window.AfastechStudents.setRecords(results[5].data || []);
      }]
    ].forEach(function (step) {
      try { step[1](); } catch (error) {
        console.error("Admin dashboard section failed to render: " + step[0], error);
        showAlert(document.getElementById("portal-data-alert"),
          "The " + step[0] + " section could not be displayed (" + (error && error.message ? error.message : error) + ").", "error");
      }
    });

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
      var nameInput = document.createElement("input");
      var titleSelect = document.createElement("select");
      titleSelect.multiple = true;
      titleSelect.size = 4;
      titleSelect.required = true;
      titleSelect.setAttribute("aria-label", "Job titles for " + (member.full_name || "staff member"));
      var departmentSelect = document.createElement("select");
      var save = document.createElement("button");
      nameInput.type = "text";
      nameInput.maxLength = 120;
      nameInput.required = true;
      nameInput.value = member.full_name || "";
      nameInput.setAttribute("aria-label", "Name for " + (member.email || "staff member"));
      var emailLabel = document.createElement("small");
      emailLabel.textContent = member.email || "No email";
      identity.append(nameInput, emailLabel);

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
        if (!nameInput.reportValidity() || !titleSelect.reportValidity()) return;
        save.disabled = true;
        try {
          var update = await client.rpc("admin_update_staff_account_details", {
            target_staff_id: member.id,
            target_full_name: nameInput.value.trim(),
            target_position: Array.from(titleSelect.selectedOptions).map(function (option) {
              return option.value;
            }).join(", "),
            target_department: departmentSelect.value
          });
          if (update.error) throw update.error;
          showAlert(document.getElementById("portal-data-alert"), "Staff record saved to the database.", "success");
        } catch (error) {
          save.disabled = false;
          showAlert(document.getElementById("portal-data-alert"), "Staff record could not be saved. Check the name, job titles, department, and connection, then try again.", "error");
          return;
        }
        try {
          await loadAdminDashboard(client);
        } catch (error) {
          showAlert(document.getElementById("portal-data-alert"), "The staff record was saved, but the account list could not be refreshed. Reload the page.", "error");
        }
      });
      var reveal = document.createElement("button");
      reveal.className = "btn btn-outline";
      reveal.type = "button";
      reveal.textContent = "Show temp password";
      reveal.addEventListener("click", async function () {
        reveal.disabled = true;
        try {
          var pw = await client.rpc("admin_get_staff_temp_password", { target_staff_id: member.id });
          if (pw.error) throw pw.error;
          reveal.textContent = pw.data ? "Temp password: " + pw.data : "Password already changed";
        } catch (error) {
          reveal.textContent = "Could not load";
          reveal.disabled = false;
        }
      });
      nameInput.className = "admin-record-name";
      titleCell.appendChild(titleSelect);
      departmentCell.appendChild(departmentSelect);
      actionCell.append(save, reveal);
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
    var importYear = document.getElementById("admin-student-import-year");
    if (importYear && !importYear.value) {
      var preferred = years.filter(function (item) { return item.is_current; })[0] || (years.length === 1 ? years[0] : null);
      if (preferred) importYear.value = preferred.name;
    }
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
if (typeof window.initializeTranscriptImporter === "function") {
        window.initializeTranscriptImporter(client, students);
      }
      if (typeof window.initializeBatchResultImporter === "function") {
        window.initializeBatchResultImporter(client, data.assessments || []);
      }
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

    // Load assessment types
    await loadAdminAssessmentTypes(client);
    // Load grade scales
    await loadAdminGradeScales(client);
  }

  async function loadAdminAssessmentTypes(client) {
    var result = await client.rpc("admin_list_assessment_types");
    if (result.error) throw result.error;
    renderAdminAssessmentTypes(client, result.data || []);
  }

  async function loadAdminGradeScales(client) {
    var result = await client.rpc("admin_list_grade_scales");
    if (result.error) throw result.error;
    renderAdminGradeScales(client, result.data || []);
  }

  function renderAdminAssessmentTypes(client, types) {
    var tbody = document.getElementById("admin-assessment-type-list");
    if (!tbody) return;
    tbody.replaceChildren();

    var form = document.getElementById("admin-assessment-type-form");
    var status = document.getElementById("admin-at-status");
    if (form && !form.dataset.atBound) {
      form.dataset.atBound = "true";
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var button = form.querySelector("button[type='submit']");
        button.disabled = true;
        try {
          var saved = await client.rpc("admin_save_assessment_type", {
            target_name: document.getElementById("admin-at-name").value,
            target_short_code: document.getElementById("admin-at-code").value,
            target_description: document.getElementById("admin-at-description").value || null,
            target_default_weighting: Number(document.getElementById("admin-at-weighting").value),
            target_display_order: Number(document.getElementById("admin-at-order").value),
            target_is_active: document.getElementById("admin-at-active").checked
          });
          if (saved.error) throw saved.error;
          form.reset();
          document.getElementById("admin-at-active").checked = true;
          showAlert(status, "Assessment type saved.", "success");
        } catch (error) {
          showAlert(status, "Assessment type could not be saved. Check the values and try again.", "error");
          button.disabled = false;
          return;
        }
        try {
          await loadAdminAssessmentTypes(client);
        } catch (error) {
          showAlert(status, "Assessment type was saved, but the list could not be refreshed.", "error");
        } finally {
          button.disabled = false;
        }
      });
    }

    if (!types.length) {
      appendMessageRow(tbody, 7, "No assessment types defined yet.");
      return;
    }

    types.forEach(function (type) {
      var row = document.createElement("tr");
      [type.name, type.short_code, type.description || "—",
       type.default_weighting + "%", type.display_order,
       type.is_active ? "Yes" : "No"].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      var actionCell = document.createElement("td");
      var editBtn = document.createElement("button");
      editBtn.className = "btn btn-outline";
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        document.getElementById("admin-at-name").value = type.name;
        document.getElementById("admin-at-code").value = type.short_code;
        document.getElementById("admin-at-description").value = type.description || "";
        document.getElementById("admin-at-weighting").value = type.default_weighting;
        document.getElementById("admin-at-order").value = type.display_order;
        document.getElementById("admin-at-active").checked = type.is_active;
        document.getElementById("admin-at-name").focus();
        window.scrollTo({ top: form.offsetTop - 100, behavior: "smooth" });
      });
      actionCell.appendChild(editBtn);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }

  function renderAdminGradeScales(client, scales) {
    var host = document.getElementById("admin-grade-scale-list");
    if (!host) return;
    host.replaceChildren();

    var form = document.getElementById("admin-grade-scale-form");
    var status = document.getElementById("admin-gs-status");
    if (form && !form.dataset.gsBound) {
      form.dataset.gsBound = "true";
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var button = form.querySelector("button[type='submit']");
        button.disabled = true;
        try {
          var saved = await client.rpc("admin_save_grade_scale", {
            target_name: document.getElementById("admin-gs-name").value,
            target_description: document.getElementById("admin-gs-description").value || null,
            target_is_default: document.getElementById("admin-gs-default").checked,
            target_is_active: document.getElementById("admin-gs-active").checked
          });
          if (saved.error) throw saved.error;
          form.reset();
          document.getElementById("admin-gs-active").checked = true;
          showAlert(status, "Grade scale saved.", "success");
        } catch (error) {
          showAlert(status, "Grade scale could not be saved. Check the values and try again.", "error");
          button.disabled = false;
          return;
        }
        try {
          await loadAdminGradeScales(client);
        } catch (error) {
          showAlert(status, "Grade scale was saved, but the list could not be refreshed.", "error");
        } finally {
          button.disabled = false;
        }
      });
    }

    if (!scales.length) {
      var empty = document.createElement("p");
      empty.style.color = "var(--stone)";
      empty.textContent = "No grade scales defined yet.";
      host.appendChild(empty);
      return;
    }

    scales.forEach(function (scale) {
      var card = document.createElement("details");
      card.className = "card";
      card.style.marginBottom = "1rem";
      card.open = scale.is_default;

      var summary = document.createElement("summary");
      summary.style.cursor = "pointer";
      summary.innerHTML = "<strong>" + scale.name + "</strong>" +
        (scale.is_default ? ' <span style="color:var(--primary);">(default)</span>' : "") +
        (scale.is_active ? "" : ' <span style="color:var(--stone);">(inactive)</span>');
      if (scale.description) {
        summary.innerHTML += " — " + scale.description;
      }
      card.appendChild(summary);

      // Boundaries table
      var boundaries = scale.boundaries || [];
      var tableWrap = document.createElement("div");
      tableWrap.className = "student-table-wrap";
      tableWrap.style.marginTop = "1rem";
      var table = document.createElement("table");
      table.className = "student-data-table";
      var thead = document.createElement("thead");
      var headRow = document.createElement("tr");
      ["Grade", "Grade Point", "Min Score", "Max Score", "Description", "Order", "Action"].forEach(function (text) {
        var th = document.createElement("th");
        th.textContent = text;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      var tbody = document.createElement("tbody");

      if (!boundaries.length) {
        var emptyRow = document.createElement("tr");
        var emptyCell = document.createElement("td");
        emptyCell.colSpan = 7;
        emptyCell.style.textAlign = "center";
        emptyCell.style.color = "var(--stone)";
        emptyCell.textContent = "No boundaries defined. Add them below.";
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
      } else {
        boundaries.forEach(function (b) {
          var row = document.createElement("tr");
          [b.grade_letter, b.grade_point, b.min_score, b.max_score,
           b.description || "—", b.display_order].forEach(function (value) {
            var cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
          });
          var actionCell = document.createElement("td");
          var editBtn = document.createElement("button");
          editBtn.className = "btn btn-outline";
          editBtn.type = "button";
          editBtn.textContent = "Edit";
          editBtn.dataset.boundaryId = b.id;
          editBtn.addEventListener("click", function () {
            fillBoundaryForm(scale.id, b);
          });
          var delBtn = document.createElement("button");
          delBtn.className = "btn btn-outline";
          delBtn.type = "button";
          delBtn.textContent = "Delete";
          delBtn.style.marginLeft = "0.5rem";
          delBtn.dataset.boundaryId = b.id;
          delBtn.addEventListener("click", async function () {
            if (!confirm("Delete this grade boundary?")) return;
            delBtn.disabled = true;
            try {
              await client.rpc("admin_delete_grade_boundary", {
                target_boundary_id: b.id
              });
              showAlert(status, "Boundary deleted.", "success");
              await loadAdminGradeScales(client);
            } catch (error) {
              delBtn.disabled = false;
              showAlert(status, "Boundary could not be deleted.", "error");
            }
          });
          actionCell.appendChild(editBtn);
          actionCell.appendChild(delBtn);
          row.appendChild(actionCell);
          tbody.appendChild(row);
        });
      }

      table.append(thead, tbody);
      tableWrap.appendChild(table);
      card.appendChild(tableWrap);

      // Add boundary form
      var boundaryForm = document.createElement("form");
      boundaryForm.className = "card";
      boundaryForm.style.marginTop = "1rem";
      boundaryForm.style.padding = "1rem";
      boundaryForm.innerHTML = `
        <h4>Add or edit grade boundary</h4>
        <input type="hidden" id="gs-boundary-id" value="">
        <input type="hidden" id="gs-boundary-scale-id" value="${scale.id}">
        <div class="field"><label for="gs-grade-letter">Grade letter</label><input id="gs-grade-letter" maxlength="3" placeholder="A1" required></div>
        <div class="field"><label for="gs-grade-point">Grade point (0-10)</label><input id="gs-grade-point" type="number" min="0" max="10" step="0.01" placeholder="4.00" required></div>
        <div class="field"><label for="gs-min-score">Min score (0-100)</label><input id="gs-min-score" type="number" min="0" max="100" step="0.01" placeholder="80" required></div>
        <div class="field"><label for="gs-max-score">Max score (0-100)</label><input id="gs-max-score" type="number" min="0" max="100" step="0.01" placeholder="100" required></div>
        <div class="field"><label for="gs-description">Description (optional)</label><input id="gs-description" maxlength="255" placeholder="Excellent"></div>
        <div class="field"><label for="gs-display-order">Display order</label><input id="gs-display-order" type="number" min="0" step="1" value="0" required></div>
        <button class="btn btn-primary" type="submit">Save boundary</button>
      `;
      boundaryForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var button = boundaryForm.querySelector("button[type='submit']");
        button.disabled = true;
        var boundaryId = document.getElementById("gs-boundary-id").value;
        var scaleId = document.getElementById("gs-boundary-scale-id").value;
        try {
          await client.rpc("admin_save_grade_boundary", {
            target_grade_scale_id: scaleId,
            target_grade_letter: document.getElementById("gs-grade-letter").value,
            target_grade_point: Number(document.getElementById("gs-grade-point").value),
            target_min_score: Number(document.getElementById("gs-min-score").value),
            target_max_score: Number(document.getElementById("gs-max-score").value),
            target_description: document.getElementById("gs-description").value || null,
            target_display_order: Number(document.getElementById("gs-display-order").value)
          });
          boundaryForm.reset();
          document.getElementById("gs-boundary-id").value = "";
          showAlert(status, "Grade boundary saved.", "success");
        } catch (error) {
          showAlert(status, "Grade boundary could not be saved. Check the values and try again.", "error");
          button.disabled = false;
          return;
        }
        try {
          await loadAdminGradeScales(client);
        } catch (error) {
          showAlert(status, "Grade boundary was saved, but the list could not be refreshed.", "error");
        } finally {
          button.disabled = false;
        }
      });
      card.appendChild(boundaryForm);

      host.appendChild(card);
    });

    function fillBoundaryForm(scaleId, boundary) {
      document.getElementById("gs-boundary-id").value = boundary.id;
      document.getElementById("gs-boundary-scale-id").value = scaleId;
      document.getElementById("gs-grade-letter").value = boundary.grade_letter;
      document.getElementById("gs-grade-point").value = boundary.grade_point;
      document.getElementById("gs-min-score").value = boundary.min_score;
      document.getElementById("gs-max-score").value = boundary.max_score;
      document.getElementById("gs-description").value = boundary.description || "";
      document.getElementById("gs-display-order").value = boundary.display_order;
      document.getElementById("gs-grade-letter").focus();
      window.scrollTo({ top: document.getElementById("gs-grade-letter").offsetTop - 100, behavior: "smooth" });
    }
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
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      var data = new FormData(form);
      button.disabled = true;
      showAlert(status, "Creating the Staff Portal account…", "success");

      try {
        var result = await client.functions.invoke("create-staff", {
          body: {
            full_name: String(data.get("full_name") || "").trim(),
            email: String(data.get("email") || "").trim().toLowerCase(),
            department: String(data.get("department") || "").trim()
          }
        });
        if (result.error) {
          var detail = "";
          try {
            if (result.error.context && typeof result.error.context.text === "function") {
              var raw = await result.error.context.text();
              try { detail = JSON.parse(raw).error || raw; } catch (parseError) { detail = raw; }
            }
          } catch (readError) { detail = ""; }
          throw new Error(detail || result.error.message);
        }

        showAlert(
          status,
          "Staff account created. Temporary password: " + result.data.temporary_password +
            " (the staff member must change it at first sign-in; you can view it again in the staff table until then).",
          "success"
        );
        form.reset();
        try {
          await loadAdminDashboard(client);
        } catch (error) {
          showAlert(status, "Staff account created (temporary password: " + result.data.temporary_password + "), but the list could not be refreshed. Reload the page.", "error");
        }
      } catch (error) {
        showAlert(
          status,
          error && error.message
            ? "The staff account could not be created: " + error.message
            : "The staff account could not be created. Check the email address and try again.",
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
    function columnOf(aliases) {
      for (var i = 0; i < aliases.length; i += 1) {
        var found = headers.indexOf(aliases[i]);
        if (found >= 0) return found;
      }
      return -1;
    }
    var columnIndexes = {
      index_number: columnOf(["cassrefid"]),
      first_name: columnOf(["firstname"]),
      last_name: columnOf(["lastname", "surname"]),
      learning_area: columnOf(["learningarea"]),
      year_of_entry: columnOf(["yearofentry"])
    };
    var otherNamesIndex = columnOf(["othernames", "othername", "middlename", "middlenames"]);
    var dobIndex = columnOf(["dob", "dateofbirth", "birthdate"]);
    var missing = Object.keys(columnIndexes).filter(function (key) { return columnIndexes[key] < 0; });
    if (missing.length) {
      throw new Error("The file must have these columns: CassRefID, First Name, Other Names, Last Name, DOB, LEARNING_AREA, YearOfEntry.");
    }

    function normalizeDob(value, rowNumber) {
      var raw = String(value || "").trim();
      if (!raw) return "";
      var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
      var local = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(raw);
      var year, month, day;
      if (iso) { year = +iso[1]; month = +iso[2]; day = +iso[3]; }
      else if (local) { day = +local[1]; month = +local[2]; year = +local[3]; }
      else throw new Error("Roster row " + rowNumber + " has a date of birth that is not in YYYY-MM-DD or DD/MM/YYYY format.");
      var date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error("Roster row " + rowNumber + " has an invalid date of birth.");
      }
      return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    }

    return lines.slice(1).map(function (line, index) {
      var values = parseDelimitedLine(line, delimiter);
      if (values.length !== headers.length) {
        throw new Error("Roster row " + (index + 2) + " does not have the same number of columns as the header.");
      }
      var student = {
        school_code: "0071007",
        other_names: otherNamesIndex >= 0 ? values[otherNamesIndex] : "",
        date_of_birth: dobIndex >= 0 ? normalizeDob(values[dobIndex], index + 2) : ""
      };
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

  function downloadStudentCredentials(credentials, academicYear, className) {
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
    link.download = "afastech-" + className.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
      "-credentials-" + academicYear.replace(/[^0-9]/g, "-") + ".csv";
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
    var pendingClass = "";

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
      downloadStudentCredentials(pendingCredentials, pendingYear, pendingClass);
      pendingCredentials = [];
      pendingYear = "";
      pendingClass = "";
      downloadButton.hidden = true;
      showAlert(status, "Credential file downloaded. Keep it private; the passwords cannot be retrieved from the portal again.", "success");
    });

    async function createStudentAccounts(students, className, submitForm) {
      if (pendingCredentials.length) {
        showAlert(status, "Download the previous credential file before starting another import.", "error");
        return null;
      }
      var academicYear = document.getElementById("admin-student-import-year").value;
      var makeCurrent = document.getElementById("admin-student-import-current").checked;
      if (students.length > 500) {
        showAlert(status, "Create no more than 500 student accounts at a time.", "error");
        return null;
      }
      if (!academicYear) {
        showAlert(status, "Choose the Academic year (for example 2026/2027) at the top of this page. This is separate from the Year 1/2/3 choice. If the list is empty, add an academic year under Academics first.", "error");
        return null;
      }
      var confirmed = window.confirm(
        "Create " + students.length + " student account(s) in " + className + " for " + academicYear +
        " and generate a different temporary password for each student? The credentials will be downloadable only once."
      );
      if (!confirmed) return null;

      var importResult = null;
      var button = submitForm.querySelector("button[type='submit']");
      button.disabled = true;
      showAlert(status, "Creating student accounts and academic enrolments…", "success");
      try {
        var result = await client.functions.invoke("import-student-roster", {
          body: {
            academic_year: academicYear,
            class_name: className,
            make_current: makeCurrent,
            students: students
          }
        });
        if (result.error || !result.data || !Array.isArray(result.data.credentials)) {
          var functionMessage = result.data && result.data.error;
          throw new Error(functionMessage || "Student roster import failed. No credentials were issued.");
        }
        importResult = result.data;
        pendingCredentials = result.data.credentials;
        pendingYear = result.data.academic_year;
        pendingClass = result.data.class_name;
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
        showAlert(status, error.message || "Student account creation failed. Check the details and try again.", "error");
        return null;
      } finally {
        button.disabled = false;
      }
      return importResult;
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var students;
      try {
        students = parseStudentRoster(rosterInput.value);
      } catch (error) {
        showAlert(status, error.message, "error");
        return;
      }
      var className = document.getElementById("admin-student-import-class").value;
      if (!className) {
        showAlert(status, "Choose the class for this batch.", "error");
        return;
      }
      var imported = await createStudentAccounts(students, className, form);
      if (imported) {
        rosterInput.value = "";
        fileInput.value = "";
      }
    });

    var singleForm = document.getElementById("admin-student-single-form");
    singleForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      function field(id) { return document.getElementById(id).value.trim(); }
      var student = {
        school_code: "0071007",
        first_name: field("admin-student-single-first"),
        other_names: field("admin-student-single-other"),
        last_name: field("admin-student-single-last"),
        date_of_birth: field("admin-student-single-dob"),
        gender: field("admin-student-single-gender"),
        place_of_birth: field("admin-student-single-pob"),
        hometown: field("admin-student-single-hometown"),
        guardian_name: field("admin-student-single-guardian"),
        guardian_contact: field("admin-student-single-contact"),
        index_number: field("admin-student-single-index"),
        learning_area: field("admin-student-single-programme"),
        year_of_entry: document.getElementById("admin-student-single-entry-year").value
      };
      var className = document.getElementById("admin-student-single-class").value;
      if (!student.first_name || !student.last_name || !student.date_of_birth || !student.gender ||
        !student.index_number || !student.learning_area || !student.year_of_entry || !className) {
        showAlert(status, "Enter the first and last name, date of birth, gender, CassRefID, learning area, entry year, and class.", "error");
        return;
      }
      if (student.guardian_contact && !/^[0-9+ ()-]{7,30}$/.test(student.guardian_contact)) {
        showAlert(status, "Enter a valid guardian contact number.", "error");
        return;
      }
      var photoInput = document.getElementById("admin-student-single-photo");
      var photo = photoInput.files && photoInput.files[0];
      if (photo) {
        var photoProblem = window.AfastechStudents.validatePhoto(photo);
        if (photoProblem) {
          showAlert(status, photoProblem, "error");
          return;
        }
      }
      var imported = await createStudentAccounts([student], className, singleForm);
      if (!imported) return;
      var photoNote = "";
      if (photo && imported.credentials[0] && imported.credentials[0].profile_id) {
        try {
          await window.AfastechStudents.uploadPhoto(client, imported.credentials[0].profile_id, photo);
        } catch (photoError) {
          photoNote = " The photograph could not be uploaded (" + (photoError.message || "unknown error") +
            "); add it from the student's record.";
        }
      }
      singleForm.reset();
      if (photoNote) {
        showAlert(status, "Student created. Download the one-time credential file now." + photoNote, "error");
      }
      try { await loadAdminDashboard(client); } catch (refreshError) { /* the import already refreshed */ }
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

  var refreshDashboardData = null;
  var refreshing = false;

  async function runDashboardRefresh() {
    if (!refreshDashboardData || refreshing) return;
    refreshing = true;
    var content = document.querySelector("[data-dashboard-content]");
    if (content) content.setAttribute("aria-busy", "true");
    try {
      await refreshDashboardData();
    } catch (error) {
      console.error("Dashboard refresh failed.", error);
      if (error && /jwt expired/i.test(String(error.message || error))) window.location.reload();
    } finally {
      refreshing = false;
      if (content) content.removeAttribute("aria-busy");
    }
  }

  function initializeDashboardNavigation() {
    var layout = document.querySelector("[data-dashboard-layout], .student-portal-layout");
    if (!layout || layout.dataset.navigationBound) return;
    var nav = layout.querySelector(".dash-nav, .student-portal-nav");
    var views = Array.from(document.querySelectorAll("[data-dashboard-view]"));
    if (!nav || !views.length) return;
    var links = Array.from(nav.querySelectorAll("a[href^='#']"));
    var toggle = document.querySelector(".dashboard-menu-toggle, .student-sidebar-toggle");
    var backdrop = layout.querySelector(".dashboard-sidebar-backdrop, .student-sidebar-backdrop");
    var navClass = nav.classList.contains("dash-nav") ? "active" : "is-current";
    var currentViewLabel = document.querySelector("[data-dashboard-current-view], .student-topbar-label");
    layout.dataset.navigationBound = "true";

    function closeMenu() {
      layout.classList.remove("is-sidebar-open");
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open dashboard menu");
      }
    }

    function selectView(viewId, updateHistory) {
      var view = document.getElementById(viewId);
      if (!view || view.dataset.viewDisabled === "true") return false;
      views.forEach(function (candidate) {
        var selected = candidate === view;
        candidate.hidden = !selected;
        candidate.classList.toggle("is-active", selected);
        candidate.setAttribute("aria-hidden", String(!selected));
      });
      links.forEach(function (link) {
        var selected = link.getAttribute("href") === "#" + viewId;
        link.classList.toggle(navClass, selected);
        if (selected) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
        if (selected && currentViewLabel) {
          currentViewLabel.textContent = link.textContent.trim().replace(/^\d+\s*/, "");
        }
      });
      closeMenu();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (updateHistory && window.location.hash !== "#" + viewId) {
        window.history.pushState({ dashboardView: viewId }, "", "#" + viewId);
      }
      return true;
    }

    var homeLink = layout.querySelector("[data-admin-home]");
    if (homeLink) {
      homeLink.addEventListener("click", function (event) {
        event.preventDefault();
        selectView("view-overview", true);
        runDashboardRefresh();
      });
    }
    views.forEach(function (view) {
      var selected = view.classList.contains("is-active");
      view.hidden = !selected || view.dataset.viewDisabled === "true";
      view.setAttribute("aria-hidden", String(view.hidden));
    });
    links.forEach(function (link) {
      link.addEventListener("click", function (event) {
        var viewId = link.getAttribute("href").slice(1);
        if (!document.getElementById(viewId)) return;
        event.preventDefault();
        selectView(viewId, true);
        runDashboardRefresh();
      });
    });
    if (toggle && backdrop) {
      toggle.addEventListener("click", function () {
        var isOpen = layout.classList.toggle("is-sidebar-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
        toggle.setAttribute("aria-label", isOpen ? "Close dashboard menu" : "Open dashboard menu");
      });
      backdrop.addEventListener("click", closeMenu);
    }
    window.addEventListener("popstate", function () {
      var viewId = window.location.hash.slice(1);
      if (!selectView(viewId || "view-overview", false)) {
        selectView("view-overview", false);
      }
    });

    var initialViewId = window.location.hash.slice(1);
    if (!initialViewId || !selectView(initialViewId, false)) {
      selectView("view-overview", false);
    }
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

  function showForcedPasswordChange(client) {
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:1rem;";
      overlay.innerHTML = '<form class="card" style="max-width:420px;width:100%;background:#fff;padding:2rem;border-radius:12px;">' +
        "<h2>Set a new password</h2>" +
        "<p>You signed in with a temporary password. Choose a new password to continue.</p>" +
        '<div class="field"><label for="force-new-password">New password (at least 10 characters)</label><input type="password" id="force-new-password" minlength="10" autocomplete="new-password" required></div>' +
        '<div class="field"><label for="force-confirm-password">Confirm new password</label><input type="password" id="force-confirm-password" minlength="10" autocomplete="new-password" required></div>' +
        '<button class="btn btn-primary" type="submit">Save password</button>' +
        '<p class="alert" role="status" style="margin-top:1rem;"></p></form>';
      document.body.appendChild(overlay);
      var form = overlay.querySelector("form");
      var status = overlay.querySelector(".alert");
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var password = form.querySelector("#force-new-password").value;
        if (password.length < 10) { showAlert(status, "Use at least 10 characters.", "error"); return; }
        if (password !== form.querySelector("#force-confirm-password").value) { showAlert(status, "The passwords do not match.", "error"); return; }
        var button = form.querySelector("button[type='submit']");
        button.disabled = true;
        try {
          var updated = await client.auth.updateUser({ password: password });
          if (updated.error) throw updated.error;
          var done = await client.rpc("complete_forced_password_change");
          if (done.error) throw done.error;
          overlay.remove();
          resolve();
        } catch (error) {
          button.disabled = false;
          showAlert(status, "Your password could not be changed: " + (error && error.message ? error.message : "try again."), "error");
        }
      });
    });
  }

  async function initializeDashboard(client, page) {    var requiredRole = page === "staff-dashboard" ? "staff" : page === "admin-dashboard" ? "admin" : "student";
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

    var expiresSoon = session.expires_at && session.expires_at * 1000 < Date.now() + 60000;
    if (expiresSoon) {
      var refreshed = await client.auth.refreshSession();
      if (refreshed.error || !refreshed.data || !refreshed.data.session) {
        await client.auth.signOut({ scope: "local" });
        window.location.replace(LOGIN_PAGES[requiredRole]);
        return;
      }
      session = refreshed.data.session;
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
      initializeDashboardNavigation();
      if (requiredRole === "student") {
        refreshDashboardData = function () { return loadStudentDashboard(client, session.user.id); };
        await loadStudentDashboard(client, session.user.id);
        try {
          await window.AfastechStudents.initStudent(client, session.user.id);
        } catch (detailsError) {
          console.error("Personal details failed to load.", detailsError);
          showAlert(alertBox, "Your personal details could not be loaded (" + (detailsError.message || "unknown error") + ").", "error");
        }
        watchStudentFeeChanges(client, session.user.id);
        initializePasswordChange(client, "student-password-form", "student-password-status");
      }
      else if (requiredRole === "staff") {
        var mustChange = await client.rpc("my_must_change_password");
        if (!mustChange.error && mustChange.data === true) {
          document.querySelector("[data-dashboard-content]").hidden = true;
          await showForcedPasswordChange(client);
          document.querySelector("[data-dashboard-content]").hidden = false;
        }
        refreshDashboardData = function () { return loadStaffDashboard(client, session.user.id); };
        await loadStaffDashboard(client, session.user.id);
        initializePasswordChange(client, "staff-password-form", "staff-password-status");
      }
      else {
        refreshDashboardData = function () { return loadAdminDashboard(client); };
        await loadAdminDashboard(client);
        initializeStaffInvite(client);
        initializeStudentImport(client);
      }
    } catch (error) {
      console.error("Portal dashboard failed to load.", error);
      if (error && /jwt expired/i.test(String(error.message || error))) {
        await client.auth.signOut({ scope: "local" });
        window.location.replace(LOGIN_PAGES[requiredRole]);
        return;
      }
      showAlert(alertBox, "Portal data could not be loaded (" + (error && error.message ? error.message : "unknown error") + "). Please refresh or contact the site administrator.", "error");
    }
  }

  var loginForm = document.getElementById("portal-login");
  var client = createClient();
  if (loginForm) initializeLogin(client, loginForm);

  var page = document.body.getAttribute("data-page");
  if (page === "student-dashboard" || page === "staff-dashboard" || page === "admin-dashboard") initializeDashboard(client, page);
})();
