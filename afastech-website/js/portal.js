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
    if (greeting) greeting.textContent = profile.full_name || email || "User";
  }

  async function loadStudentDashboard(client, userId) {
    var results = await Promise.all([
      client.from("student_details").select("programme, residency, current_term, fees_status").eq("profile_id", userId).maybeSingle(),
      client.from("timetable_entries").select("weekday, morning, afternoon").eq("student_id", userId).order("weekday"),
      client.from("student_results").select("subject, assessment, score").eq("student_id", userId).order("created_at", { ascending: false }).limit(10),
      client.from("portal_announcements").select("title, body, published_at").or("audience.eq.all,audience.eq.student").order("published_at", { ascending: false }).limit(10)
    ]);
    var error = results.find(function (result) { return result.error; });
    if (error) throw error.error;

    var record = results[0].data;
    if (record) {
      document.querySelector("[data-student-programme]").textContent = record.programme || "Not set";
      document.querySelector("[data-student-residency]").textContent = record.residency || "Not set";
      document.querySelector("[data-student-term]").textContent = record.current_term || "Not set";
      var fees = document.querySelector("[data-student-fees]");
      if (fees) fees.textContent = record.fees_status || "Not set";
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
      function (row) { return Number(row.score).toFixed(2).replace(/\.00$/, "") + "%"; }
    ]);
    renderAnnouncements(results[3].data || []);
    if (!record) showEmptyState(document.getElementById("student-data-status"), "Your school record has not been added yet.");
    if (!results[1].data.length) showEmptyState(document.getElementById("student-timetable-status"), "No timetable entries are available.");
    if (!results[2].data.length) showEmptyState(document.getElementById("student-results-status"), "No results are available.");
  }

  async function loadStaffDashboard(client, userId) {
    var results = await Promise.all([
      client.from("staff_assignments").select("weekday, class_name, subject").eq("staff_id", userId).order("weekday"),
      client.from("staff_gradebook_entries").select("class_name, assessment, status").eq("staff_id", userId).order("status"),
      client.from("portal_announcements").select("title, body, published_at").or("audience.eq.all,audience.eq.staff").order("published_at", { ascending: false }).limit(10)
    ]);
    var error = results.find(function (result) { return result.error; });
    if (error) throw error.error;

    var weekdays = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    renderRows(document.getElementById("staff-assignments"), results[0].data || [], [
      function (row) { return weekdays[row.weekday] || ""; },
      function (row) { return row.class_name; },
      function (row) { return row.subject; }
    ]);
    renderRows(document.getElementById("staff-gradebook"), results[1].data || [], [
      function (row) { return row.class_name; },
      function (row) { return row.assessment; },
      function (row) { return row.status; }
    ]);
    renderAnnouncements(results[2].data || []);
    if (!results[0].data.length) showEmptyState(document.getElementById("staff-assignments-status"), "No class assignments are available.");
    if (!results[1].data.length) showEmptyState(document.getElementById("staff-gradebook-status"), "No gradebook entries are available.");
    await loadFeeRecords(client, "staff-house-fees", "staff-house-fees-status");
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
      client.rpc("list_house_fee_records")
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
    renderAdminHouseControls(client, profiles, houses);

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

  function renderAdminHouseControls(client, profiles, houses) {
    var personSelect = document.getElementById("admin-house-person");
    var houseSelect = document.getElementById("admin-house-select");
    personSelect.replaceChildren();
    houseSelect.replaceChildren();

    var personPlaceholder = document.createElement("option");
    personPlaceholder.value = "";
    personPlaceholder.textContent = "Choose a student or staff member";
    personPlaceholder.disabled = true;
    personPlaceholder.selected = true;
    personSelect.appendChild(personPlaceholder);
    profiles.filter(function (profile) {
      return profile.role === "student" || profile.role === "staff";
    }).forEach(function (profile) {
      var option = document.createElement("option");
      option.value = profile.id;
      option.textContent = (profile.role === "staff" ? "House Master — " : "Student — ") +
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
      var email = loginForm.querySelector("#portalId").value.trim().toLowerCase();
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
      }
      else if (requiredRole === "staff") await loadStaffDashboard(client, session.user.id);
      else await loadAdminDashboard(client);
    } catch (error) {
      showAlert(alertBox, "Portal data could not be loaded. Please refresh or contact the site administrator.", "error");
    }
  }

  var loginForm = document.getElementById("portal-login");
  var client = createClient();
  if (loginForm) initializeLogin(client, loginForm);

  var page = document.body.getAttribute("data-page");
  if (page === "student-dashboard" || page === "staff-dashboard" || page === "admin-dashboard") initializeDashboard(client, page);
})();
