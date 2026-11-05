-- Fixes for admin_apply_student_transcript():
-- 1. "profile_filled || 'date_of_birth'" (array || unknown-type literal) made Postgres
--    try to parse the plain string as an array literal, raising
--    "malformed array literal: \"date_of_birth\"" on every apply with a profile
--    detail to fill. Replaced with array_append(), which is unambiguous.
-- 2. Blank transcript rows (no subject, or a subject with neither a GPA nor a
--    final grade) used to hard-reject the whole transcript. They are now
--    silently dropped instead, so admins no longer have to manually delete
--    stray OCR rows before applying.
create or replace function public.admin_apply_student_transcript(
  target_student_id uuid,
  target_entries jsonb,
  target_profile jsonb default '{}'::jsonb,
  target_summary jsonb default '{}'::jsonb,
  apply_changes boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transcript_entry jsonb;
  year_level_text text;
  semester_no_text text;
  subject_text text;
  gpa_text text;
  grade_text text;
  entry_count integer;
  existing_id uuid;
  existing_gpa numeric;
  existing_grade text;
  new_gpa numeric;
  new_grade text;
  host_transcript_id uuid;
  added_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  profile_filled text[] := '{}';
  profile_conflicts text[] := '{}';
  summary_updated boolean := false;
  dob_text text := trim(coalesce(target_profile ->> 'date_of_birth', ''));
  admission_text text := trim(coalesce(target_profile ->> 'year_of_admission', ''));
  study_area_text text := trim(coalesce(target_profile ->> 'study_area', ''));
  cgpa_text text := trim(coalesce(target_summary ->> 'cumulative_gpa', ''));
  credits_text text := trim(coalesce(target_summary ->> 'credits_earned', ''));
  details public.student_details%rowtype;
  summary_row public.student_transcript_summaries%rowtype;
  dob_value date;
  admission_value smallint;
  cgpa_value numeric;
  credits_value numeric;
  has_changes boolean;
  result_status text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  if jsonb_typeof(target_entries) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Transcript rows must be provided as a list.';
  end if;
  select count(*)::integer into entry_count from jsonb_array_elements(target_entries);
  if entry_count < 1 or entry_count > 500 then
    raise exception using errcode = '22023', message = 'A transcript must contain between 1 and 500 rows.';
  end if;

  perform 1 from public.profiles where id = target_student_id and role::text = 'student';
  if not found then
    raise exception using errcode = '22023', message = 'Select an existing student account.';
  end if;

  -- Serialise merges for one student so concurrent uploads cannot duplicate rows.
  perform pg_advisory_xact_lock(hashtextextended(target_student_id::text, 0));

  if dob_text <> '' then
    if dob_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = '22023', message = 'Date of birth must use the YYYY-MM-DD format.';
    end if;
    dob_value := dob_text::date;
    if dob_value > current_date or dob_value < date '1950-01-01' then
      raise exception using errcode = '22023', message = 'Date of birth is outside the accepted range.';
    end if;
  end if;
  if admission_text <> '' then
    if admission_text !~ '^[0-9]{4}$' or admission_text::integer not between 1980 and 2100 then
      raise exception using errcode = '22023', message = 'Year of admission is invalid.';
    end if;
    admission_value := admission_text::smallint;
  end if;
  if char_length(study_area_text) > 120 then
    raise exception using errcode = '22023', message = 'Study area is too long.';
  end if;
  if cgpa_text <> '' then
    if cgpa_text !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then
      raise exception using errcode = '22023', message = 'Cumulative GPA is invalid.';
    end if;
    cgpa_value := cgpa_text::numeric;
  end if;
  if credits_text <> '' then
    if credits_text !~ '^[0-9]{1,6}([.][0-9])?$' then
      raise exception using errcode = '22023', message = 'Credits earned is invalid.';
    end if;
    credits_value := credits_text::numeric;
  end if;

  for transcript_entry in select value from jsonb_array_elements(target_entries)
  loop
    year_level_text := trim(coalesce(transcript_entry ->> 'year_level', ''));
    semester_no_text := trim(coalesce(transcript_entry ->> 'semester_no', ''));
    subject_text := regexp_replace(trim(coalesce(transcript_entry ->> 'subject_name', '')), '\s+', ' ', 'g');
    gpa_text := trim(coalesce(transcript_entry ->> 'grade_point_average', ''));
    grade_text := trim(coalesce(transcript_entry ->> 'final_grade', ''));

    -- Blank rows (no subject, or a subject with neither a GPA nor a final grade) are
    -- dropped automatically instead of blocking the whole transcript.
    if subject_text = '' or (gpa_text = '' and grade_text = '') then
      continue;
    end if;

    if year_level_text not in ('1', '2', '3')
      or semester_no_text not in ('1', '2')
      or char_length(subject_text) > 120
      or (gpa_text <> '' and gpa_text !~ '^[0-9]{1,6}([.][0-9]{1,3})?$')
      or (grade_text <> '' and char_length(grade_text) > 24)
    then
      raise exception using errcode = '22023', message = 'A transcript row contains invalid year, semester, subject, GPA, or final grade data.';
    end if;

    new_gpa := nullif(gpa_text, '')::numeric;
    new_grade := nullif(grade_text, '');

    existing_id := null;
    select e.id, e.grade_point_average, e.final_grade
    into existing_id, existing_gpa, existing_grade
    from public.student_transcript_entries as e
    join public.student_transcripts as t on t.id = e.transcript_id
    where t.student_id = target_student_id
      and t.status = 'published'
      and e.year_level = year_level_text::smallint
      and e.semester_no = semester_no_text::smallint
      and lower(trim(e.subject_name)) = lower(subject_text)
    order by t.published_at desc, e.created_at desc
    limit 1;

    if existing_id is null then
      added_count := added_count + 1;
      if apply_changes then
        if host_transcript_id is null then
          select t.id into host_transcript_id
          from public.student_transcripts as t
          where t.student_id = target_student_id and t.status = 'published'
          order by t.published_at desc
          limit 1;
          if host_transcript_id is null then
            insert into public.student_transcripts (student_id, imported_by, status, published_at)
            values (target_student_id, (select auth.uid()), 'published', now())
            returning id into host_transcript_id;
          end if;
        end if;
        insert into public.student_transcript_entries (
          transcript_id, year_level, semester_no, subject_name,
          grade_point_average, final_grade, row_order
        )
        values (
          host_transcript_id, year_level_text::smallint, semester_no_text::smallint,
          subject_text, new_gpa, new_grade,
          coalesce((select max(row_order) from public.student_transcript_entries
                    where transcript_id = host_transcript_id), 0) + 1
        );
      end if;
    elsif existing_gpa is not distinct from new_gpa and existing_grade is not distinct from new_grade then
      unchanged_count := unchanged_count + 1;
    else
      updated_count := updated_count + 1;
      if apply_changes then
        update public.student_transcript_entries
        set grade_point_average = new_gpa, final_grade = new_grade
        where id = existing_id;
      end if;
    end if;
  end loop;

  -- Vital details are only ever filled when currently blank.
  select * into details from public.student_details where profile_id = target_student_id;
  if found then
    if dob_value is not null then
      if details.date_of_birth is null then
        profile_filled := array_append(profile_filled, 'date_of_birth');
      elsif details.date_of_birth <> dob_value then
        profile_conflicts := array_append(profile_conflicts, 'date_of_birth');
      end if;
    end if;
    if admission_value is not null then
      if details.year_of_admission is null then
        profile_filled := array_append(profile_filled, 'year_of_admission');
      elsif details.year_of_admission <> admission_value then
        profile_conflicts := array_append(profile_conflicts, 'year_of_admission');
      end if;
    end if;
    if study_area_text <> '' and nullif(trim(coalesce(details.programme, '')), '') is null then
      profile_filled := array_append(profile_filled, 'study_area');
    end if;

    if apply_changes and array_length(profile_filled, 1) is not null then
      update public.student_details
      set date_of_birth = case when 'date_of_birth' = any (profile_filled) then dob_value else date_of_birth end,
          year_of_admission = case when 'year_of_admission' = any (profile_filled) then admission_value else year_of_admission end,
          programme = case when 'study_area' = any (profile_filled) then study_area_text else programme end
      where profile_id = target_student_id;
    end if;
  end if;

  -- A re-upload of an older transcript never overwrites a newer cumulative summary.
  if cgpa_value is not null or credits_value is not null then
    select * into summary_row from public.student_transcript_summaries
    where student_id = target_student_id;
    if not found then
      summary_updated := true;
    elsif (added_count + updated_count) > 0
      and (summary_row.cumulative_gpa is distinct from coalesce(cgpa_value, summary_row.cumulative_gpa)
        or summary_row.credits_earned is distinct from coalesce(credits_value, summary_row.credits_earned))
    then
      summary_updated := true;
    end if;
    if apply_changes and summary_updated then
      insert into public.student_transcript_summaries (student_id, cumulative_gpa, credits_earned)
      values (target_student_id, cgpa_value, credits_value)
      on conflict (student_id) do update
      set cumulative_gpa = coalesce(excluded.cumulative_gpa, public.student_transcript_summaries.cumulative_gpa),
          credits_earned = coalesce(excluded.credits_earned, public.student_transcript_summaries.credits_earned),
          updated_at = now();
    end if;
  end if;

  has_changes := added_count + updated_count > 0
    or array_length(profile_filled, 1) is not null
    or summary_updated;
  result_status := case
    when not has_changes then 'unchanged'
    when updated_count > 0 then 'updated'
    else 'new'
  end;

  return jsonb_build_object(
    'status', result_status,
    'added', added_count,
    'updated', updated_count,
    'unchanged', unchanged_count,
    'profile_filled', to_jsonb(profile_filled),
    'profile_conflicts', to_jsonb(profile_conflicts),
    'summary_updated', summary_updated,
    'applied', apply_changes and has_changes
  );
end;
$$;

revoke all on function public.admin_apply_student_transcript(uuid, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.admin_apply_student_transcript(uuid, jsonb, jsonb, jsonb, boolean) to authenticated;
