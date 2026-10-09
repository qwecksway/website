-- Score import no longer asks for a class: each student is matched by RefID and
-- the score is saved against the subject in the class the student is enrolled in.
drop function if exists public.admin_import_scores(uuid, uuid, uuid, numeric, jsonb, boolean);

create or replace function public.admin_import_scores(
  target_subject_id uuid,
  target_assessment_type_id uuid,
  target_max_score numeric,
  target_rows jsonb,
  commit_changes boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  year_row record;
  term_row record;
  type_row record;
  cs_id uuid;
  v_assessment uuid;
  v_class uuid;
  v_class_name text;
  item jsonb;
  ref text;
  raw_score text;
  score_value numeric;
  v_student uuid;
  v_name text;
  state text;
  out_rows jsonb := '[]'::jsonb;
  saved_count integer := 0;
  problem_count integer := 0;
  subject_label text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if target_rows is null or jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) = 0 then
    raise exception using errcode = '22023', message = 'The file has no score rows.';
  end if;
  if jsonb_array_length(target_rows) > 5000 then
    raise exception using errcode = '22023', message = 'Import at most 5000 rows at a time.';
  end if;
  if target_max_score is null or target_max_score <= 0 or target_max_score > 100 then
    raise exception using errcode = '22023', message = 'Scores must be out of a value between 1 and 100.';
  end if;

  select id, name into year_row from public.academic_years where is_current limit 1;
  if year_row.id is null then
    raise exception using errcode = 'P0002', message = 'Set a current academic year in Academic setup first.';
  end if;
  select id, name into term_row from public.academic_terms where is_current limit 1;
  if term_row.id is null then
    raise exception using errcode = 'P0002', message = 'Set a current semester in Academic setup first.';
  end if;
  select id, name, default_weighting into type_row
  from public.assessment_types where id = target_assessment_type_id and is_active;
  if type_row.id is null then
    raise exception using errcode = '22023', message = 'Choose an active assessment type.';
  end if;
  select s.name into subject_label from public.academic_subjects as s where s.id = target_subject_id;
  if subject_label is null then
    raise exception using errcode = '22023', message = 'Choose a valid subject.';
  end if;

  for item in select * from jsonb_array_elements(target_rows) loop
    ref := upper(trim(coalesce(item->>'ref', '')));
    raw_score := trim(coalesce(item->>'score', ''));
    v_student := null; v_name := null; v_class := null; v_class_name := null;
    score_value := null; state := 'ok';

    if ref = '' then
      state := 'Missing RefID';
    elsif raw_score !~ '^-?[0-9]+(\.[0-9]+)?$' then
      state := 'Score is not a number';
    else
      score_value := raw_score::numeric;
      if score_value < 0 or score_value > target_max_score then
        state := 'Score outside 0 to ' || target_max_score::text;
      end if;
    end if;

    if state = 'ok' then
      select p.id, p.full_name into v_student, v_name
      from public.student_details as sd
      join public.profiles as p on p.id = sd.profile_id and p.role::text = 'student'
      where upper(trim(sd.index_number)) = ref
      limit 1;
      if v_student is null then
        state := 'RefID not found in the system';
      else
        select e.class_id, c.name into v_class, v_class_name
        from public.academic_enrolments as e
        join public.academic_classes as c on c.id = e.class_id
        where e.student_id = v_student and e.academic_year_id = year_row.id;
        if v_class is null then
          state := 'Student has no class assigned for ' || year_row.name;
        end if;
      end if;
    end if;

    if state = 'ok' then
      saved_count := saved_count + 1;
      if commit_changes then
        insert into public.academic_class_subjects (class_id, subject_id, academic_year_id)
        values (v_class, target_subject_id, year_row.id)
        on conflict (class_id, subject_id, academic_year_id) do nothing;
        select cs.id into cs_id from public.academic_class_subjects as cs
        where cs.class_id = v_class and cs.subject_id = target_subject_id and cs.academic_year_id = year_row.id;

        insert into public.academic_assessments
          (class_subject_id, term_id, title, max_score, status, created_by, submitted_at, published_at, assessment_type_id, weighting)
        values (cs_id, term_row.id, type_row.name, target_max_score, 'published', caller_id, now(), now(), type_row.id, type_row.default_weighting)
        on conflict (class_subject_id, term_id, title) do update
          set max_score = excluded.max_score, status = 'published', published_at = now(),
              assessment_type_id = excluded.assessment_type_id, weighting = excluded.weighting
        returning id into v_assessment;

        insert into public.academic_results (assessment_id, student_id, score, entered_by)
        values (v_assessment, v_student, round(score_value, 2), caller_id)
        on conflict (assessment_id, student_id) do update
          set score = excluded.score, entered_by = excluded.entered_by, updated_at = now();
      end if;
    else
      problem_count := problem_count + 1;
    end if;

    out_rows := out_rows || jsonb_build_object(
      'ref', ref, 'name', v_name, 'class', v_class_name, 'score', raw_score, 'status', state);
  end loop;

  return jsonb_build_object(
    'saved', saved_count, 'problems', problem_count, 'rows', out_rows,
    'subject', subject_label, 'assessment', type_row.name,
    'year', year_row.name, 'term', term_row.name, 'committed', commit_changes and saved_count > 0
  );
end;
$$;

revoke all on function public.admin_import_scores(uuid, uuid, numeric, jsonb, boolean) from public, anon;
grant execute on function public.admin_import_scores(uuid, uuid, numeric, jsonb, boolean) to authenticated;