-- Phase 2.5: Batch Class-Results PDF Import
-- Adds functionality to import results from a PDF class result sheet

-- Temporary table for staging extracted batch results
create table public.batch_result_staging (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references public.academic_assessments (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,
  score numeric(6, 2) not null check (score >= 0),
  source_page integer not null,
  extracted_at timestamptz not null default now(),
  raw_text text
);

create index batch_result_staging_assessment_idx on public.batch_result_staging (assessment_id, student_id);
create index batch_result_staging_student_idx on public.batch_result_staging (student_id);

-- Staging table for unmatched students during batch import
create table public.batch_unmatched_students (
  id uuid primary key default gen_random_uuid(),
  class_subject_id uuid references public.academic_class_subjects (id) on delete cascade,
  index_number text not null,
  student_name text not null,
  rows jsonb,
  created_at timestamptz not null default now()
);

alter table public.batch_result_staging enable row level security;
alter table public.batch_unmatched_students enable row level security;

revoke all on public.batch_result_staging, public.batch_unmatched_students from anon, authenticated;

-- Administrator function to clear staging tables
create function public.admin_clear_result_staging()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  delete from public.batch_result_staging;
  delete from public.batch_unmatched_students;
end;
$$;

-- Function to get unassigned students in a class-subject for batch matching
create function public.admin_get_unmatched_batch_students(target_class_subject_id uuid)
returns table (
  student_id uuid,
  full_name text,
  index_number text
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
    select p.id, p.full_name, sd.index_number
    from public.academic_enrolments as e
    join public.profiles as p on p.id = e.student_id
    left join public.student_details as sd on sd.profile_id = p.id
    where e.class_id = (select class_id from public.academic_class_subjects where id = target_class_subject_id)
      and e.academic_year_id = (select academic_year_id from public.academic_class_subjects where id = target_class_subject_id);
end;
$$;

-- Function to stage batch results
create function public.admin_stage_batch_results(
  target_assessment_id uuid,
  target_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  result_record jsonb;
  student_uuid uuid;
  score_value numeric(6,2);
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  if target_results is null or jsonb_typeof(target_results) <> 'array' then
    raise exception using errcode = '22023', message = 'Results must be provided as a JSON array.';
  end if;

  for result_record in select jsonb_array_elements(target_results)
  loop
    student_uuid := (result_record->>'student_id')::uuid;
    score_value := (result_record->>'score')::numeric(6,2);

    insert into public.batch_result_staging (
      assessment_id, student_id, score, source_page, raw_text
    ) values (
      target_assessment_id, student_uuid, score_value,
      coalesce((result_record->>'source_page')::integer, 1),
      result_record->>'raw_text'
    );

    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;

-- Function to apply staged batch results
create function public.admin_apply_batch_results()
returns table (applied integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied_count integer := 0;
  skipped_count integer := 0;
  staging_record record;
  existing_score numeric;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  for staging_record in
    select s.student_id, s.assessment_id, s.score
    from public.batch_result_staging as s
  loop
    -- Check assessment is still in draft or published state
    if not exists (
      select 1 from public.academic_assessments a
      where a.id = staging_record.assessment_id
        and a.status in ('draft', 'submitted', 'published')
    ) then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    -- Check student is enrolled in the assessment's class and year
    if not exists (
      select 1
      from public.academic_assessments as a
      join public.academic_class_subjects as cs on cs.id = a.class_subject_id
      join public.academic_enrolments as e
        on e.class_id = cs.class_id and e.academic_year_id = cs.academic_year_id
      where a.id = staging_record.assessment_id
        and e.student_id = staging_record.student_id
    ) then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    -- Insert or update the result
    insert into public.academic_results (assessment_id, student_id, score, entered_by)
    values (staging_record.assessment_id, staging_record.student_id, staging_record.score, (select auth.uid()))
    on conflict (assessment_id, student_id) do update
      set score = excluded.score, updated_at = now();

    applied_count := applied_count + 1;
  end loop;

  -- Clear staging table after applying
  delete from public.batch_result_staging;

  return query select applied_count, skipped_count;
end;
$$;

-- Function to reject staged results (for review before applying)
create function public.admin_reject_batch_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  delete from public.batch_result_staging;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Administrator function to save academic results for batch import
create function public.admin_save_batch_academic_result(
  target_assessment_id uuid,
  target_student_id uuid,
  target_score numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  class_year uuid;
  max_mark numeric;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  select cs.academic_year_id, a.max_score
  into class_year, max_mark
  from public.academic_assessments as a
  join public.academic_class_subjects as cs on cs.id = a.class_subject_id
  where a.id = target_assessment_id;

  if not found then
    raise exception using errcode = '22023', message = 'Assessment not found.';
  end if;

  if target_score is null or target_score < 0 or target_score > max_mark then
    raise exception using errcode = '22023', message = 'Score must be between 0 and the assessment maximum.';
  end if;

  insert into public.academic_results (assessment_id, student_id, score, entered_by)
  values (target_assessment_id, target_student_id, target_score, (select auth.uid()))
  on conflict (assessment_id, student_id) do update
    set score = excluded.score, updated_at = now();
end;
$$;

revoke all on function public.admin_reject_batch_results() from public, anon;
revoke all on function public.admin_save_batch_academic_result(uuid, uuid, numeric) from public, anon;

grant execute on function public.admin_clear_result_staging() to authenticated;
grant execute on function public.admin_get_unmatched_batch_students(uuid) to authenticated;
grant execute on function public.admin_stage_batch_results(uuid, jsonb) to authenticated;
grant execute on function public.admin_apply_batch_results() to authenticated;
grant execute on function public.admin_reject_batch_results() to authenticated;
grant execute on function public.admin_save_batch_academic_result(uuid, uuid, numeric) to authenticated;

-- Grant read access to staging tables for admin review
grant select on public.batch_result_staging to authenticated;
grant select on public.batch_unmatched_students to authenticated;