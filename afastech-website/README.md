# AFASTECH Website

Official website project for Afadjato Senior High Technical School (AFASTECH), Gbledi Gbogame, Hohoe Municipal, Volta Region, Ghana.

Static multi-page site — plain HTML/CSS/JS, no build step required. Open `index.html` directly in a browser, or deploy the whole folder to any static host.

## Structure

```
afastech-website/
├── index.html                     Home
├── about.html                     History, vision/mission, values, leadership, staffing
├── programmes.html                All 5 programmes with real subject combinations
├── admissions.html                6-step CSSPS-style application wizard
├── news.html                      News & media
├── events.html                    Upcoming events
├── contact.html                   Contact form, staff contacts, map
├── portal-student.html            Student sign-in (Supabase Auth)
├── portal-staff.html              Staff sign-in (Supabase Auth)
├── portal-admin.html              Super Admin sign-in (Supabase Auth)
├── portal-student-dashboard.html  Student dashboard (RLS-protected data)
├── portal-staff-dashboard.html    Staff dashboard (RLS-protected data)
├── portal-admin-dashboard.html    Super Admin account, house, and fee tools
├── css/style.css                  Shared design system
├── js/main.js                     Nav toggle, current-page highlighting, footer year
├── js/admissions.js               Admissions wizard logic
├── js/portal.js                   Supabase Auth and portal data access
├── js/supabase-config.js          Public Supabase URL and publishable key
└── assets/
    ├── afastech-crest.jpg          Official AFASTECH school crest
    └── contours.svg               Topographic hero background
```

Supabase configuration and database migrations are kept in the repository-root `supabase/` directory, alongside this site folder.

After student sign-in, the student dashboard presents an AFASTECH-branded information-system workspace with a Personal Details section, programme details, timetable, assessment results, fee status, and announcements. Personal Details displays the authenticated profile and the student's existing `student_details` fields; it is read-only to students. Administrators can edit each student's name, CassRefID, programme, residency, and class from the Student accounts page, and can update staff names, job titles, and departments from Staff & access. Saving a row writes the changes directly to the existing profile and details records; it does not create duplicate accounts.

## What's real vs. placeholder

**Real, from the 2025/2026 School Improvement Plan:**
District/region, founding year and story, land size, boarding-since-2017 note, headmistress name and tenure, board chair name, the 5 programmes and their listed subjects, staffing counts by department, vision/mission, core values, crest description, phone/email for the head and board chair.

**Placeholder — replace before launch:**
- Assistant headmasters' names (only "Administration" role is stubbed in `about.html`)
- Real photography (person photos, campus photos, hero imagery — currently SVG icons/illustrations)
- News & events articles (real headlines, dates, and stories)
- Voucher short code `*713*8849#` and CSSPS flow — confirm AFASTECH's actual code and process with the district office before publishing
- Portal data remains empty until administrators add records to Supabase

## Supabase portal setup

The portal uses Supabase Auth and the Supabase JavaScript client (pinned to v2.112.3). Browser code contains only the project URL and publishable/anon key; database access is restricted by Postgres Row Level Security (RLS). Never put a `service_role` or secret key in this static site.

1. The live Supabase project already contains `profiles`, `student_details`, `staff_details`, the `user_role` type, existing administrator policies, and an Auth user trigger. The migrations intentionally preserve those objects. `202610030001_portal_security.sql` is a guarded adoption baseline: it checks that existing schema before any new migration runs. `202610040001_admin_foundation.sql` adds portal-only read tables and admin role management. `202610040002_shared_house_fee_records.sql` extends the existing `student_details` row with shared house and fee fields. `202610040003_profile_role_update_guard.sql` prevents users from changing their own portal role through direct profile updates. `202610040004_academic_management.sql` adds academic years and semesters, programmes, classes, departments, subjects, yearly enrolments, teacher allocations, assessments, marks, and role-checked academic functions. `202610040005_staff_house_roles_and_semesters.sql` limits the calendar to two semesters and reserves house assignment and fee access to staff explicitly designated as House Master or House Mistress. `202610040006_multiple_staff_job_titles.sql` allows multiple approved job titles while keeping House Master authorization tied to explicit designation. `202610040009_admin_individual_account_editing.sql` adds administrator-only student/staff record lists and transactional edits to names and school details. `202610040010_student_transcript_import.sql` adds private transcript drafts, reviewed publication, and student-only access to published transcript grades and GPA. Existing student profiles remain the identity source.
2. Install the Supabase CLI. From the repository root (`C:\WEBSITE`), link the existing project and check its migration history before applying changes:

    ```powershell
    supabase login
    supabase link --project-ref YOUR_PROJECT_REF
    supabase migration list
    supabase db push --linked --dry-run --skip-vault
    supabase db push --linked --skip-vault
    ```

   The adoption baseline is intentionally safe to execute on the linked project; it makes no schema changes and fails unless the existing schema matches the expected portal foundation. Do not mark it applied manually.

3. In Supabase Project Settings / API, copy the Project URL and publishable (or legacy anon) key into `js/supabase-config.js`. These values are public by design; the RLS policies are the protection. Do not copy a secret or `service_role` key there.
4. In Authentication settings, disable public sign-ups. Set the production Site URL and exact allowed redirect URLs for the deployed website. Create staff accounts through the Super Admin portal. Create student accounts only through the protected student account forms.
5. Provision the first administrator through a trusted database operator—not through the website. Invite the account through Supabase Authentication, then assign the role in SQL Editor using its exact email:

    ```sql
    update public.profiles as p
    set role = 'admin'
    from auth.users as u
    where p.id = u.id
      and lower(u.email) = lower('admin@example.edu')
    returning p.id;
    ```

    Confirm the query returns exactly the intended account. Only this trusted SQL provisioning process can grant `admin`; the Super Admin portal can assign only `student` or `staff` roles. Newly invited accounts remain pending until an administrator explicitly assigns a role. Share the Super Admin URL (`portal-admin.html`) privately with authorized administrators; it is intentionally not linked from public website navigation.
6. Configure the staff-account Edge Function. In Supabase Edge Functions → Secrets, set `ALLOWED_ORIGINS` to the exact website origin (scheme and host only, no path). Supabase supplies its project URL, anon key, and service-role key to the Edge Function runtime. Never place the service-role key in website code or send it to the browser.

   From the repository root, deploy the staff and student-account functions (the API bundler avoids requiring Docker):

    ```powershell
    supabase functions deploy invite-staff --project-ref YOUR_PROJECT_REF --use-api
    supabase functions deploy import-student-roster --project-ref YOUR_PROJECT_REF --use-api
    ```

   The function verifies the signed-in caller's database role, creates a confirmed Supabase Auth user with the temporary password entered by the Super Admin, assigns the Staff role, and stores the selected job titles and department in `staff_details`. Job titles are Teacher, House Master, House Mistress, Head of Department, Assistant Head, Headteacher, or Non-Teaching Staff; select all that apply. Departments are MATHS/ICT, SCIENCE, ENGLISH, BUSINESS, TECHNICAL, or HOME ECONOMICS (optional). This flow sends no email and does not require SMTP. Share the temporary password privately; staff and teachers sign in through the Staff Portal and should change it immediately using Account security. Staff and teachers share the `staff` role; their job titles distinguish their positions.
7. In Supabase Authentication settings, review email/password policy, enable CAPTCHA if appropriate, and set Auth rate limits and session time-box/inactivity limits to school policy. Password hashing and verification are handled by Supabase Auth. The website does not store or hash passwords itself.
8. In the Super Admin portal, create houses, assign students and House Masters, and review or update student fee statuses. A House Master can update only students in assigned houses; the Super Admin can manage all student fee statuses. Both write to the same `student_details` row that the student's portal reads. Supabase Realtime sends fee-status changes to an already-open student dashboard.
9. Serve and test over HTTPS using the real deployment origin. Database access is restricted by RLS, and privileged account and fee operations use role-checked database functions; never expose a `service_role` key or grant users roles through editable metadata.

## Academic management (Phase 2)

After applying migrations `202610040004_academic_management.sql`, `202610040005_staff_house_roles_and_semesters.sql`, `202610040006_multiple_staff_job_titles.sql`, `202610040007_student_roster_import.sql`, `202610040008_multi_batch_student_provisioning.sql`, `202610040009_admin_individual_account_editing.sql`, and `202610040010_student_transcript_import.sql`, use the private Super Admin portal to set academic years and the school's two semesters, create programmes/classes/departments/subjects, enrol existing student accounts, and allocate subjects to existing staff accounts. Mark entry is limited to the assigned teacher and enrolled students; marks use the existing 0–100 scale. Teachers submit complete assessments for review, and students can see marks only after an administrator publishes them. Student results include previously stored `student_results` rows as well as published academic assessments.

The Super Admin can import a privacy-minimized CSV/TSV roster or create an individual student account. Choose SHS 1, SHS 2, or SHS 3 and an academic year; the importer validates the school code, unique CassRefID, learning area/programme, and four-digit entry year, then creates Auth accounts and academic enrolments. Each student receives a unique, randomly generated temporary password. The Super Admin receives passwords in a one-time CSV download; the application does not store or email them. Hand credentials out privately and delete local copies after distribution. Students can change passwords at any time from Account security after signing in. These accounts use internal non-deliverable Auth email aliases, so password recovery by email is unavailable; a Super Admin must assist students who lose access. Configure semester dates separately before using semester-based academic workflows.

Individual transcript import is being added separately from numeric assessment marks. After applying `202610040010_student_transcript_import.sql`, a Super Admin can read a transcript PDF locally in the browser, match each transcript to an existing student, review and correct extracted Year/Semester/Subject/GPA/Final Grade rows, save a private draft, and publish it to that student's portal. The PDF itself is not uploaded or stored, and no letter grades are converted into the 0–100 assessment scale. The pinned PDF.js reader and worker are self-hosted under `assets/vendor/pdfjs-4.10.38/`; transcript parsing makes no third-party request. Review every page before publishing, especially continuation pages flagged for manual entry. Batch class-results PDF imports remain unsupported and need a representative class sheet and official grading rules before they can be designed.

The initial fee workflow updates the existing `fees_status` field (for example, a school-defined status). It is not yet a transaction ledger for amounts, payments, balances, or receipts.

The static site calls Supabase Auth and Data APIs directly; staff account creation uses an Edge Function because it requires the privileged Auth Admin API. Its allowed browser origin is configured explicitly; do not use wildcard origins for authenticated operations. CORS is not a substitute for RLS or authorization. Configure hosting security headers for the deployed website.

Announcements remain read-only. Review academic access with separate student, staff, and Super Admin accounts, including tests for role boundaries, unassigned classes, incomplete marks, and unpublished results, before using real school data.

Public navigation exposes only the Student and Staff portals. The Super Admin login is a separate, privately shared URL and is marked `noindex`; this reduces public discoverability but is not an access-control measure. Authentication and database role checks protect the admin tools.

## Before publishing

- The board chair's personal/work email and the head's phone number are shown on the Contact page exactly as provided in the SIP — confirm with both individuals that they're comfortable having these listed publicly before the site goes live.
- Swap the Google Maps embed query for the school's exact coordinates if you have them, for a tighter pin.
- Google Fonts (IBM Plex family) load from `fonts.googleapis.com` — swap to self-hosted fonts if you need the site to work fully offline.

## Deploying

Any static host works — no server-side code required. For the connected Vercel project:

1. Set **Root Directory** to `afastech-website` in the Vercel project settings.
2. Use the **Other** framework preset with no build command and no output directory.
3. Redeploy the latest commit from `main`.

The deployment root must contain `index.html`, `css/`, `js/`, and `assets/`. If the Root Directory points to the repository root, Vercel will not find the site entry point.

Other options:
- **Netlify**: set the publish directory to `afastech-website`.
- **GitHub Pages**: push to a repo and enable Pages on the main branch.
- **Traditional hosting**: upload the whole folder via FTP/cPanel to your domain's public root.
