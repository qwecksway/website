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
├── portal-student-dashboard.html  Student dashboard (RLS-protected data)
├── portal-staff-dashboard.html    Staff dashboard (RLS-protected data)
├── css/style.css                  Shared design system
├── js/main.js                     Nav toggle, current-page highlighting, footer year
├── js/admissions.js               Admissions wizard logic
├── js/portal.js                   Supabase Auth and portal data access
├── js/supabase-config.js          Public Supabase URL and publishable key
├── supabase/migrations/           Database schema and RLS policies
└── assets/
    ├── crest.svg                  School crest (mountain, book, tape measure)
    └── contours.svg               Topographic hero background
```

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

1. Review `supabase/migrations/202610030001_portal_security.sql` against the existing Supabase schema. It creates the portal tables, enables RLS, and grants authenticated users read-only access to their own role-appropriate records. Adapt it before applying if any of these tables or policies already exist.
2. Install the Supabase CLI. From the project root, initialize its local config once, then link the existing project and apply the migration:

    ```powershell
    supabase init
    supabase login
    supabase link --project-ref YOUR_PROJECT_REF
    supabase db push
    ```

3. In Supabase Project Settings / API, copy the Project URL and publishable (or legacy anon) key into `js/supabase-config.js`. These values are public by design; the RLS policies are the protection. Do not copy a secret or `service_role` key there.
4. In Authentication settings, disable public sign-ups. Invite student and staff accounts through the administrator workflow. Set the production Site URL and exact allowed redirect URLs for the deployed website.
5. The migration creates a pending profile after Auth user creation. An administrator must assign its role in SQL Editor after inviting the user. Example:

    ```sql
    update public.profiles
    set role = 'student', full_name = 'Student Name'
    where id = (select id from auth.users where email = 'student@example.edu');
    ```

    Use `staff` for staff accounts. Never grant role changes through user-editable profile fields. The login currently uses email/password because that is Supabase Auth's supported password flow; school IDs can be displayed as profile data but must not replace the Auth identity without a trusted server-side lookup.
6. In Supabase Authentication settings, review email/password policy, configure a trusted SMTP provider, enable CAPTCHA if appropriate, and set Auth rate limits and session time-box/inactivity limits to school policy. Password hashing and verification are handled by Supabase Auth. The website does not store or hash passwords itself.
7. Serve and test over HTTPS using the real deployment origin. The dashboards query only their role-scoped tables, and all fetched values are inserted as text. SQL access uses Supabase's structured query API; do not add interpolated/raw SQL for user input.

The site calls Supabase Auth and Data APIs directly, so there is no custom API server or Edge Function CORS middleware in this project. Set exact Auth redirect URLs and configure your hosting security headers for the deployment. If Edge Functions are added later, allow only the exact deployed site origin and required headers; do not use wildcard origins for authenticated operations. CORS is not a substitute for RLS or authorization.

This initial portal supports read-only dashboards. It deliberately does not grant browser writes for grades, student records, staff assignments, or announcements. Build and test narrowly scoped RLS write policies (or trusted Edge Functions) before adding those workflows. Review RLS behavior using separate student and staff test accounts before using real records.

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
