(function () {
  "use strict";

  var LOGIN_PAGES = {
    student: "portal-student.html",
    staff: "portal-staff.html"
  };
  var DASHBOARD_PAGES = {
    student: "portal-student-dashboard.html",
    staff: "portal-staff-dashboard.html"
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
      client.from("student_records").select("programme, residency, current_term, fees_status").eq("student_id", userId).maybeSingle(),
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
    var requiredRole = page === "staff-dashboard" ? "staff" : "student";
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
      if (requiredRole === "student") await loadStudentDashboard(client, session.user.id);
      else await loadStaffDashboard(client, session.user.id);
    } catch (error) {
      showAlert(alertBox, "Portal data could not be loaded. Please refresh or contact the site administrator.", "error");
    }
  }

  var loginForm = document.getElementById("portal-login");
  var client = createClient();
  if (loginForm) initializeLogin(client, loginForm);

  var page = document.body.getAttribute("data-page");
  if (page === "student-dashboard" || page === "staff-dashboard") initializeDashboard(client, page);
})();
