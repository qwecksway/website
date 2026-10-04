create type public.portal_role as enum ('student', 'staff');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.portal_role,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create function public.create_pending_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.create_pending_profile();

create function public.current_portal_role()
returns public.portal_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

revoke all on function public.current_portal_role() from public, anon;
grant execute on function public.current_portal_role() to authenticated;

create table public.student_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.profiles (id) on delete cascade,
  programme text not null default '',
  residency text not null default '',
  current_term text not null default '',
  fees_status text not null default '',
  updated_at timestamptz not null default now()
);

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 5),
  morning text not null default '',
  afternoon text not null default '',
  term text not null default ''
);

create table public.student_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  assessment text not null,
  score numeric(5, 2) not null check (score between 0 and 100),
  term text not null default '',
  created_at timestamptz not null default now()
);

create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 5),
  class_name text not null,
  subject text not null
);

create table public.staff_gradebook_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete cascade,
  class_name text not null,
  assessment text not null,
  status text not null check (status in ('pending', 'submitted'))
);

create table public.portal_announcements (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('all', 'student', 'staff')),
  title text not null,
  body text not null,
  published_at timestamptz not null default now()
);

create index timetable_entries_student_weekday_idx
  on public.timetable_entries (student_id, weekday);
create index student_results_student_created_idx
  on public.student_results (student_id, created_at desc);
create index staff_assignments_staff_weekday_idx
  on public.staff_assignments (staff_id, weekday);
create index staff_gradebook_staff_status_idx
  on public.staff_gradebook_entries (staff_id, status);
create index portal_announcements_audience_published_idx
  on public.portal_announcements (audience, published_at desc);

alter table public.profiles enable row level security;
alter table public.student_records enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.student_results enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.staff_gradebook_entries enable row level security;
alter table public.portal_announcements enable row level security;

create policy "Users read their own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Students read their own record"
on public.student_records for select to authenticated
using (student_id = (select auth.uid()) and (select public.current_portal_role()) = 'student');

create policy "Students read their own timetable"
on public.timetable_entries for select to authenticated
using (student_id = (select auth.uid()) and (select public.current_portal_role()) = 'student');

create policy "Students read their own results"
on public.student_results for select to authenticated
using (student_id = (select auth.uid()) and (select public.current_portal_role()) = 'student');

create policy "Staff read their own assignments"
on public.staff_assignments for select to authenticated
using (staff_id = (select auth.uid()) and (select public.current_portal_role()) = 'staff');

create policy "Staff read their own gradebook entries"
on public.staff_gradebook_entries for select to authenticated
using (staff_id = (select auth.uid()) and (select public.current_portal_role()) = 'staff');

create policy "Users read announcements for their role"
on public.portal_announcements for select to authenticated
using (
  audience = 'all'
  or audience::text = (select public.current_portal_role())::text
);

revoke all on public.profiles, public.student_records, public.timetable_entries,
  public.student_results, public.staff_assignments, public.staff_gradebook_entries,
  public.portal_announcements from anon, authenticated;

grant select on public.profiles, public.student_records, public.timetable_entries,
  public.student_results, public.staff_assignments, public.staff_gradebook_entries,
  public.portal_announcements to authenticated;

revoke all on function public.create_pending_profile() from public, anon, authenticated;