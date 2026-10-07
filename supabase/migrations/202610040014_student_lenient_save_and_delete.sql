-- Lenient admin save: blank fields leave the stored value unchanged.
create or replace function public.admin_save_student_record(
  target_student_id uuid,
  target_first_name text,
  target_other_names text,
  target_last_name text,
  target_date_of_birth date,
  target_gender text,
  target_index_number text,
  target_programme text,
  target_residency text,
  target_form_class text,
  target_place_of_birth text,
  target_hometown text,
  target_guardian_name text,
  target_guardian_contact text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.student_details%rowtype;
  given_name text := nullif(trim(coalesce(target_first_name, '')), '');
  middle_names text := nullif(trim(coalesce(target_other_names, '')), '');
  family_name text := nullif(trim(coalesce(target_last_name, '')), '');
  gender_value text := nullif(trim(coalesce(target_gender, '')), '');
  index_value text := nullif(upper(trim(coalesce(target_index_number, ''))), '');
  programme_value text := nullif(trim(coalesce(target_programme, '')), '');
  residency_value text := nullif(trim(coalesce(target_residency, '')), '');
  class_value text := nullif(trim(coalesce(target_form_class, '')), '');
  pob_value text := nullif(trim(coalesce(target_place_of_birth, '')), '');
  hometown_value text := nullif(trim(coalesce(target_hometown, '')), '');
  guardian_value text := nullif(trim(coalesce(target_guardian_name, '')), '');
  contact_value text := nullif(trim(coalesce(target_guardian_contact, '')), '');
  composed_name text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if char_length(coalesce(given_name, '')) > 60 or char_length(coalesce(family_name, '')) > 60
    or char_length(coalesce(middle_names, '')) > 80
    or char_length(coalesce(index_value, '')) > 12
    or char_length(coalesce(programme_value, '')) > 120
    or char_length(coalesce(residency_value, '')) > 80
    or char_length(coalesce(class_value, '')) > 40
    or char_length(coalesce(pob_value, '')) > 120
    or char_length(coalesce(hometown_value, '')) > 120
    or char_length(coalesce(guardian_value, '')) > 120
  then
    raise exception using errcode = '22023', message = 'One of the values is too long.';
  end if;
  if target_date_of_birth is not null
    and (target_date_of_birth > current_date or target_date_of_birth < date '1950-01-01')
  then
    raise exception using errcode = '22023', message = 'Enter a valid date of birth.';
  end if;
  if gender_value is not null and gender_value not in ('Male', 'Female') then
    raise exception using errcode = '22023', message = 'Gender must be Male or Female.';
  end if;
  if contact_value is not null and contact_value !~ '^[0-9+ ()-]{7,30}$' then
    raise exception using errcode = '22023', message = 'Enter a valid contact number.';
  end if;

  perform 1 from public.profiles
  where id = target_student_id and role::text = 'student'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Select an active student account.';
  end if;

  if index_value is not null and exists (
    select 1 from public.student_details as other
    where lower(trim(other.index_number)) = lower(index_value)
      and other.profile_id <> target_student_id
  ) then
    raise exception using errcode = '23505', message = 'Another student already uses that CassRefID.';
  end if;

  select * into cur from public.student_details where profile_id = target_student_id;

  insert into public.student_details (
    profile_id, index_number, programme, residency, form_class,
    first_name, other_names, last_name, date_of_birth, gender,
    place_of_birth, hometown, guardian_name, guardian_contact, updated_at
  )
  values (
    target_student_id,
    coalesce(index_value, cur.index_number, ''),
    coalesce(programme_value, cur.programme, ''),
    coalesce(residency_value, cur.residency, ''),
    coalesce(class_value, cur.form_class, ''),
    coalesce(given_name, cur.first_name),
    coalesce(middle_names, cur.other_names),
    coalesce(family_name, cur.last_name),
    coalesce(target_date_of_birth, cur.date_of_birth),
    coalesce(gender_value, cur.gender),
    coalesce(pob_value, cur.place_of_birth),
    coalesce(hometown_value, cur.hometown),
    coalesce(guardian_value, cur.guardian_name),
    coalesce(contact_value, cur.guardian_contact),
    now()
  )
  on conflict (profile_id) do update
    set index_number = excluded.index_number,
        programme = excluded.programme,
        residency = excluded.residency,
        form_class = excluded.form_class,
        first_name = excluded.first_name,
        other_names = excluded.other_names,
        last_name = excluded.last_name,
        date_of_birth = excluded.date_of_birth,
        gender = excluded.gender,
        place_of_birth = excluded.place_of_birth,
        hometown = excluded.hometown,
        guardian_name = excluded.guardian_name,
        guardian_contact = excluded.guardian_contact,
        updated_at = now();

  select nullif(trim(regexp_replace(
    concat_ws(' ', first_name, other_names, last_name), '\s+', ' ', 'g'
  )), '') into composed_name
  from public.student_details where profile_id = target_student_id;
  if composed_name is not null and (given_name is not null or family_name is not null or middle_names is not null) then
    update public.profiles set full_name = composed_name where id = target_student_id;
  end if;
end;
$$;

-- Permanently delete a student account and its records.
create or replace function public.admin_delete_student(target_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  perform 1 from public.profiles
  where id = target_student_id and role::text = 'student';
  if not found then
    raise exception using errcode = '22023', message = 'Select an active student account.';
  end if;

  delete from public.student_fee_status_audit where student_id = target_student_id;
  delete from public.admin_role_audit where target_user_id = target_student_id;
  delete from storage.objects
  where bucket_id = 'student-photos' and (storage.foldername(name))[1] = target_student_id::text;
  delete from public.student_details where profile_id = target_student_id;
  delete from public.profiles where id = target_student_id;
  delete from auth.users where id = target_student_id;
end;
$$;

revoke all on function public.admin_delete_student(uuid) from public, anon;
grant execute on function public.admin_delete_student(uuid) to authenticated;