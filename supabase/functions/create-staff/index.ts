import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function response(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get("origin") || "";
  if (!allowedOrigins.includes(requestOrigin)) {
    return new Response("Origin not allowed.", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      },
    });
  }

  if (request.method !== "POST") {
    return response({ error: "Method not allowed." }, 405, requestOrigin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const allowedDepartments = new Set([
    "MATHS/ICT",
    "SCIENCE",
    "ENGLISH",
    "BUSINESS",
    "TECHNICAL",
    "HOME ECONOMICS",
  ]);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Required Supabase or site URL environment variables are missing.");
    return response({ error: "Staff invitations are not configured." }, 500, requestOrigin);
  }

  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return response({ error: "Sign in as a Super Admin to add staff." }, 401, requestOrigin);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return response({ error: "A valid JSON request body is required." }, 400, requestOrigin);
  }

  const fullName = typeof input.full_name === "string" ? input.full_name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const department = typeof input.department === "string" ? input.department.trim() : "";
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const temporaryPassword = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");

  if (fullName.length < 1 || fullName.length > 120) {
    return response({ error: "Full name must contain between 1 and 120 characters." }, 400, requestOrigin);
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response({ error: "Enter a valid school email address." }, 400, requestOrigin);
  }
  if (department && !allowedDepartments.has(department)) {
    return response({ error: "Choose a department from the approved list." }, 400, requestOrigin);
  }
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) {
    return response({ error: "Your session is invalid. Sign in again." }, 401, requestOrigin);
  }

  const { data: profile, error: profileError } = await caller
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not verify the caller's portal role.", profileError);
    return response({ error: "Could not verify Super Admin access." }, 500, requestOrigin);
  }
  if (!profile || profile.role !== "admin") {
    return response({ error: "Only a Super Admin can add staff accounts." }, 403, requestOrigin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    console.error("Staff account creation failed.", createError);
    return response(
      { error: createError?.message || "Supabase did not create the staff account." },
      400,
      requestOrigin,
    );
  }

  const userId = created.user.id;
  const { data: updatedProfile, error: roleError } = await admin
    .from("profiles")
    .update({ role: "staff", full_name: fullName, must_change_password: true })
    .eq("id", userId)
    .is("role", null)
    .select("id")
    .maybeSingle();
  if (roleError || !updatedProfile) {
    console.error("Could not assign the invited account's Staff role.", roleError);
    const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
    if (rollbackError) console.error("Could not remove the incomplete invited account.", rollbackError);
    return response({ error: "The account could not be safely assigned to the Staff Portal." }, 500, requestOrigin);
  }

  const { error: detailsError } = await admin
    .from("staff_details")
    .upsert(
      {
        profile_id: userId,
        position: "Teacher",
        department: department || null,
      },
      { onConflict: "profile_id" },
    );
  if (detailsError) {
    console.error("Could not save the invited staff member's details.", detailsError);
    const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
    if (rollbackError) console.error("Could not remove the incomplete invited account.", rollbackError);
    return response({ error: "The staff profile could not be saved; the incomplete account was removed." }, 500, requestOrigin);
  }

  const { error: passwordError } = await admin
    .from("staff_initial_passwords")
    .upsert({ profile_id: userId, temp_password: temporaryPassword }, { onConflict: "profile_id" });
  if (passwordError) {
    console.error("Could not store the temporary password.", passwordError);
    await admin.auth.admin.deleteUser(userId);
    return response({ error: "The temporary password could not be saved; the account was removed." }, 500, requestOrigin);
  }

  return response({ user_id: userId, email, temporary_password: temporaryPassword }, 201, requestOrigin);
});
