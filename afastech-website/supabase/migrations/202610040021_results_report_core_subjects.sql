-- 1. Core subjects automatically added to every class and academic year.
-- 2. Score-sheet (CSV/Excel) import matched on CassRefID, published per subject.
-- 3. Student results report (assessment-type columns, IC, grade scale, GPA/CGPA).
-- 4. Current academic year/semester and class pushed to the student dashboard and fees.

create or replace function public.ensure_core_subjects(target_class_id uuid, target_year_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.academic_subjects (name)
  values ('Mathematics'), ('General Science'), ('Social Studies'), ('English Language')
  on conflict (name_key) do nothing;

  insert into public.academic_class_subjects (class_id, subject_id, academic_year_id)
  select target_class_id, s.id, target_year_id
  from public.academic_subjects as s
  where s.name_key in ('mathematics', 'general science', 'social studies', 'english language')
  on conflict (class_id, subject_id, academic_year_id) do nothing;
end;
$$;
revoke all on function public.ensure_core_subjects(uuid, uuid) from public, anon, authenticated;

create or replace function public.core_subjects_on_class()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare y record;
begin
  for y in select id from public.academic_years loop
    perform public.ensure_core_subjects(new.id, y.id);
  end loop;
  return null;
end;
$$;

create or replace function public.core_subjects_on_year()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare c record;
begin
  for c in select id from public.academic_classes loop
    perform public.ensure_core_subjects(c.id, new.id);
  end loop;
  return null;
end;
$$;

create or replace function public.core_subjects_on_class_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public.ensure_core_subjects(new.class_id, new.academic_year_id);
  return null;
end;
$$;

drop trigger if exists core_subjects_after_class on public.academic_classes;
create trigger core_subjects_after_class after insert on public.academic_classes
  for each row execute function public.core_subjects_on_class();
drop trigger if exists core_subjects_after_year on public.academic_years;
create trigger core_subjects_after_year after insert on public.academic_years
  for each row execute function public.core_subjects_on_year();
drop trigger if exists core_subjects_after_class_subject on public.academic_class_subjects;
create trigger core_subjects_after_class_subject after insert on public.academic_class_subjects
  for each row execute function public.core_subjects_on_class_subject();

do $$
declare c record; y record;
begin
  for c in select id from public.academic_classes loop
    for y in select id from public.academic_years loop
      perform public.ensure_core_subjects(c.id, y.id);
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Score sheet import
-- ---------------------------------------------------------------------------
create or replace function public.admin_import_scores(
  target_class_id uuid,
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
  class_label text;
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
  select c.name into class_label from public.academic_classes as c where c.id = target_class_id;
  select s.name into subject_label from public.academic_subjects as s where s.id = target_subject_id;
  if class_label is null or subject_label is null then
    raise exception using errcode = '22023', message = 'Choose a valid class and subject.';
  end if;

  if commit_changes then
    perform public.ensure_core_subjects(target_class_id, year_row.id);
    insert into public.academic_class_subjects (class_id, subject_id, academic_year_id)
    values (target_class_id, target_subject_id, year_row.id)
    on conflict (class_id, subject_id, academic_year_id) do nothing;
    select cs.id into cs_id from public.academic_class_subjects as cs
    where cs.class_id = target_class_id and cs.subject_id = target_subject_id and cs.academic_year_id = year_row.id;
  end if;

  for item in select * from jsonb_array_elements(target_rows) loop
    ref := upper(trim(coalesce(item->>'ref', '')));
    raw_score := trim(coalesce(item->>'score', ''));
    v_student := null;
    v_name := null;
    score_value := null;
    state := 'ok';

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
      elsif not exists (
        select 1 from public.academic_enrolments as e
        where e.student_id = v_student and e.class_id = target_class_id and e.academic_year_id = year_row.id
      ) then
        state := 'Student is not in this class';
      end if;
    end if;

    if state = 'ok' then
      saved_count := saved_count + 1;
      if commit_changes then
        if v_assessment is null then
          insert into public.academic_assessments
            (class_subject_id, term_id, title, max_score, status, created_by, submitted_at, published_at, assessment_type_id, weighting)
          values (cs_id, term_row.id, type_row.name, target_max_score, 'published', caller_id, now(), now(), type_row.id, type_row.default_weighting)
          on conflict (class_subject_id, term_id, title) do update
            set max_score = excluded.max_score, status = 'published', published_at = now(),
                assessment_type_id = excluded.assessment_type_id, weighting = excluded.weighting
          returning id into v_assessment;
        end if;
        insert into public.academic_results (assessment_id, student_id, score, entered_by)
        values (v_assessment, v_student, round(score_value, 2), caller_id)
        on conflict (assessment_id, student_id) do update
          set score = excluded.score, entered_by = excluded.entered_by, updated_at = now();
      end if;
    else
      problem_count := problem_count + 1;
    end if;

    out_rows := out_rows || jsonb_build_object(
      'ref', ref, 'name', v_name, 'score', raw_score, 'status', state);
  end loop;

  return jsonb_build_object(
    'saved', saved_count, 'problems', problem_count, 'rows', out_rows,
    'class', class_label, 'subject', subject_label, 'assessment', type_row.name,
    'year', year_row.name, 'term', term_row.name, 'committed', commit_changes and saved_count > 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Student results report
-- ---------------------------------------------------------------------------
create or replace function public.student_my_results_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  default_scale uuid;
  scale_id uuid;
  types_json jsonb;
  terms_json jsonb := '[]'::jsonb;
  term_row record;
  subj record;
  typ record;
  cells jsonb;
  subjects_json jsonb;
  sc numeric;
  mx numeric;
  weighted numeric;
  wsum numeric;
  complete boolean;
  total numeric;
  g_letter text;
  g_point numeric;
  g_desc text;
  term_points numeric;
  term_count integer;
  term_ic integer;
  term_fail integer;
  all_points numeric := 0;
  all_count integer := 0;
  all_ic integer := 0;
  all_fail integer := 0;
begin
  if (select public.current_portal_role())::text is distinct from 'student' then
    raise exception using errcode = '42501', message = 'Student access required.';
  end if;

  select id into default_scale from public.grade_scales where is_default and is_active limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'short_code', t.short_code, 'weighting', t.default_weighting
  ) order by t.display_order, t.name), '[]'::jsonb)
  into types_json from public.assessment_types as t where t.is_active;

  for term_row in
    select t.id as term_id, t.name as term_name, t.sequence_no, t.is_current,
           y.id as year_id, y.name as year_name, y.grade_scale_id, e.class_id, c.name as class_name
    from public.academic_enrolments as e
    join public.academic_years as y on y.id = e.academic_year_id
    join public.academic_terms as t on t.academic_year_id = y.id
    join public.academic_classes as c on c.id = e.class_id
    where e.student_id = uid
      and (t.is_current or t.starts_on <= current_date or exists (
        select 1 from public.academic_results as r
        join public.academic_assessments as a on a.id = r.assessment_id
        where r.student_id = uid and a.term_id = t.id and a.status = 'published'))
    order by y.starts_on, t.sequence_no
  loop
    scale_id := coalesce(term_row.grade_scale_id, default_scale);
    subjects_json := '[]'::jsonb;
    term_points := 0; term_count := 0; term_ic := 0; term_fail := 0;

    for subj in
      select cs.id as cs_id, s.name, s.code
      from public.academic_class_subjects as cs
      join public.academic_subjects as s on s.id = cs.subject_id
      where cs.class_id = term_row.class_id and cs.academic_year_id = term_row.year_id
      order by s.name
    loop
      cells := '[]'::jsonb; weighted := 0; wsum := 0; complete := true;
      for typ in
        select id, default_weighting from public.assessment_types where is_active order by display_order, name
      loop
        select sum(r.score), sum(a.max_score) into sc, mx
        from public.academic_results as r
        join public.academic_assessments as a on a.id = r.assessment_id and a.status = 'published'
        where r.student_id = uid and a.class_subject_id = subj.cs_id
          and a.term_id = term_row.term_id and a.assessment_type_id = typ.id;
        if mx is null or mx = 0 then
          complete := false;
          cells := cells || jsonb_build_object('type_id', typ.id, 'score', null, 'max', null);
        else
          weighted := weighted + (sc / mx * 100) * typ.default_weighting;
          wsum := wsum + typ.default_weighting;
          cells := cells || jsonb_build_object('type_id', typ.id, 'score', sc, 'max', mx);
        end if;
      end loop;

      total := null; g_letter := 'IC'; g_point := 0; g_desc := 'Incomplete';
      if complete and wsum > 0 then
        total := round(weighted / wsum, 2);
        select b.grade_letter, b.grade_point, b.description into g_letter, g_point, g_desc
        from public.grade_scale_boundaries as b
        where b.grade_scale_id = scale_id and b.min_score <= total
        order by b.min_score desc limit 1;
        if g_letter is null then g_letter := 'N/A'; g_point := 0; g_desc := ''; end if;
        term_points := term_points + g_point; term_count := term_count + 1;
        if g_point = 0 then term_fail := term_fail + 1; end if;
      else
        complete := false;
        term_ic := term_ic + 1;
      end if;

      subjects_json := subjects_json || jsonb_build_object(
        'name', subj.name, 'code', subj.code, 'cells', cells, 'total', total,
        'grade', g_letter, 'grade_point', g_point, 'description', coalesce(g_desc, ''), 'complete', complete);
    end loop;

    all_points := all_points + term_points; all_count := all_count + term_count;
    all_ic := all_ic + term_ic; all_fail := all_fail + term_fail;

    terms_json := terms_json || jsonb_build_object(
      'year', term_row.year_name, 'term', term_row.term_name, 'sequence', term_row.sequence_no,
      'is_current', term_row.is_current, 'class_name', term_row.class_name,
      'subjects', subjects_json,
      'gpa', case when term_count > 0 then round(term_points / term_count, 2) else 0 end,
      'ic_count', term_ic, 'fail_count', term_fail);
  end loop;

  return jsonb_build_object(
    'types', types_json, 'terms', terms_json,
    'cgpa', case when all_count > 0 then round(all_points / all_count, 2) else 0 end,
    'ic_total', all_ic, 'fail_total', all_fail);
end;
$$;

-- ---------------------------------------------------------------------------
-- Current academic year / semester / class for the student dashboard
-- ---------------------------------------------------------------------------
create or replace function public.student_academic_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'academic_year', (select y.name from public.academic_years as y where y.is_current limit 1),
    'semester', (select t.name from public.academic_terms as t where t.is_current limit 1),
    'class_name', (select c.name from public.academic_enrolments as e
                   join public.academic_years as y on y.id = e.academic_year_id and y.is_current
                   join public.academic_classes as c on c.id = e.class_id
                   where e.student_id = (select auth.uid()) limit 1)
  )
$$;

-- Fee statement: academic year, semester and class come from the academic setup.
create or replace function public.fee_statement_json(target_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'student_id', p.id,
    'student_name', p.full_name,
    'index_number', sd.index_number,
    'programme', sd.programme,
    'year', sd.form_class,
    'class', (select c.name from public.academic_enrolments as e
       join public.academic_years as y on y.id = e.academic_year_id and y.is_current
       join public.academic_classes as c on c.id = e.class_id
       where e.student_id = p.id limit 1),
    'house_name', h.name,
    'academic_year', coalesce((select y.name from public.academic_years as y where y.is_current limit 1), fs.academic_year, ''),
    'semester', coalesce((select t.name from public.academic_terms as t where t.is_current limit 1), ''),
    'item_description', coalesce(fs.item_description, 'School Fees'),
    'base_fees', coalesce(fs.total_fees, 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('description', i.description, 'amount', i.amount) order by i.created_at, i.id)
      from public.student_fee_items as i where i.student_id = p.id
    ), '[]'::jsonb),
    'total_fees', coalesce(fs.total_fees, 0) + coalesce((select sum(i.amount) from public.student_fee_items as i where i.student_id = p.id), 0),
    'previous_balance', coalesce(fs.previous_balance, 0),
    'amount_paid', coalesce(fs.amount_paid, 0),
    'amount_payable', coalesce(fs.total_fees, 0) + coalesce((select sum(i.amount) from public.student_fee_items as i where i.student_id = p.id), 0)
      + coalesce(fs.previous_balance, 0) - coalesce(fs.amount_paid, 0),
    'updated_at', fs.updated_at,
    'recorded', fs.student_id is not null
  )
  from public.profiles as p
  left join public.student_details as sd on sd.profile_id = p.id
  left join public.school_houses as h on h.id = sd.house_id
  left join public.student_fee_statements as fs on fs.student_id = p.id
  where p.id = target_student_id and p.role::text = 'student'
$$;
revoke all on function public.fee_statement_json(uuid) from public, anon, authenticated;

revoke all on function public.admin_import_scores(uuid, uuid, uuid, numeric, jsonb, boolean) from public, anon;
revoke all on function public.student_my_results_report() from public, anon;
revoke all on function public.student_academic_context() from public, anon;
grant execute on function public.admin_import_scores(uuid, uuid, uuid, numeric, jsonb, boolean) to authenticated;
grant execute on function public.student_my_results_report() to authenticated;
grant execute on function public.student_academic_context() to authenticated;
