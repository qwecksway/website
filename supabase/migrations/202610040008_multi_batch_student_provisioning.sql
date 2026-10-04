create or replace function public.service_import_student_records(
  target_year_name text,
  target_class_name text,
  target_make_current boolean,
  target_students jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_year_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service access required.';
  end if;
  if target_year_name is null
    or nullif(trim(target_class_name), '') is null
    or length(trim(target_class_name)) > 80
    or target_make_current is null
    or jsonb_typeof(target_students) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Provide a valid student roster and academic year.';
  end if;
  if jsonb_array_length(target_students) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'The roster must contain between 1 and 500 students.';
  end if;

  select y.id
  into target_year_id
  from public.academic_years as y
  where lower(trim(y.name)) = lower(trim(target_year_name));
  if target_year_id is null then
    raise exception using errcode = '22023', message = 'The selected academic year does not exist.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_students) as student(
      profile_id uuid,
      full_name text,
      index_number text,
      programme text
    )
    where student.profile_id is null
      or nullif(trim(student.full_name), '') is null
      or nullif(trim(student.index_number), '') is null
      or nullif(trim(student.programme), '') is null
  ) then
    raise exception using errcode = '22023', message = 'Every student must have an account, name, index number, and learning area.';
  end if;

  if exists (
    select student.index_number
    from jsonb_to_recordset(target_students) as student(
      profile_id uuid,
      full_name text,
      index_number text,
      programme text
    )
    group by student.index_number
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'The roster contains duplicate index numbers.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_students) as student(
      profile_id uuid,
      full_name text,
      index_number text,
      programme text
    )
    join public.student_details as existing
      on lower(trim(existing.index_number)) = lower(trim(student.index_number))
  ) then
    raise exception using errcode = '23505', message = 'A student index number is already in the database.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_students) as student(
      profile_id uuid,
      full_name text,
      index_number text,
      programme text
    )
    left join public.profiles as p on p.id = student.profile_id
    where p.role::text is distinct from 'student'
  ) then
    raise exception using errcode = '22023', message = 'Every imported account must have the Student portal role.';
  end if;

  insert into public.academic_programmes (name)
  select distinct trim(student.programme)
  from jsonb_to_recordset(target_students) as student(
    profile_id uuid,
    full_name text,
    index_number text,
    programme text
  )
  on conflict (name_key) do nothing;

  insert into public.academic_classes (programme_id, name)
  select distinct programme.id, trim(target_class_name)
  from jsonb_to_recordset(target_students) as student(
    profile_id uuid,
    full_name text,
    index_number text,
    programme text
  )
  join public.academic_programmes as programme
    on programme.name_key = lower(trim(student.programme))
  on conflict (programme_id, name_key) do nothing;

  insert into public.student_details (profile_id, index_number, programme, form_class)
  select student.profile_id, trim(student.index_number), trim(student.programme), trim(target_class_name)
  from jsonb_to_recordset(target_students) as student(
    profile_id uuid,
    full_name text,
    index_number text,
    programme text
  )
  on conflict (profile_id) do update
    set index_number = excluded.index_number,
        programme = excluded.programme,
        form_class = excluded.form_class,
        updated_at = now();

  insert into public.academic_enrolments (student_id, class_id, academic_year_id)
  select student.profile_id, class.id, target_year_id
  from jsonb_to_recordset(target_students) as student(
    profile_id uuid,
    full_name text,
    index_number text,
    programme text
  )
  join public.academic_programmes as programme
    on programme.name_key = lower(trim(student.programme))
  join public.academic_classes as class
    on class.programme_id = programme.id
    and class.name_key = lower(trim(target_class_name))
  on conflict (student_id, academic_year_id) do update
    set class_id = excluded.class_id;

  if target_make_current then
    if not exists (
      select 1
      from public.academic_years
      where id = target_year_id and is_current
    ) then
      update public.academic_terms set is_current = false where is_current;
      update public.student_details
      set current_term = '', updated_at = now()
      where current_term <> '';
    end if;
    update public.academic_years set is_current = false where is_current;
    update public.academic_years set is_current = true where id = target_year_id;
  end if;

  return jsonb_array_length(target_students);
end;
$$;
