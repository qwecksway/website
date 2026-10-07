create function public.admin_list_student_details()
returns table (
  id uuid,
  full_name text,
  email text,
  index_number text,
  programme text,
  residency text,
  form_class text
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
    select p.id, p.full_name, u.email::text, sd.index_number, sd.programme,
      sd.residency, sd.form_class
    from public.profiles as p
    join auth.users as u on u.id = p.id
    left join public.student_details as sd on sd.profile_id = p.id
    where p.role::text = 'student'
    order by p.full_name, u.email;
end;
$$;

create function public.admin_update_student_details(
  target_student_id uuid,
  target_full_name text,
  target_index_number text,
  target_programme text,
  target_residency text,
  target_form_class text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := trim(coalesce(target_full_name, ''));
  normalized_index text := upper(trim(coalesce(target_index_number, '')));
  normalized_programme text := trim(coalesce(target_programme, ''));
  normalized_residency text := trim(coalesce(target_residency, ''));
  normalized_class text := trim(coalesce(target_form_class, ''));
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if normalized_name = '' or char_length(normalized_name) > 120
    or normalized_index = '' or char_length(normalized_index) > 12
    or normalized_programme = '' or char_length(normalized_programme) > 120
    or char_length(normalized_residency) > 80
    or char_length(normalized_class) > 40
  then
    raise exception using errcode = '22023', message = 'Enter valid student details.';
  end if;

  perform 1 from public.profiles
  where id = target_student_id and role::text = 'student'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Select an active student account.';
  end if;

  update public.profiles
  set full_name = normalized_name
  where id = target_student_id;

  insert into public.student_details (
    profile_id, index_number, programme, residency, form_class, updated_at
  )
  values (
    target_student_id, normalized_index, normalized_programme,
    normalized_residency, normalized_class, now()
  )
  on conflict (profile_id) do update
    set index_number = excluded.index_number,
        programme = excluded.programme,
        residency = excluded.residency,
        form_class = excluded.form_class,
        updated_at = now();
end;
$$;

create function public.admin_update_staff_account_details(
  target_staff_id uuid,
  target_full_name text,
  target_position text,
  target_department text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := trim(coalesce(target_full_name, ''));
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
  if normalized_name = '' or char_length(normalized_name) > 120 then
    raise exception using errcode = '22023', message = 'Enter a valid staff name.';
  end if;

  perform 1 from public.profiles
  where id = target_staff_id and role::text = 'staff'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Select an active staff account.';
  end if;

  selected_positions := string_to_array(coalesce(target_position, ''), ',');
  if cardinality(selected_positions) = 0
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
    or (nullif(trim(target_department), '') is not null
      and not (trim(target_department) = any(allowed_departments)))
  then
    raise exception using errcode = '22023', message = 'Choose one or more approved job titles and an approved department.';
  end if;

  update public.profiles
  set full_name = normalized_name
  where id = target_staff_id;

  insert into public.staff_details (profile_id, position, department)
  values (
    target_staff_id,
    array_to_string(array(
      select trim(selected.title)
      from unnest(selected_positions) as selected(title)
    ), ', '),
    nullif(trim(target_department), '')
  )
  on conflict (profile_id) do update
    set position = excluded.position,
        department = excluded.department;
end;
$$;

revoke all on function public.admin_list_student_details() from public, anon;
revoke all on function public.admin_update_student_details(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.admin_update_staff_account_details(uuid, text, text, text) from public, anon;
grant execute on function public.admin_list_student_details() to authenticated;
grant execute on function public.admin_update_student_details(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_update_staff_account_details(uuid, text, text, text) to authenticated;
