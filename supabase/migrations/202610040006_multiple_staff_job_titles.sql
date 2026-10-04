create function public.staff_position_has_any_title(
  target_position text,
  required_titles text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from unnest(string_to_array(coalesce(target_position, ''), ',')) as selected(title)
    where lower(trim(selected.title)) = any(required_titles)
  );
$$;

revoke all on function public.staff_position_has_any_title(text, text[]) from public, anon, authenticated;

create or replace function public.admin_list_house_assignable_people()
returns table (
  id uuid,
  full_name text,
  role text,
  job_title text
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
    select p.id, p.full_name, 'student'::text, null::text
    from public.profiles as p
    where p.role::text = 'student'
    union all
    select p.id, p.full_name, p.role::text, sd.position
    from public.profiles as p
    join public.staff_details as sd on sd.profile_id = p.id
    where p.role::text = 'staff'
      and public.staff_position_has_any_title(sd.position, array['house master', 'house mistress'])
    order by 2;
end;
$$;

create or replace function public.admin_assign_person_to_house(
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
  target_position text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  select p.role::text, sd.position
  into target_role, target_position
  from public.profiles as p
  left join public.staff_details as sd on sd.profile_id = p.id
  where p.id = target_user_id;

  if target_role is null or target_role not in ('student', 'staff') then
    raise exception using errcode = '22023', message = 'Only an active student or designated House Master can be assigned to a house.';
  end if;
  if target_role = 'staff' and not public.staff_position_has_any_title(
    target_position,
    array['house master', 'house mistress']
  ) then
    raise exception using errcode = '42501', message = 'Only staff explicitly designated as a House Master or House Mistress can be assigned to a house.';
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

create or replace function public.list_house_fee_records()
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
  caller_position text;
begin
  caller_role := (select public.current_portal_role())::text;
  if caller_role is null or caller_role not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'Administrator or House Master access required.';
  end if;

  if caller_role = 'staff' then
    select sd.position into caller_position
    from public.staff_details as sd
    where sd.profile_id = (select auth.uid());
    if not public.staff_position_has_any_title(
      caller_position,
      array['house master', 'house mistress']
    ) then
      raise exception using errcode = '42501', message = 'House Master or House Mistress access required.';
    end if;
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

create or replace function public.update_student_fee_status(
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
  caller_position text;
  current_house_id uuid;
  previous_status text;
begin
  if caller_role is null or caller_role not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'Administrator or House Master access required.';
  end if;

  if caller_role = 'staff' then
    select sd.position into caller_position
    from public.staff_details as sd
    where sd.profile_id = caller_id;
    if not public.staff_position_has_any_title(
      caller_position,
      array['house master', 'house mistress']
    ) then
      raise exception using errcode = '42501', message = 'House Master or House Mistress access required.';
    end if;
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

create or replace function public.admin_update_staff_details(
  target_staff_id uuid,
  target_position text,
  target_department text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_positions constant text[] := array[
    'Teacher', 'House Master', 'House Mistress', 'Head of Department',
    'Assistant Head', 'Headteacher', 'Non-Teaching Staff'
  ];
  allowed_departments constant text[] := array[
    'MATHS/ICT', 'SCIENCE', 'ENGLISH', 'BUSINESS', 'TECHNICAL', 'HOME ECONOMICS'
  ];
  selected_positions text[];
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if not exists (
    select 1 from public.profiles where id = target_staff_id and role::text = 'staff'
  ) then
    raise exception using errcode = '22023', message = 'Select an active staff account.';
  end if;

  selected_positions := string_to_array(target_position, ',');
  if target_position is null
    or cardinality(selected_positions) = 0
    or exists (
      select 1
      from unnest(selected_positions) as selected(title)
      where trim(selected.title) = ''
        or not (trim(selected.title) = any(allowed_positions))
    )
    or cardinality(selected_positions) <> (
      select count(distinct trim(selected.title))
      from unnest(selected_positions) as selected(title)
    )
    or (nullif(target_department, '') is not null
      and not (target_department = any(allowed_departments)))
  then
    raise exception using errcode = '22023', message = 'Choose one or more approved job titles and an approved department.';
  end if;

  insert into public.staff_details (profile_id, position, department)
  values (target_staff_id, array_to_string(array(
    select trim(selected.title)
    from unnest(selected_positions) as selected(title)
  ), ', '), nullif(target_department, ''))
  on conflict (profile_id) do update
    set position = excluded.position,
        department = excluded.department;
end;
$$;

create or replace function public.staff_can_manage_house_fees()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_position text;
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;

  select sd.position into caller_position
  from public.staff_details as sd
  where sd.profile_id = (select auth.uid());

  return public.staff_position_has_any_title(
    caller_position,
    array['house master', 'house mistress']
  )
    and exists (
      select 1 from public.staff_house_assignments as sha
      where sha.staff_id = (select auth.uid())
    );
end;
$$;
