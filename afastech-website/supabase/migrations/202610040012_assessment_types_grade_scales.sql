-- Phase 2: Assessment Types & Grade Scales
-- Adds configurable assessment types (CA, Exam, Project, Practical) with weightings
-- and grade scales (A-F boundaries with grade points) for GPA calculation

-- ============================================================================
-- ASSESSMENT TYPES
-- ============================================================================
create table public.assessment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  name_key text generated always as (lower(trim(name))) stored unique,
  short_code text not null check (length(trim(short_code)) between 1 and 10),
  short_code_key text generated always as (lower(trim(short_code))) stored unique,
  description text,
  default_weighting numeric(5, 2) not null default 100
    check (default_weighting > 0 and default_weighting <= 100),
  display_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed default assessment types (Ghana Education Service standard)
insert into public.assessment_types (name, short_code, description, default_weighting, display_order) values
  ('Continuous Assessment', 'CA', 'Class exercises, homework, quizzes, projects during the term', 30.00, 1),
  ('End-of-Term Examination', 'EXAM', 'Formal written examination at end of term', 70.00, 2),
  ('Project Work', 'PROJECT', 'Extended practical or research project', 100.00, 3),
  ('Practical Assessment', 'PRACTICAL', 'Laboratory, workshop, or field practical assessment', 100.00, 4)
on conflict (name_key) do nothing;

create index assessment_types_active_order_idx
  on public.assessment_types (display_order) where is_active;

alter table public.assessment_types enable row level security;

revoke all on public.assessment_types from anon, authenticated;

create function public.admin_list_assessment_types()
returns table (
  id uuid,
  name text,
  short_code text,
  description text,
  default_weighting numeric,
  display_order smallint,
  is_active boolean
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
    select at.id, at.name, at.short_code, at.description,
      at.default_weighting, at.display_order, at.is_active
    from public.assessment_types as at
    order by at.display_order, at.name;
end;
$$;

create function public.admin_save_assessment_type(
  target_name text,
  target_short_code text,
  target_description text default null,
  target_default_weighting numeric default 100,
  target_display_order smallint default 0,
  target_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_name text := trim(target_name);
  normalized_code text := upper(trim(target_short_code));
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if normalized_name is null or length(normalized_name) not between 1 and 60
    or normalized_code is null or length(normalized_code) not between 1 and 10
    or target_default_weighting is null or target_default_weighting <= 0 or target_default_weighting > 100
  then
    raise exception using errcode = '22023', message = 'Provide a valid name, short code, and weighting (0-100).';
  end if;
  insert into public.assessment_types (name, short_code, description, default_weighting, display_order, is_active)
  values (normalized_name, normalized_code, target_description, target_default_weighting, target_display_order, target_is_active)
  on conflict (name_key) do update
    set short_code = excluded.short_code,
        description = excluded.description,
        default_weighting = excluded.default_weighting,
        display_order = excluded.display_order,
        is_active = excluded.is_active,
        updated_at = now()
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.list_active_assessment_types()
returns table (
  id uuid,
  name text,
  short_code text,
  description text,
  default_weighting numeric,
  display_order smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select at.id, at.name, at.short_code, at.description,
      at.default_weighting, at.display_order
    from public.assessment_types as at
    where at.is_active
    order by at.display_order, at.name;
end;
$$;

revoke all on function public.admin_list_assessment_types() from public, anon;
revoke all on function public.admin_save_assessment_type(text, text, text, numeric, smallint, boolean) from public, anon;
revoke all on function public.list_active_assessment_types() from public, anon;

grant execute on function public.admin_list_assessment_types() to authenticated;
grant execute on function public.admin_save_assessment_type(text, text, text, numeric, smallint, boolean) to authenticated;
grant execute on function public.list_active_assessment_types() to authenticated;

-- ============================================================================
-- GRADE SCALES
-- ============================================================================
create table public.grade_scales (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  name_key text generated always as (lower(trim(name))) stored unique,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grade_scale_boundaries (
  id uuid primary key default gen_random_uuid(),
  grade_scale_id uuid not null references public.grade_scales (id) on delete cascade,
  grade_letter text not null check (length(trim(grade_letter)) between 1 and 3),
  grade_point numeric(3, 2) not null check (grade_point >= 0 and grade_point <= 10),
  min_score numeric(6, 2) not null check (min_score >= 0),
  max_score numeric(6, 2) not null check (max_score >= min_score),
  description text,
  display_order smallint not null default 0,
  unique (grade_scale_id, grade_letter),
  unique (grade_scale_id, display_order)
);

-- Seed default WASSCE-style grade scale
with default_scale as (
  insert into public.grade_scales (name, description, is_default, is_active)
  values ('WASSCE Standard', 'Standard West African Senior School Certificate Examination grading', true, true)
  on conflict (name_key) do update set description = excluded.description
  returning id
)
insert into public.grade_scale_boundaries (grade_scale_id, grade_letter, grade_point, min_score, max_score, description, display_order)
select ds.id, gb.grade_letter, gb.grade_point, gb.min_score, gb.max_score, gb.description, gb.display_order
from default_scale as ds
cross join (values
  ('A1', 4.00, 80, 100, 'Excellent', 1),
  ('B2', 3.50, 70, 79, 'Very Good', 2),
  ('B3', 3.00, 65, 69, 'Good', 3),
  ('C4', 2.50, 60, 64, 'Credit', 4),
  ('C5', 2.00, 55, 59, 'Credit', 5),
  ('C6', 1.50, 50, 54, 'Credit', 6),
  ('D7', 1.00, 45, 49, 'Pass', 7),
  ('E8', 0.50, 40, 44, 'Pass', 8),
  ('F9', 0.00, 0, 39, 'Fail', 9)
) as gb(grade_letter, grade_point, min_score, max_score, description, display_order)
on conflict (grade_scale_id, grade_letter) do nothing;

create index grade_scales_default_active_idx
  on public.grade_scales (is_default) where is_default and is_active;

create index grade_scale_boundaries_scale_order_idx
  on public.grade_scale_boundaries (grade_scale_id, display_order);

alter table public.grade_scales enable row level security;
alter table public.grade_scale_boundaries enable row level security;

revoke all on public.grade_scales, public.grade_scale_boundaries from anon, authenticated;

create function public.admin_list_grade_scales()
returns table (
  id uuid,
  name text,
  description text,
  is_default boolean,
  is_active boolean,
  boundaries jsonb
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
    select gs.id, gs.name, gs.description, gs.is_default, gs.is_active,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', gsb.id, 'grade_letter', gsb.grade_letter,
          'grade_point', gsb.grade_point, 'min_score', gsb.min_score,
          'max_score', gsb.max_score, 'description', gsb.description,
          'display_order', gsb.display_order
        ) order by gsb.display_order)
        from public.grade_scale_boundaries as gsb
        where gsb.grade_scale_id = gs.id
      ), '[]'::jsonb) as boundaries
    from public.grade_scales as gs
    order by gs.is_default desc, gs.name;
end;
$$;

create function public.admin_save_grade_scale(
  target_name text,
  target_description text default null,
  target_is_default boolean default false,
  target_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_name text := trim(target_name);
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if normalized_name is null or length(normalized_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Grade scale name must be 1-80 characters.';
  end if;

  if target_is_default then
    update public.grade_scales set is_default = false where is_default;
  end if;

  insert into public.grade_scales (name, description, is_default, is_active)
  values (normalized_name, target_description, target_is_default, target_is_active)
  on conflict (name_key) do update
    set description = excluded.description,
        is_default = excluded.is_default,
        is_active = excluded.is_active,
        updated_at = now()
  returning id into saved_id;

  return saved_id;
end;
$$;

create function public.admin_save_grade_boundary(
  target_grade_scale_id uuid,
  target_grade_letter text,
  target_grade_point numeric,
  target_min_score numeric,
  target_max_score numeric,
  target_description text default null,
  target_display_order smallint default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_letter text := upper(trim(target_grade_letter));
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if not exists (select 1 from public.grade_scales where id = target_grade_scale_id) then
    raise exception using errcode = '22023', message = 'Grade scale not found.';
  end if;
  if normalized_letter is null or length(normalized_letter) not between 1 and 3
    or target_grade_point is null or target_grade_point < 0 or target_grade_point > 10
    or target_min_score is null or target_min_score < 0
    or target_max_score is null or target_max_score < target_min_score
  then
    raise exception using errcode = '22023', message = 'Provide valid grade boundary values.';
  end if;

  insert into public.grade_scale_boundaries (
    grade_scale_id, grade_letter, grade_point, min_score, max_score, description, display_order
  )
  values (
    target_grade_scale_id, normalized_letter, target_grade_point,
    target_min_score, target_max_score, target_description, target_display_order
  )
  on conflict (grade_scale_id, grade_letter) do update
    set grade_point = excluded.grade_point,
        min_score = excluded.min_score,
        max_score = excluded.max_score,
        description = excluded.description,
        display_order = excluded.display_order
  returning id into saved_id;

  return saved_id;
end;
$$;

create function public.admin_delete_grade_boundary(target_boundary_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  delete from public.grade_scale_boundaries where id = target_boundary_id;
end;
$$;

create function public.get_default_grade_scale()
returns table (
  id uuid,
  name text,
  boundaries jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select gs.id, gs.name,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'grade_letter', gsb.grade_letter,
          'grade_point', gsb.grade_point,
          'min_score', gsb.min_score,
          'max_score', gsb.max_score,
          'description', gsb.description
        ) order by gsb.display_order)
        from public.grade_scale_boundaries as gsb
        where gsb.grade_scale_id = gs.id
      ), '[]'::jsonb)
    from public.grade_scales as gs
    where gs.is_default and gs.is_active
    limit 1;
end;
$$;

create function public.calculate_grade_from_score(target_score numeric, target_grade_scale_id uuid default null)
returns table (grade_letter text, grade_point numeric, description text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scale_id uuid;
begin
  if target_grade_scale_id is not null then
    scale_id := target_grade_scale_id;
  else
    select id into scale_id from public.grade_scales where is_default and is_active limit 1;
    if scale_id is null then
      return query select 'N/A'::text, 0::numeric, 'No default grade scale'::text;
      return;
    end if;
  end if;

  return query
    select gsb.grade_letter, gsb.grade_point, gsb.description
    from public.grade_scale_boundaries as gsb
    where gsb.grade_scale_id = scale_id
      and target_score >= gsb.min_score
      and target_score <= gsb.max_score
    order by gsb.display_order
    limit 1;

  if not found then
    return query select 'N/A'::text, 0::numeric, 'Score out of range'::text;
  end if;
end;
$$;

revoke all on function public.admin_list_grade_scales() from public, anon;
revoke all on function public.admin_save_grade_scale(text, text, boolean, boolean) from public, anon;
revoke all on function public.admin_save_grade_boundary(uuid, text, numeric, numeric, numeric, text, smallint) from public, anon;
revoke all on function public.admin_delete_grade_boundary(uuid) from public, anon;
revoke all on function public.get_default_grade_scale() from public, anon;
revoke all on function public.calculate_grade_from_score(numeric, uuid) from public, anon;

grant execute on function public.admin_list_grade_scales() to authenticated;
grant execute on function public.admin_save_grade_scale(text, text, boolean, boolean) to authenticated;
grant execute on function public.admin_save_grade_boundary(uuid, text, numeric, numeric, numeric, text, smallint) to authenticated;
grant execute on function public.admin_delete_grade_boundary(uuid) to authenticated;
grant execute on function public.get_default_grade_scale() to authenticated;
grant execute on function public.calculate_grade_from_score(numeric, uuid) to authenticated;

-- ============================================================================
-- LINK ASSESSMENT TYPES TO ACADEMIC ASSESSMENTS
-- ============================================================================
alter table public.academic_assessments
  add column if not exists assessment_type_id uuid references public.assessment_types (id) on delete set null,
  add column if not exists weighting numeric(5, 2) check (weighting > 0 and weighting <= 100);

-- Backfill: default existing assessments to 'Exam' type
update public.academic_assessments
set assessment_type_id = (select id from public.assessment_types where short_code_key = 'exam'),
    weighting = 100
where assessment_type_id is null;

create index academic_assessments_type_idx
  on public.academic_assessments (assessment_type_id);

-- ============================================================================
-- LINK GRADE SCALE TO ACADEMIC YEARS (for GPA calculation per year)
-- ============================================================================
alter table public.academic_years
  add column if not exists grade_scale_id uuid references public.grade_scales (id) on delete set null;

-- Set default grade scale for existing years
update public.academic_years
set grade_scale_id = (select id from public.grade_scales where is_default and is_active limit 1)
where grade_scale_id is null;

-- ============================================================================
-- STUDENT GPA / TERM RESULT VIEW (for report cards & transcripts)
-- ============================================================================
create or replace view public.student_term_results as
select
  r.student_id,
  ay.id as academic_year_id,
  ay.name as academic_year_name,
  at.id as term_id,
  at.name as term_name,
  at.sequence_no as term_sequence,
  cs.id as class_subject_id,
  c.name as class_name,
  p.name as programme_name,
  s.name as subject_name,
  s.code as subject_code,
  a.title as assessment_title,
  a.max_score,
  a.assessment_type_id,
  aty.name as assessment_type_name,
  aty.short_code as assessment_type_code,
  a.weighting,
  r.score,
  round((r.score / a.max_score) * 100, 2) as percentage_score,
  gsb.grade_letter,
  gsb.grade_point,
  ay.grade_scale_id
from public.academic_results as r
join public.academic_assessments as a on a.id = r.assessment_id and a.status = 'published'
join public.academic_class_subjects as cs on cs.id = a.class_subject_id
join public.academic_classes as c on c.id = cs.class_id
join public.academic_programmes as p on p.id = c.programme_id
join public.academic_subjects as s on s.id = cs.subject_id
join public.academic_terms as at on at.id = a.term_id
join public.academic_years as ay on ay.id = at.academic_year_id
left join public.assessment_types as aty on aty.id = a.assessment_type_id
left join public.grade_scales as gs on gs.id = ay.grade_scale_id
left join public.grade_scale_boundaries as gsb
  on gsb.grade_scale_id = coalesce(gs.id, (select id from public.grade_scales where is_default and is_active limit 1))
  and round((r.score / a.max_score) * 100, 2) >= gsb.min_score
  and round((r.score / a.max_score) * 100, 2) <= gsb.max_score;

-- ============================================================================
-- STUDENT TERM GPA CALCULATION
-- ============================================================================
create or replace function public.calculate_student_term_gpa(
  target_student_id uuid,
  target_term_id uuid
)
returns table (
  gpa numeric(4, 2),
  total_subjects int,
  weighted_average numeric(6, 2)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term_year_id uuid;
  grade_scale_id uuid;
begin
  select at.academic_year_id into term_year_id
  from public.academic_terms as at
  where at.id = target_term_id;

  select ay.grade_scale_id into grade_scale_id
  from public.academic_years as ay
  where ay.id = term_year_id;

  return query
  with subject_scores as (
    select
      str.subject_name,
      str.assessment_type_code,
      str.weighting,
      str.percentage_score,
      str.grade_point
    from public.student_term_results as str
    where str.student_id = target_student_id
      and str.term_id = target_term_id
  ),
  subject_aggregates as (
    select
      subject_name,
      sum(percentage_score * weighting / 100.0) as weighted_subject_score,
      max(grade_point) as subject_grade_point
    from subject_scores
    group by subject_name
  )
  select
    round(avg(subject_grade_point)::numeric, 2) as gpa,
    count(*) as total_subjects,
    round(avg(weighted_subject_score)::numeric, 2) as weighted_average
  from subject_aggregates;
end;
$$;

grant select on public.student_term_results to authenticated;
grant execute on function public.calculate_student_term_gpa(uuid, uuid) to authenticated;

-- ============================================================================
-- UPDATE EXISTING STAFF_SAVE_ACADEMIC_ASSESSMENT TO SUPPORT ASSESSMENT TYPES
-- ============================================================================
create or replace function public.staff_save_academic_assessment(
  target_class_subject_id uuid,
  target_term_id uuid,
  target_title text,
  target_max_score numeric default 100,
  target_assessment_type_id uuid default null,
  target_weighting numeric default 100
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_title text := trim(target_title);
  class_year uuid;
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  select cs.academic_year_id into class_year
  from public.academic_class_subjects as cs
  where cs.id = target_class_subject_id
    and cs.teacher_id = (select auth.uid());
  if not found then
    raise exception using errcode = '42501', message = 'This class and subject are not assigned to you.';
  end if;
  if not exists (
    select 1 from public.academic_terms as t
    where t.id = target_term_id and t.academic_year_id = class_year
  ) then
    raise exception using errcode = '22023', message = 'Select a term from the assigned academic year.';
  end if;
  if target_assessment_type_id is not null and not exists (
    select 1 from public.assessment_types where id = target_assessment_type_id and is_active
  ) then
    raise exception using errcode = '22023', message = 'Selected assessment type is not active.';
  end if;
  if normalized_title is null or length(normalized_title) not between 1 and 120
    or target_max_score is null or target_max_score <= 0 or target_max_score > 100
    or target_weighting is null or target_weighting <= 0 or target_weighting > 100
  then
    raise exception using errcode = '22023', message = 'Assessment title, maximum mark, and weighting must be valid.';
  end if;

  insert into public.academic_assessments (
    class_subject_id, term_id, title, max_score, assessment_type_id, weighting, created_by
  )
  values (
    target_class_subject_id, target_term_id, normalized_title, target_max_score,
    target_assessment_type_id, target_weighting, (select auth.uid())
  )
  returning id into saved_id;
  return saved_id;
end;
$$;

revoke all on function public.staff_save_academic_assessment(uuid, uuid, text, numeric, uuid, numeric) from public, anon;
grant execute on function public.staff_save_academic_assessment(uuid, uuid, text, numeric, uuid, numeric) to authenticated;