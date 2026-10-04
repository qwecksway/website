(function () {
  "use strict";

  var alertBox = document.getElementById("password-setup-alert");
  var form = document.getElementById("password-setup-form");
  var submitButton = form.querySelector("button[type='submit']");
  var hasAuthCallback = window.location.hash.indexOf("access_token=") !== -1 ||
    new URLSearchParams(window.location.search).has("code");

  function showMessage(message, kind) {
    alertBox.textContent = message;
    alertBox.className = "alert alert-" + kind + " show";
  }

  if (!window.supabase || !window.AFASTECH_SUPABASE_URL || !window.AFASTECH_SUPABASE_ANON_KEY) {
    showMessage("Portal setup is not configured. Contact the school administrator.", "error");
    submitButton.disabled = true;
    return;
  }

  var client = window.supabase.createClient(
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

  var sessionReady = client.auth.getSession().then(function (result) {
    if (result.error) throw result.error;
    if (!hasAuthCallback) {
      throw new Error("Open this page using the invitation link sent to your email.");
    }
    if (!result.data.session) {
      throw new Error("This invitation link is invalid or has expired.");
    }
  }).catch(function (error) {
    showMessage(error.message || "This invitation link is invalid or has expired.", "error");
    submitButton.disabled = true;
    return false;
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var password = document.getElementById("new-password").value;
    var confirmation = document.getElementById("confirm-password").value;
    if (password.length < 10) {
      showMessage("Your password must contain at least 10 characters.", "error");
      return;
    }
    if (password !== confirmation) {
      showMessage("The passwords do not match.", "error");
      return;
    }

    submitButton.disabled = true;
    showMessage("Saving your password…", "success");
    try {
      if (!await sessionReady) return;
      var update = await client.auth.updateUser({ password: password });
      if (update.error) throw update.error;

      var profile = await client
        .from("profiles")
        .select("role")
        .eq("id", update.data.user.id)
        .maybeSingle();
      if (profile.error) throw profile.error;
      if (!profile.data || profile.data.role !== "staff") {
        await client.auth.signOut({ scope: "local" });
        throw new Error("This account does not have Staff Portal access. Contact the school administrator.");
      }

      showMessage("Password saved. Opening the Staff Portal…", "success");
      window.location.replace("portal-staff-dashboard.html");
    } catch (error) {
      showMessage(error.message || "Your password could not be saved. Request a new invitation and try again.", "error");
      submitButton.disabled = false;
    }
  });
})();
