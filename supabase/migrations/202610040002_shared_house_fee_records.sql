create table public.school_houses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 100),
  name_key text generated always as (lower(name)) stored unique,
  created_at timestamptz not null default now()
);

create table public.staff_house_assignments (
  staff_id uuid not null references public.profiles (id) on delete cascade,
  house_id uuid not null references public.school_houses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, house_id)
);

alter table public.student_details
  add column current_term text not null default '',
  add column fees_status text not null default '',
  add column updated_at timestamptz not null default now(),
  add column house_id uuid references public.school_houses (id) on delete set null;

create index student_details_house_idx on public.student_details (house_id);
create index staff_house_assignments_house_idx on public.staff_house_assignments (house_id);

create table public.student_fee_status_audit (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles (id),
  changed_by uuid not null references public.profiles (id),
  previous_status text not null,
  new_status text not null,
  changed_at timestamptz not null default now()
);

create index student_fee_status_audit_student_changed_idx
  on public.student_fee_status_audit (student_id, changed_at desc);

alter table public.school_houses enable row level security;
alter table public.staff_house_assignments enable row level security;
alter table public.student_fee_status_audit enable row level security;

revoke all on public.school_houses, public.staff_house_assignments,
  public.student_fee_status_audit from anon, authenticated;

create function public.list_house_fee_records()
returns table (
  student_id uuid,
  full_name text,
  house_name text,
  fees_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role text;
begin
  caller_role := (select public.current_portal_role())::text;
  if caller_role is null or caller_role not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'Administrator or staff access required.';
  end if;

  return query
    select p.id, p.full_name, h.name, sd.fees_status
    from public.student_details as sd
    join public.profiles as p on p.id = sd.profile_id
    left join public.school_houses as h on h.id = sd.house_id
    where p.role::text = 'student'
      and (
        caller_role = 'admin'
        or exists (
          select 1
          from public.staff_house_assignments as sha
          where sha.staff_id = (select auth.uid())
            and sha.house_id = sd.house_id
        )
      )
    order by h.name nulls last, p.full_name, p.id;
end;
$$;

create function public.update_student_fee_status(
  target_student_id uuid,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text := (select public.current_portal_role())::text;
  current_house_id uuid;
  previous_status text;
begin
  if caller_role is null or caller_role not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'Administrator or staff access required.';
  end if;

  if next_status is null or length(trim(next_status)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Fee status must contain between 1 and 120 characters.';
  end if;

  select sd.house_id, sd.fees_status
  into current_house_id, previous_status
  from public.student_details as sd
  join public.profiles as student on student.id = sd.profile_id
  where sd.profile_id = target_student_id
    and student.role::text = 'student'
  for update of sd;

  if not found then
    raise exception using errcode = 'P0002', message = 'Student record not found.';
  end if;

  if caller_role = 'staff' and not exists (
    select 1
    from public.staff_house_assignments as sha
    where sha.staff_id = caller_id
      and sha.house_id = current_house_id
  ) then
    raise exception using errcode = '42501', message = 'You are not assigned to this student''s house.';
  end if;

  update public.student_details
  set fees_status = trim(next_status), updated_at = now()
  where profile_id = target_student_id;

  if previous_status is distinct from trim(next_status) then
    insert into public.student_fee_status_audit (
      student_id, changed_by, previous_status, new_status
    )
    values (target_student_id, caller_id, previous_status, trim(next_status));
  end if;
end;
$$;

create function public.admin_list_houses()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  return query select h.id, h.name from public.school_houses as h order by h.name;
end;
$$;

create function public.admin_save_house(target_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_house_id uuid;
  normalized_name text := trim(target_name);
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if normalized_name is null or length(normalized_name) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'House name must contain between 1 and 100 characters.';
  end if;

  insert into public.school_houses (name)
  values (normalized_name)
  on conflict (name_key) do nothing;

  select h.id into saved_house_id
  from public.school_houses as h
  where h.name_key = lower(normalized_name);

  return saved_house_id;
end;
$$;

create function public.admin_assign_person_to_house(
  target_user_id uuid,
  target_house_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  select p.role::text into target_role
  from public.profiles as p
  where p.id = target_user_id;

  if target_role is null or target_role not in ('student', 'staff') then
    raise exception using errcode = '22023', message = 'Only an active student or staff account can be assigned to a house.';
  end if;
  if not exists (select 1 from public.school_houses where id = target_house_id) then
    raise exception using errcode = 'P0002', message = 'House not found.';
  end if;

  if target_role = 'student' then
    insert into public.student_details (profile_id, house_id)
    values (target_user_id, target_house_id)
    on conflict (profile_id) do update set house_id = excluded.house_id;
  else
    insert into public.staff_house_assignments (staff_id, house_id)
    values (target_user_id, target_house_id)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.list_house_fee_records() from public, anon;
revoke all on function public.update_student_fee_status(uuid, text) from public, anon;
revoke all on function public.admin_list_houses() from public, anon;
revoke all on function public.admin_save_house(text) from public, anon;
revoke all on function public.admin_assign_person_to_house(uuid, uuid) from public, anon;

grant execute on function public.list_house_fee_records() to authenticated;
grant execute on function public.update_student_fee_status(uuid, text) to authenticated;
grant execute on function public.admin_list_houses() to authenticated;
grant execute on function public.admin_save_house(text) to authenticated;
grant execute on function public.admin_assign_person_to_house(uuid, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'Supabase Realtime publication "supabase_realtime" is missing.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'student_details'
  ) then
    execute 'alter publication supabase_realtime add table public.student_details';
  end if;
end;
$$;
