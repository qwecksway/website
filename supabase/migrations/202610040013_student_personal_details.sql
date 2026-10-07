-- Student personal details: expanded fields, admin search/save, student self-service,
-- and a private bucket for passport photographs.

alter table public.student_details
  add column if not exists first_name text,
  add column if not exists other_names text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists place_of_birth text,
  add column if not exists hometown text,
  add column if not exists guardian_name text,
  add column if not exists guardian_contact text,
  add column if not exists photo_path text;

alter table public.student_details
  add constraint student_details_personal_fields_check check (
    (first_name is null or char_length(first_name) <= 60)
    and (other_names is null or char_length(other_names) <= 80)
    and (last_name is null or char_length(last_name) <= 60)
    and (gender is null or gender in ('Male', 'Female'))
    and (place_of_birth is null or char_length(place_of_birth) <= 120)
    and (hometown is null or char_length(hometown) <= 120)
    and (guardian_name is null or char_length(guardian_name) <= 120)
    and (guardian_contact is null or char_length(guardian_contact) <= 30)
    and (photo_path is null or char_length(photo_path) <= 200)
  );

create index if not exists student_details_last_name_idx
  on public.student_details (lower(last_name));
create index if not exists student_details_dob_idx
  on public.student_details (date_of_birth);

-- ---------------------------------------------------------------------------
-- Admin: list and search students with the full record
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_student_details();

create function public.admin_list_student_details()
returns table (
  id uuid,
  full_name text,
  email text,
  index_number text,
  programme text,
  residency text,
  form_class text,
  first_name text,
  other_names text,
  last_name text,
  date_of_birth date,
  gender text,
  place_of_birth text,
  hometown text,
  guardian_name text,
  guardian_contact text,
  photo_path text
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
      sd.residency, sd.form_class, sd.first_name, sd.other_names, sd.last_name,
      sd.date_of_birth, sd.gender, sd.place_of_birth, sd.hometown,
      sd.guardian_name, sd.guardian_contact, sd.photo_path
    from public.profiles as p
    join auth.users as u on u.id = p.id
    left join public.student_details as sd on sd.profile_id = p.id
    where p.role::text = 'student'
    order by p.full_name, u.email;
end;
$$;

create function public.admin_search_students(
  target_query text default null,
  target_dob date default null
)
returns table (
  id uuid,
  full_name text,
  email text,
  index_number text,
  programme text,
  residency text,
  form_class text,
  first_name text,
  other_names text,
  last_name text,
  date_of_birth date,
  gender text,
  place_of_birth text,
  hometown text,
  guardian_name text,
  guardian_contact text,
  photo_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  needle text := lower(trim(coalesce(target_query, '')));
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if needle = '' and target_dob is null then
    raise exception using errcode = '22023', message = 'Enter a first name, last name, or date of birth to search.';
  end if;
  if char_length(needle) > 80 then
    raise exception using errcode = '22023', message = 'The search text is too long.';
  end if;

  return query
    select p.id, p.full_name, u.email::text, sd.index_number, sd.programme,
      sd.residency, sd.form_class, sd.first_name, sd.other_names, sd.last_name,
      sd.date_of_birth, sd.gender, sd.place_of_birth, sd.hometown,
      sd.guardian_name, sd.guardian_contact, sd.photo_path
    from public.profiles as p
    join auth.users as u on u.id = p.id
    left join public.student_details as sd on sd.profile_id = p.id
    where p.role::text = 'student'
      and (
        needle = ''
        or position(needle in lower(coalesce(sd.first_name, ''))) > 0
        or position(needle in lower(coalesce(sd.last_name, ''))) > 0
        or position(needle in lower(coalesce(sd.other_names, ''))) > 0
        or position(needle in lower(coalesce(p.full_name, ''))) > 0
      )
      and (target_dob is null or sd.date_of_birth = target_dob)
    order by p.full_name, u.email
    limit 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: save the whole student record (name parts, identity, academic, family)
-- ---------------------------------------------------------------------------
create function public.admin_save_student_record(
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
  given_name text := trim(coalesce(target_first_name, ''));
  middle_names text := nullif(trim(coalesce(target_other_names, '')), '');
  family_name text := trim(coalesce(target_last_name, ''));
  gender_value text := nullif(trim(coalesce(target_gender, '')), '');
  index_value text := upper(trim(coalesce(target_index_number, '')));
  programme_value text := trim(coalesce(target_programme, ''));
  residency_value text := trim(coalesce(target_residency, ''));
  class_value text := trim(coalesce(target_form_class, ''));
  pob_value text := nullif(trim(coalesce(target_place_of_birth, '')), '');
  hometown_value text := nullif(trim(coalesce(target_hometown, '')), '');
  guardian_value text := nullif(trim(coalesce(target_guardian_name, '')), '');
  contact_value text := nullif(trim(coalesce(target_guardian_contact, '')), '');
  composed_name text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if given_name = '' or char_length(given_name) > 60
    or family_name = '' or char_length(family_name) > 60
    or (middle_names is not null and char_length(middle_names) > 80)
  then
    raise exception using errcode = '22023', message = 'Enter a first name and last name (other names are optional).';
  end if;
  if target_date_of_birth is null
    or target_date_of_birth > current_date
    or target_date_of_birth < date '1950-01-01'
  then
    raise exception using errcode = '22023', message = 'Enter a valid date of birth.';
  end if;
  if gender_value is not null and gender_value not in ('Male', 'Female') then
    raise exception using errcode = '22023', message = 'Gender must be Male or Female.';
  end if;
  if index_value = '' or char_length(index_value) > 12
    or programme_value = '' or char_length(programme_value) > 120
    or char_length(residency_value) > 80
    or char_length(class_value) > 40
    or (pob_value is not null and char_length(pob_value) > 120)
    or (hometown_value is not null and char_length(hometown_value) > 120)
    or (guardian_value is not null and char_length(guardian_value) > 120)
  then
    raise exception using errcode = '22023', message = 'Enter valid student details.';
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

  if exists (
    select 1 from public.student_details as other
    where lower(trim(other.index_number)) = lower(index_value)
      and other.profile_id <> target_student_id
  ) then
    raise exception using errcode = '23505', message = 'Another student already uses that CassRefID.';
  end if;

  composed_name := trim(regexp_replace(
    concat_ws(' ', given_name, middle_names, family_name), '\s+', ' ', 'g'
  ));

  update public.profiles
  set full_name = composed_name
  where id = target_student_id;

  insert into public.student_details (
    profile_id, index_number, programme, residency, form_class,
    first_name, other_names, last_name, date_of_birth, gender,
    place_of_birth, hometown, guardian_name, guardian_contact, updated_at
  )
  values (
    target_student_id, index_value, programme_value, residency_value, class_value,
    given_name, middle_names, family_name, target_date_of_birth, gender_value,
    pob_value, hometown_value, guardian_value, contact_value, now()
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
end;
$$;

create function public.admin_set_student_photo(
  target_student_id uuid,
  target_photo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  path_value text := nullif(trim(coalesce(target_photo_path, '')), '');
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if path_value is not null
    and (char_length(path_value) > 200
      or left(path_value, char_length(target_student_id::text) + 1) <> target_student_id::text || '/')
  then
    raise exception using errcode = '22023', message = 'Invalid photograph location.';
  end if;

  update public.student_details
  set photo_path = path_value, updated_at = now()
  where profile_id = target_student_id;
  if not found then
    raise exception using errcode = '22023', message = 'Select a student with a saved record.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Student: read own details; edit only the unlocked fields
-- ---------------------------------------------------------------------------
create function public.student_get_my_details()
returns table (
  full_name text,
  first_name text,
  other_names text,
  last_name text,
  date_of_birth date,
  gender text,
  index_number text,
  programme text,
  residency text,
  form_class text,
  place_of_birth text,
  hometown text,
  guardian_name text,
  guardian_contact text,
  photo_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'student' then
    raise exception using errcode = '42501', message = 'Student access required.';
  end if;

  return query
    select p.full_name, sd.first_name, sd.other_names, sd.last_name,
      sd.date_of_birth, sd.gender, sd.index_number, sd.programme, sd.residency,
      sd.form_class, sd.place_of_birth, sd.hometown, sd.guardian_name,
      sd.guardian_contact, sd.photo_path
    from public.profiles as p
    left join public.student_details as sd on sd.profile_id = p.id
    where p.id = (select auth.uid());
end;
$$;

create function public.student_update_my_details(
  target_gender text,
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
  gender_value text := nullif(trim(coalesce(target_gender, '')), '');
  pob_value text := nullif(trim(coalesce(target_place_of_birth, '')), '');
  hometown_value text := nullif(trim(coalesce(target_hometown, '')), '');
  guardian_value text := nullif(trim(coalesce(target_guardian_name, '')), '');
  contact_value text := nullif(trim(coalesce(target_guardian_contact, '')), '');
begin
  if (select public.current_portal_role())::text is distinct from 'student' then
    raise exception using errcode = '42501', message = 'Student access required.';
  end if;
  if (gender_value is not null and gender_value not in ('Male', 'Female'))
    or (pob_value is not null and char_length(pob_value) > 120)
    or (hometown_value is not null and char_length(hometown_value) > 120)
    or (guardian_value is not null and char_length(guardian_value) > 120)
  then
    raise exception using errcode = '22023', message = 'Enter valid details.';
  end if;
  if contact_value is not null and contact_value !~ '^[0-9+ ()-]{7,30}$' then
    raise exception using errcode = '22023', message = 'Enter a valid contact number.';
  end if;

  update public.student_details
  set gender = gender_value,
      place_of_birth = pob_value,
      hometown = hometown_value,
      guardian_name = guardian_value,
      guardian_contact = contact_value,
      updated_at = now()
  where profile_id = (select auth.uid());
  if not found then
    raise exception using errcode = '22023', message = 'Your student record has not been created yet. Contact the school office.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service role: apply personal details after the roster import creates accounts
-- ---------------------------------------------------------------------------
create function public.service_apply_student_personal_details(target_students jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service access required.';
  end if;
  if jsonb_typeof(target_students) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Provide a student list.';
  end if;

  update public.student_details as sd
  set first_name = nullif(trim(s.first_name), ''),
      other_names = nullif(trim(s.other_names), ''),
      last_name = nullif(trim(s.last_name), ''),
      date_of_birth = s.date_of_birth,
      gender = nullif(trim(s.gender), ''),
      place_of_birth = nullif(trim(s.place_of_birth), ''),
      hometown = nullif(trim(s.hometown), ''),
      guardian_name = nullif(trim(s.guardian_name), ''),
      guardian_contact = nullif(trim(s.guardian_contact), ''),
      updated_at = now()
  from jsonb_to_recordset(target_students) as s(
    profile_id uuid,
    first_name text,
    other_names text,
    last_name text,
    date_of_birth date,
    gender text,
    place_of_birth text,
    hometown text,
    guardian_name text,
    guardian_contact text
  )
  where sd.profile_id = s.profile_id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.admin_list_student_details() from public, anon;
revoke all on function public.admin_search_students(text, date) from public, anon;
revoke all on function public.admin_save_student_record(uuid, text, text, text, date, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_set_student_photo(uuid, text) from public, anon;
revoke all on function public.student_get_my_details() from public, anon;
revoke all on function public.student_update_my_details(text, text, text, text, text) from public, anon;
revoke all on function public.service_apply_student_personal_details(jsonb) from public, anon, authenticated;

grant execute on function public.admin_list_student_details() to authenticated;
grant execute on function public.admin_search_students(text, date) to authenticated;
grant execute on function public.admin_save_student_record(uuid, text, text, text, date, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_set_student_photo(uuid, text) to authenticated;
grant execute on function public.student_get_my_details() to authenticated;
grant execute on function public.student_update_my_details(text, text, text, text, text) to authenticated;
grant execute on function public.service_apply_student_personal_details(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Passport photographs: private bucket, admin writes, students read their own
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "student photos read own or admin" on storage.objects;
drop policy if exists "student photos admin insert" on storage.objects;
drop policy if exists "student photos admin update" on storage.objects;
drop policy if exists "student photos admin delete" on storage.objects;

create policy "student photos read own or admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'student-photos'
    and (
      (select public.current_portal_role())::text = 'admin'
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

create policy "student photos admin insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'student-photos'
    and (select public.current_portal_role())::text = 'admin'
  );

create policy "student photos admin update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'student-photos'
    and (select public.current_portal_role())::text = 'admin'
  )
  with check (
    bucket_id = 'student-photos'
    and (select public.current_portal_role())::text = 'admin'
  );

create policy "student photos admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'student-photos'
    and (select public.current_portal_role())::text = 'admin'
  );
