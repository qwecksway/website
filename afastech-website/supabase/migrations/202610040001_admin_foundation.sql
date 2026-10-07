create function public.current_portal_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

revoke all on function public.current_portal_role() from public, anon;
grant execute on function public.current_portal_role() to authenticated;

alter table public.profiles alter column role drop default;
alter table public.profiles alter column role drop not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

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

alter table public.timetable_entries enable row level security;
alter table public.student_results enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.staff_gradebook_entries enable row level security;
alter table public.portal_announcements enable row level security;

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
  or audience = (select public.current_portal_role())::text
);

revoke all on public.timetable_entries, public.student_results,
  public.staff_assignments, public.staff_gradebook_entries,
  public.portal_announcements from anon, authenticated;

grant select on public.timetable_entries, public.student_results,
  public.staff_assignments, public.staff_gradebook_entries,
  public.portal_announcements to authenticated;

create table public.admin_role_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles (id),
  target_user_id uuid not null references public.profiles (id),
  previous_role public.user_role,
  new_role public.user_role not null check (new_role::text in ('student', 'staff')),
  changed_at timestamptz not null default now()
);

create index admin_role_audit_target_changed_idx
  on public.admin_role_audit (target_user_id, changed_at desc);

alter table public.admin_role_audit enable row level security;
revoke all on public.admin_role_audit from anon, authenticated;
grant select on public.admin_role_audit to authenticated;

create policy "Administrators read role audit"
on public.admin_role_audit for select to authenticated
using ((select public.current_portal_role())::text = 'admin');

create function public.admin_list_profiles()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  return query
    select p.id, u.email::text, p.full_name, p.role::text, p.created_at
    from public.profiles as p
    join auth.users as u on u.id = p.id
    order by p.created_at desc;
end;
$$;

create function public.admin_assign_profile_role(
  target_user_id uuid,
  target_role public.user_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_role public.user_role;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  if target_role is null or target_role::text not in ('student', 'staff') then
    raise exception using errcode = '22023', message = 'Only student or staff roles can be assigned here.';
  end if;

  select p.role into previous_role
  from public.profiles as p
  where p.id = target_user_id
  for update;

  if not found or previous_role::text = 'admin' then
    raise exception using errcode = 'P0002', message = 'No assignable portal account was found.';
  end if;

  if previous_role is distinct from target_role then
    update public.profiles
    set role = target_role
    where id = target_user_id;

    insert into public.admin_role_audit (actor_id, target_user_id, previous_role, new_role)
    values ((select auth.uid()), target_user_id, previous_role, target_role);
  end if;
end;
$$;

revoke all on function public.admin_list_profiles() from public, anon;
revoke all on function public.admin_assign_profile_role(uuid, public.user_role) from public, anon;
grant execute on function public.admin_list_profiles() to authenticated;
grant execute on function public.admin_assign_profile_role(uuid, public.user_role) to authenticated;
