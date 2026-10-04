import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const schoolCode = "0071007";
const studentLoginDomain = "students.afastech.invalid";
const passwordFirstCharacterAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const passwordAlphabet = passwordFirstCharacterAlphabet + "-_";

function response(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function generatedPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return passwordFirstCharacterAlphabet[bytes[0] % passwordFirstCharacterAlphabet.length] +
    Array.from(bytes.slice(1), (byte) => passwordAlphabet[byte % passwordAlphabet.length]).join("");
}

function studentLoginEmail(indexNumber: string) {
  return `refid-${indexNumber.toLowerCase()}@${studentLoginDomain}`;
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
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Student roster import is not configured.");
    return response({ error: "Student roster import is not configured." }, 500, requestOrigin);
  }

  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return response({ error: "Sign in as a Super Admin to import students." }, 401, requestOrigin);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return response({ error: "A valid JSON request body is required." }, 400, requestOrigin);
  }

  const academicYear = typeof input.academic_year === "string" ? input.academic_year.trim() : "";
  const className = typeof input.class_name === "string" ? input.class_name.trim() : "";
  const makeCurrent = input.make_current === true;
  if (!academicYear || !/^SHS [1-3]$/i.test(className)) {
    return response({ error: "Choose an academic year and an SHS class from SHS 1 to SHS 3." }, 400, requestOrigin);
  }
  if (!Array.isArray(input.students) || input.students.length === 0 || input.students.length > 500) {
    return response({ error: "The roster must contain between 1 and 500 students." }, 400, requestOrigin);
  }

  const students: Array<{
    full_name: string;
    index_number: string;
    programme: string;
    year_of_entry: string;
  }> = [];
  const seenIndexNumbers = new Set<string>();
  for (let index = 0; index < input.students.length; index += 1) {
    const student = input.students[index];
    if (!student || typeof student !== "object" || Array.isArray(student)) {
      return response({ error: `Roster row ${index + 1} is invalid.` }, 400, requestOrigin);
    }
    const row = student as Record<string, unknown>;
    const rowSchoolCode = typeof row.school_code === "string" ? row.school_code.trim() : "";
    const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
    const indexNumber = typeof row.index_number === "string"
      ? row.index_number.trim().toUpperCase()
      : "";
    const learningArea = typeof row.learning_area === "string"
      ? row.learning_area.trim().replace(/\s+/g, " ").toUpperCase()
      : "";
    const yearOfEntry = typeof row.year_of_entry === "string" || typeof row.year_of_entry === "number"
      ? String(row.year_of_entry).trim()
      : "";

    if (rowSchoolCode !== schoolCode) {
      return response({ error: `Roster row ${index + 1} has an unexpected school code.` }, 400, requestOrigin);
    }
    if (fullName.length < 1 || fullName.length > 120) {
      return response({ error: `Roster row ${index + 1} has an invalid student name.` }, 400, requestOrigin);
    }
    if (!/^[A-Z0-9]{12}$/.test(indexNumber)) {
      return response({ error: `Roster row ${index + 1} has an invalid CassRefID.` }, 400, requestOrigin);
    }
    if (!learningArea || learningArea.length > 120) {
      return response({ error: `Roster row ${index + 1} has an invalid learning area or programme.` }, 400, requestOrigin);
    }
    if (!/^(19|20|21)\d{2}$/.test(yearOfEntry)) {
      return response({ error: `Roster row ${index + 1} has an invalid year of entry.` }, 400, requestOrigin);
    }
    if (seenIndexNumbers.has(indexNumber)) {
      return response({ error: `CassRefID values must be unique; duplicate found on roster row ${index + 1}.` }, 400, requestOrigin);
    }
    seenIndexNumbers.add(indexNumber);
    students.push({
      full_name: fullName,
      index_number: indexNumber,
      programme: learningArea,
      year_of_entry: yearOfEntry,
    });
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
    console.error("Could not verify the caller's portal role.");
    return response({ error: "Could not verify Super Admin access." }, 500, requestOrigin);
  }
  if (!profile || profile.role !== "admin") {
    return response({ error: "Only a Super Admin can import student accounts." }, 403, requestOrigin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: yearRecord, error: yearError } = await admin
    .from("academic_years")
    .select("id")
    .eq("name_key", academicYear.toLowerCase())
    .maybeSingle();
  if (yearError || !yearRecord) {
    console.error("The selected academic year could not be verified.");
    return response({ error: "The selected academic year does not exist. No accounts were created." }, 400, requestOrigin);
  }

  const indexNumbers = students.map((student) => student.index_number);
  const { data: existingDetails, error: detailsLookupError } = await admin
    .from("student_details")
    .select("index_number")
    .in("index_number", indexNumbers);
  if (detailsLookupError) {
    console.error("Could not check for existing student index numbers.");
    return response({ error: "The database could not validate this roster. No accounts were created." }, 500, requestOrigin);
  }
  if (existingDetails && existingDetails.length) {
    return response({
      error: "One or more CassRefID values already exist in student records. No accounts were created; review the existing records before importing.",
    }, 409, requestOrigin);
  }

  const requestedEmails = new Set(students.map((student) => studentLoginEmail(student.index_number)));
  const existingEmails = new Set<string>();
  for (let page = 1; ; page += 1) {
    const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (usersError) {
      console.error("Could not check for existing student login accounts.");
      return response({ error: "Existing portal accounts could not be checked. No accounts were created." }, 500, requestOrigin);
    }
    for (const user of users.users) {
      if (user.email && requestedEmails.has(user.email.toLowerCase())) {
        existingEmails.add(user.email.toLowerCase());
      }
    }
    if (users.users.length < 1000) break;
  }
  if (existingEmails.size) {
    return response({
      error: "One or more CassRefID login accounts already exist. No accounts were created; contact the Super Admin to review them.",
    }, 409, requestOrigin);
  }

  const createdUsers: Array<{ id: string }> = [];
  const credentials: Array<{ index_number: string; full_name: string; temporary_password: string }> = [];
  async function rollbackCreatedUsers() {
    let complete = true;
    for (const user of createdUsers) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) {
        complete = false;
        console.error("Could not roll back a student account after an import failure.");
      }
    }
    return complete;
  }
  function rollbackMessage(complete: boolean) {
    return complete
      ? "Newly created accounts were rolled back."
      : "Some account cleanup failed; review the Student Portal accounts before retrying.";
  }

  for (let index = 0; index < students.length; index += 1) {
    const student = students[index];
    const email = studentLoginEmail(student.index_number);
    const password = generatedPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: student.full_name,
        student_index: student.index_number,
        year_of_entry: student.year_of_entry,
      },
    });
    if (createError || !created.user) {
      const rollbackComplete = await rollbackCreatedUsers();
      console.error("Student account creation failed.", createError?.code || "unknown");
      return response({
        error: `Student account creation failed at roster row ${index + 1}. ${rollbackMessage(rollbackComplete)}`,
      }, 500, requestOrigin);
    }
    createdUsers.push({ id: created.user.id });

    const { data: updatedProfile, error: roleError } = await admin
      .from("profiles")
      .update({ role: "student", full_name: student.full_name })
      .eq("id", created.user.id)
      .is("role", null)
      .select("id")
      .maybeSingle();
    if (roleError || !updatedProfile) {
      const rollbackComplete = await rollbackCreatedUsers();
      console.error("Could not assign the imported account's Student role.");
      return response({
        error: `Student role setup failed at roster row ${index + 1}. ${rollbackMessage(rollbackComplete)}`,
      }, 500, requestOrigin);
    }
    credentials.push({
      index_number: student.index_number,
      full_name: student.full_name,
      temporary_password: password,
    });
  }

  const { error: importError } = await admin.rpc("service_import_student_records", {
    target_year_name: academicYear,
    target_class_name: className,
    target_make_current: makeCurrent,
    target_students: students.map((student, index) => ({
      profile_id: createdUsers[index].id,
      full_name: student.full_name,
      index_number: student.index_number,
      programme: student.programme,
    })),
  });
  if (importError) {
    const rollbackComplete = await rollbackCreatedUsers();
    console.error("Student academic records could not be saved.");
    return response({
      error: `Student account setup did not complete. ${rollbackMessage(rollbackComplete)}`,
    }, 500, requestOrigin);
  }

  return response({
    imported: credentials.length,
    academic_year: academicYear,
    class_name: className,
    credentials,
  }, 201, requestOrigin);
});
