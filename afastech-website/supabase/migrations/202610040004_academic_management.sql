create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 32),
  name_key text generated always as (lower(trim(name))) stored unique,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create unique index academic_years_one_current_idx
  on public.academic_years (is_current) where is_current;

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  sequence_no smallint not null check (sequence_no between 1 and 3),
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (academic_year_id, sequence_no),
  check (ends_on >= starts_on)
);

create unique index academic_terms_one_current_idx
  on public.academic_terms (is_current) where is_current;

create table public.academic_programmes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  name_key text generated always as (lower(trim(name))) stored unique,
  created_at timestamptz not null default now()
);

create table public.academic_classes (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.academic_programmes (id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  name_key text generated always as (lower(trim(name))) stored,
  created_at timestamptz not null default now(),
  unique (programme_id, name_key)
);

create table public.academic_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  name_key text generated always as (lower(trim(name))) stored unique,
  created_at timestamptz not null default now()
);

create table public.academic_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  name_key text generated always as (lower(trim(name))) stored unique,
  code text,
  code_key text generated always as (nullif(lower(trim(code)), '')) stored unique,
  department_id uuid references public.academic_departments (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.academic_class_subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.academic_classes (id) on delete cascade,
  subject_id uuid not null references public.academic_subjects (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  teacher_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, subject_id, academic_year_id)
);

create table public.academic_enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id uuid not null references public.academic_classes (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);

create table public.academic_assessments (
  id uuid primary key default gen_random_uuid(),
  class_subject_id uuid not null references public.academic_class_subjects (id) on delete cascade,
  term_id uuid not null references public.academic_terms (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  max_score numeric(6, 2) not null default 100 check (max_score > 0 and max_score <= 100),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'published')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  published_at timestamptz,
  unique (class_subject_id, term_id, title)
);

create table public.academic_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.academic_assessments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  score numeric(6, 2) not null check (score >= 0),
  entered_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

insert into public.academic_programmes (name)
select distinct trim(sd.programme)
from public.student_details as sd
where nullif(trim(sd.programme), '') is not null
on conflict (name_key) do nothing;

insert into public.academic_programmes (name)
values ('General')
on conflict (name_key) do nothing;

insert into public.academic_classes (programme_id, name)
select distinct ap.id, trim(sd.form_class)
from public.student_details as sd
join public.academic_programmes as ap
  on ap.name_key = coalesce(nullif(lower(trim(sd.programme)), ''), 'general')
where nullif(trim(sd.form_class), '') is not null
on conflict (programme_id, name_key) do nothing;

create index academic_terms_year_sequence_idx
  on public.academic_terms (academic_year_id, sequence_no);
create index academic_class_subjects_teacher_year_idx
  on public.academic_class_subjects (teacher_id, academic_year_id);
create index academic_enrolments_class_year_idx
  on public.academic_enrolments (class_id, academic_year_id);
create index academic_assessments_class_term_status_idx
  on public.academic_assessments (class_subject_id, term_id, status);
create index academic_results_student_assessment_idx
  on public.academic_results (student_id, assessment_id);

alter table public.academic_years enable row level security;
alter table public.academic_terms enable row level security;
alter table public.academic_programmes enable row level security;
alter table public.academic_classes enable row level security;
alter table public.academic_departments enable row level security;
alter table public.academic_subjects enable row level security;
alter table public.academic_class_subjects enable row level security;
alter table public.academic_enrolments enable row level security;
alter table public.academic_assessments enable row level security;
alter table public.academic_results enable row level security;

revoke all on public.academic_years, public.academic_terms,
  public.academic_programmes, public.academic_classes, public.academic_subjects,
  public.academic_departments,
  public.academic_class_subjects, public.academic_enrolments,
  public.academic_assessments, public.academic_results
from anon, authenticated;

create function public.admin_list_academic_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  return jsonb_build_object(
    'years', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', y.id, 'name', y.name, 'starts_on', y.starts_on,
        'ends_on', y.ends_on, 'is_current', y.is_current
      ) order by y.starts_on desc)
      from public.academic_years as y
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'academic_year_id', t.academic_year_id, 'name', t.name,
        'sequence_no', t.sequence_no, 'is_current', t.is_current,
        'starts_on', t.starts_on, 'ends_on', t.ends_on
      ) order by y.starts_on desc, t.sequence_no)
      from public.academic_terms as t
      join public.academic_years as y on y.id = t.academic_year_id
    ), '[]'::jsonb),
    'programmes', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name)
      from public.academic_programmes as p
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'programme_id', c.programme_id,
        'programme', p.name
      ) order by p.name, c.name)
      from public.academic_classes as c
      join public.academic_programmes as p on p.id = c.programme_id
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'code', s.code,
        'department_id', s.department_id, 'department', d.name
      ) order by s.name)
      from public.academic_subjects as s
      left join public.academic_departments as d on d.id = s.department_id
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
      from public.academic_departments as d
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name
      ) order by p.full_name)
      from public.profiles as p
      where p.role::text = 'staff'
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'index_number', sd.index_number
      ) order by p.full_name)
      from public.profiles as p
      left join public.student_details as sd on sd.profile_id = p.id
      where p.role::text = 'student'
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id, 'class_id', cs.class_id, 'class_name', c.name,
        'subject_id', cs.subject_id, 'subject_name', s.name,
        'academic_year_id', cs.academic_year_id, 'year_name', y.name,
        'teacher_id', cs.teacher_id, 'teacher_name', p.full_name
      ) order by y.starts_on desc, c.name, s.name)
      from public.academic_class_subjects as cs
      join public.academic_classes as c on c.id = cs.class_id
      join public.academic_subjects as s on s.id = cs.subject_id
      join public.academic_years as y on y.id = cs.academic_year_id
      left join public.profiles as p on p.id = cs.teacher_id
    ), '[]'::jsonb),
    'enrolments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'student_id', e.student_id, 'student_name', p.full_name,
        'index_number', sd.index_number, 'class_id', e.class_id,
        'class_name', c.name, 'programme', pr.name,
        'academic_year_id', e.academic_year_id, 'year_name', y.name
      ) order by y.starts_on desc, p.full_name)
      from public.academic_enrolments as e
      join public.profiles as p on p.id = e.student_id
      left join public.student_details as sd on sd.profile_id = p.id
      join public.academic_classes as c on c.id = e.class_id
      join public.academic_programmes as pr on pr.id = c.programme_id
      join public.academic_years as y on y.id = e.academic_year_id
    ), '[]'::jsonb),
    'assessments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'title', a.title, 'max_score', a.max_score,
            'status', a.status, 'class_name', c.name, 'subject_name', s.name,
            'term_name', t.name, 'year_name', y.name
          ) order by a.created_at desc)
          from public.academic_assessments as a
          join public.academic_class_subjects as cs on cs.id = a.class_subject_id
          join public.academic_classes as c on c.id = cs.class_id
          join public.academic_subjects as s on s.id = cs.subject_id
          join public.academic_terms as t on t.id = a.term_id
          join public.academic_years as y on y.id = t.academic_year_id
        ), '[]'::jsonb),
        'assessment_types', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', at.id, 'name', at.name, 'short_code', at.short_code,
            'description', at.description, 'default_weighting', at.default_weighting,
            'display_order', at.display_order, 'is_active', at.is_active
          ) order by at.display_order, at.name)
          from public.assessment_types as at
          where at.is_active
        ), '[]'::jsonb),
        'grade_scales', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', gs.id, 'name', gs.name, 'description', gs.description,
            'is_default', gs.is_default, 'is_active', gs.is_active
          ) order by gs.is_default desc, gs.name)
          from public.grade_scales as gs
          where gs.is_active
        ), '[]'::jsonb)
      );
    end;
    $$;

create function public.admin_save_academic_year(
  target_name text,
  target_starts_on date,
  target_ends_on date,
  target_is_current boolean
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
  if normalized_name is null or length(normalized_name) not between 1 and 32
    or target_starts_on is null or target_ends_on is null
    or target_is_current is null
    or target_ends_on < target_starts_on
  then
    raise exception using errcode = '22023', message = 'Provide a valid year name and date range.';
  end if;
  if exists (
    select 1
    from public.academic_terms as t
    join public.academic_years as y on y.id = t.academic_year_id
    where y.name_key = lower(normalized_name)
      and (t.starts_on < target_starts_on or t.ends_on > target_ends_on)
  ) then
    raise exception using errcode = '22023', message = 'Academic year dates must contain all of its term dates.';
  end if;

  if target_is_current then
    if not exists (
      select 1 from public.academic_years as y
      where y.name_key = lower(normalized_name) and y.is_current
    ) then
      update public.academic_terms set is_current = false where is_current;
      update public.student_details set current_term = '', updated_at = now()
        where current_term <> '';
    end if;
    update public.academic_years set is_current = false where is_current;
  elsif exists (
    select 1 from public.academic_years as y
    where y.name_key = lower(normalized_name) and y.is_current
  ) then
    update public.academic_terms set is_current = false where is_current;
    update public.student_details set current_term = '', updated_at = now()
      where current_term <> '';
  end if;
  insert into public.academic_years (name, starts_on, ends_on, is_current)
  values (normalized_name, target_starts_on, target_ends_on, target_is_current)
  on conflict (name_key) do update
    set starts_on = excluded.starts_on,
        ends_on = excluded.ends_on,
        is_current = excluded.is_current
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.admin_save_academic_term(
  target_year_id uuid,
  target_name text,
  target_sequence_no smallint,
  target_starts_on date,
  target_ends_on date,
  target_is_current boolean
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
  if not exists (select 1 from public.academic_years where id = target_year_id)
    or normalized_name is null or length(normalized_name) not between 1 and 40
    or target_sequence_no is null
    or target_sequence_no not between 1 and 3
    or target_starts_on is null or target_ends_on is null
    or target_is_current is null
    or target_ends_on < target_starts_on
  then
    raise exception using errcode = '22023', message = 'Provide a valid academic term.';
  end if;
  if not exists (
    select 1 from public.academic_years as y
    where y.id = target_year_id
      and target_starts_on >= y.starts_on
      and target_ends_on <= y.ends_on
  ) then
    raise exception using errcode = '22023', message = 'Term dates must fall within the academic year.';
  end if;

  if target_is_current then
    update public.academic_terms set is_current = false where is_current;
    update public.academic_years set is_current = (id = target_year_id);
  elsif exists (
    select 1 from public.academic_terms as t
    where t.academic_year_id = target_year_id
      and t.sequence_no = target_sequence_no
      and t.is_current
  ) then
    update public.student_details set current_term = '', updated_at = now()
      where current_term <> '';
  end if;
  insert into public.academic_terms (
    academic_year_id, name, sequence_no, starts_on, ends_on, is_current
  )
  values (
    target_year_id, normalized_name, target_sequence_no,
    target_starts_on, target_ends_on, target_is_current
  )
  on conflict (academic_year_id, sequence_no) do update
    set name = excluded.name,
        starts_on = excluded.starts_on,
        ends_on = excluded.ends_on,
        is_current = excluded.is_current
  returning id into saved_id;
  if target_is_current then
    update public.student_details
    set current_term = normalized_name, updated_at = now()
    where current_term is distinct from normalized_name;
  end if;
  return saved_id;
end;
$$;

create function public.admin_save_academic_programme(target_name text)
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
  if normalized_name is null or length(normalized_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Programme name must contain 1 to 120 characters.';
  end if;
  insert into public.academic_programmes (name) values (normalized_name)
  on conflict (name_key) do update set name = excluded.name
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.admin_save_academic_class(target_name text, target_programme_id uuid)
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
  if normalized_name is null or length(normalized_name) not between 1 and 80
    or not exists (select 1 from public.academic_programmes where id = target_programme_id)
  then
    raise exception using errcode = '22023', message = 'Provide a valid class and programme.';
  end if;
  insert into public.academic_classes (name, programme_id)
  values (normalized_name, target_programme_id)
  on conflict (programme_id, name_key) do update set name = excluded.name
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.admin_save_academic_subject(
  target_name text,
  target_code text,
  target_department_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_name text := trim(target_name);
  normalized_code text := nullif(trim(target_code), '');
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if normalized_name is null or length(normalized_name) not between 1 and 120
    or length(coalesce(normalized_code, '')) > 24
    or (target_department_id is not null and not exists (
      select 1 from public.academic_departments where id = target_department_id
    ))
  then
    raise exception using errcode = '22023', message = 'Provide a valid subject name and optional code.';
  end if;
  insert into public.academic_subjects (name, code, department_id)
  values (normalized_name, normalized_code, target_department_id)
  on conflict (name_key) do update
    set name = excluded.name,
        code = excluded.code,
        department_id = excluded.department_id
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.admin_save_academic_department(target_name text)
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
  if normalized_name is null or length(normalized_name) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Department name must contain 1 to 100 characters.';
  end if;
  insert into public.academic_departments (name) values (normalized_name)
  on conflict (name_key) do update set name = excluded.name
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.admin_assign_student_class(
  target_student_id uuid,
  target_class_id uuid,
  target_year_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_programme text;
  class_name text;
  year_is_current boolean;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if not exists (
    select 1 from public.profiles where id = target_student_id and role::text = 'student'
  ) then
    raise exception using errcode = '22023', message = 'Select an active student account.';
  end if;

  select c.name, p.name into class_name, student_programme
  from public.academic_classes as c
  join public.academic_programmes as p on p.id = c.programme_id
  where c.id = target_class_id;
  if not found or not exists (
    select 1 from public.academic_years where id = target_year_id
  ) then
    raise exception using errcode = '22023', message = 'Select a valid class and academic year.';
  end if;
  select y.is_current into year_is_current
  from public.academic_years as y
  where y.id = target_year_id;

  insert into public.academic_enrolments (student_id, class_id, academic_year_id)
  values (target_student_id, target_class_id, target_year_id)
  on conflict (student_id, academic_year_id) do update set class_id = excluded.class_id;

  if year_is_current then
    insert into public.student_details (profile_id, form_class, programme)
    values (target_student_id, class_name, student_programme)
    on conflict (profile_id) do update
      set form_class = excluded.form_class,
          programme = excluded.programme,
          updated_at = now();
  end if;
end;
$$;

create function public.admin_assign_class_subject(
  target_class_id uuid,
  target_subject_id uuid,
  target_year_id uuid,
  target_teacher_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if target_teacher_id is not null and not exists (
    select 1 from public.profiles where id = target_teacher_id and role::text = 'staff'
  ) then
    raise exception using errcode = '22023', message = 'Select an active staff account as teacher.';
  end if;
  if not exists (select 1 from public.academic_classes where id = target_class_id)
    or not exists (select 1 from public.academic_subjects where id = target_subject_id)
    or not exists (select 1 from public.academic_years where id = target_year_id)
  then
    raise exception using errcode = '22023', message = 'Select a valid class, subject, and academic year.';
  end if;
  insert into public.academic_class_subjects (
    class_id, subject_id, academic_year_id, teacher_id
  )
  values (target_class_id, target_subject_id, target_year_id, target_teacher_id)
  on conflict (class_id, subject_id, academic_year_id) do update
    set teacher_id = excluded.teacher_id
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.staff_list_academic_assignments()
returns table (
  class_subject_id uuid,
  class_name text,
  programme_name text,
  subject_name text,
  academic_year_id uuid,
  academic_year_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  return query
    select cs.id, c.name, p.name, s.name, y.id, y.name
    from public.academic_class_subjects as cs
    join public.academic_classes as c on c.id = cs.class_id
    join public.academic_programmes as p on p.id = c.programme_id
    join public.academic_subjects as s on s.id = cs.subject_id
    join public.academic_years as y on y.id = cs.academic_year_id
    where cs.teacher_id = (select auth.uid())
    order by y.starts_on desc, c.name, s.name;
end;
$$;

create function public.staff_list_academic_terms(target_year_id uuid)
returns table (id uuid, name text, sequence_no smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  return query
    select t.id, t.name, t.sequence_no
    from public.academic_terms as t
    where t.academic_year_id = target_year_id
      and exists (
        select 1 from public.academic_class_subjects as cs
        where cs.academic_year_id = target_year_id
          and cs.teacher_id = (select auth.uid())
      )
    order by t.sequence_no;
end;
$$;

create function public.staff_list_academic_assessments()
returns table (
  id uuid,
  class_subject_id uuid,
  term_id uuid,
  title text,
  max_score numeric,
  status text,
  class_name text,
  subject_name text,
  term_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  return query
    select a.id, a.class_subject_id, a.term_id, a.title, a.max_score, a.status,
      c.name, s.name, t.name
    from public.academic_assessments as a
    join public.academic_class_subjects as cs on cs.id = a.class_subject_id
    join public.academic_classes as c on c.id = cs.class_id
    join public.academic_subjects as s on s.id = cs.subject_id
    join public.academic_terms as t on t.id = a.term_id
    where cs.teacher_id = (select auth.uid())
    order by a.created_at desc;
end;
$$;

create function public.staff_list_academic_students(
  target_class_subject_id uuid,
  target_assessment_id uuid default null
)
returns table (
  student_id uuid,
  full_name text,
  index_number text,
  score numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  class_year uuid;
  class_id_value uuid;
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  select cs.academic_year_id, cs.class_id
  into class_year, class_id_value
  from public.academic_class_subjects as cs
  where cs.id = target_class_subject_id
    and cs.teacher_id = (select auth.uid());
  if not found then
    raise exception using errcode = '42501', message = 'This class and subject are not assigned to you.';
  end if;
  if target_assessment_id is not null and not exists (
    select 1 from public.academic_assessments as a
    where a.id = target_assessment_id
      and a.class_subject_id = target_class_subject_id
  ) then
    raise exception using errcode = '22023', message = 'Assessment does not belong to this class and subject.';
  end if;

  return query
    select p.id, p.full_name, sd.index_number, ar.score
    from public.academic_enrolments as e
    join public.profiles as p on p.id = e.student_id
    left join public.student_details as sd on sd.profile_id = p.id
    left join public.academic_results as ar
      on ar.student_id = p.id and ar.assessment_id = target_assessment_id
    where e.class_id = class_id_value
      and e.academic_year_id = class_year
      and p.role::text = 'student'
    order by p.full_name;
end;
$$;

create function public.staff_save_academic_assessment(
  target_class_subject_id uuid,
  target_term_id uuid,
  target_title text,
  target_max_score numeric default 100
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
  if normalized_title is null or length(normalized_title) not between 1 and 120
    or target_max_score is null or target_max_score <= 0 or target_max_score > 100
  then
    raise exception using errcode = '22023', message = 'Assessment title and maximum mark must be valid (0–100).';
  end if;

  insert into public.academic_assessments (
    class_subject_id, term_id, title, max_score, created_by
  )
  values (
    target_class_subject_id, target_term_id, normalized_title, target_max_score,
    (select auth.uid())
  )
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.staff_save_academic_result(
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
  max_mark numeric;
  assessment_status text;
  class_id_value uuid;
  class_year uuid;
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  select a.max_score, a.status, cs.class_id, cs.academic_year_id
  into max_mark, assessment_status, class_id_value, class_year
  from public.academic_assessments as a
  join public.academic_class_subjects as cs on cs.id = a.class_subject_id
  where a.id = target_assessment_id
    and cs.teacher_id = (select auth.uid());
  if not found then
    raise exception using errcode = '42501', message = 'Assessment is not assigned to you.';
  end if;
  if assessment_status <> 'draft' then
    raise exception using errcode = '55000', message = 'Marks can only be changed while an assessment is a draft.';
  end if;
  if target_score is null or target_score < 0 or target_score > max_mark then
    raise exception using errcode = '22023', message = 'Mark must be between zero and the assessment maximum.';
  end if;
  if not exists (
    select 1 from public.academic_enrolments as e
    join public.profiles as p on p.id = e.student_id
    where e.student_id = target_student_id
      and e.class_id = class_id_value
      and e.academic_year_id = class_year
      and p.role::text = 'student'
  ) then
    raise exception using errcode = '42501', message = 'Student is not enrolled in this assigned class.';
  end if;
  insert into public.academic_results (assessment_id, student_id, score, entered_by)
  values (target_assessment_id, target_student_id, target_score, (select auth.uid()))
  on conflict (assessment_id, student_id) do update
    set score = excluded.score, entered_by = excluded.entered_by, updated_at = now();
end;
$$;

create function public.staff_submit_academic_assessment(target_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  class_id_value uuid;
  class_year uuid;
  assessment_status text;
  enrolled_count bigint;
begin
  if (select public.current_portal_role())::text is distinct from 'staff' then
    raise exception using errcode = '42501', message = 'Staff access required.';
  end if;
  select cs.class_id, cs.academic_year_id, a.status
  into class_id_value, class_year, assessment_status
  from public.academic_assessments as a
  join public.academic_class_subjects as cs on cs.id = a.class_subject_id
  where a.id = target_assessment_id and cs.teacher_id = (select auth.uid())
  for update of a;
  if not found then
    raise exception using errcode = '42501', message = 'Assessment is not assigned to you.';
  end if;
  if assessment_status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft assessments can be submitted.';
  end if;
  select count(*) into enrolled_count
  from public.academic_enrolments as e
  join public.profiles as p on p.id = e.student_id
  where e.class_id = class_id_value
    and e.academic_year_id = class_year
    and p.role::text = 'student';
  if enrolled_count = 0 then
    raise exception using errcode = '22023', message = 'The class has no enrolled students.';
  end if;
  if exists (
    select 1
    from public.academic_enrolments as e
    join public.profiles as p on p.id = e.student_id
    left join public.academic_results as r
      on r.assessment_id = target_assessment_id and r.student_id = e.student_id
    where e.class_id = class_id_value
      and e.academic_year_id = class_year
      and p.role::text = 'student'
      and r.id is null
  ) then
    raise exception using errcode = '22023', message = 'Enter a mark for every student in the class before submitting.';
  end if;
  update public.academic_assessments
  set status = 'submitted', submitted_at = now()
  where id = target_assessment_id;
end;
$$;

create function public.admin_publish_academic_assessment(target_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  update public.academic_assessments
  set status = 'published', published_at = now()
  where id = target_assessment_id and status = 'submitted';
  if not found then
    raise exception using errcode = 'P0002', message = 'Submitted assessment not found.';
  end if;
end;
$$;

create function public.student_list_my_academic_subjects()
returns table (subject_name text, teacher_name text, programme_name text, class_name text, academic_year_name text)
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
    select s.name, p.full_name, pr.name, c.name, y.name
    from public.academic_enrolments as e
    join public.academic_years as y on y.id = e.academic_year_id and y.is_current
    join public.academic_classes as c on c.id = e.class_id
    join public.academic_programmes as pr on pr.id = c.programme_id
    join public.academic_class_subjects as cs
      on cs.class_id = c.id and cs.academic_year_id = y.id
    join public.academic_subjects as s on s.id = cs.subject_id
    left join public.profiles as p on p.id = cs.teacher_id
    where e.student_id = (select auth.uid())
    order by s.name;
end;
$$;

create function public.student_list_my_academic_results()
returns table (
  subject text,
  assessment text,
  score numeric,
  max_score numeric,
  term text,
  academic_year text,
  created_at timestamptz
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
    select s.name, a.title, r.score, a.max_score, t.name, y.name, r.updated_at
    from public.academic_results as r
    join public.academic_assessments as a on a.id = r.assessment_id and a.status = 'published'
    join public.academic_class_subjects as cs on cs.id = a.class_subject_id
    join public.academic_subjects as s on s.id = cs.subject_id
    join public.academic_terms as t on t.id = a.term_id
    join public.academic_years as y on y.id = t.academic_year_id
    where r.student_id = (select auth.uid())
    union all
    select sr.subject, sr.assessment, sr.score, 100::numeric, sr.term, null::text, sr.created_at
    from public.student_results as sr
    where sr.student_id = (select auth.uid())
    order by 7 desc
    limit 50;
end;
$$;

revoke all on function public.admin_list_academic_data() from public, anon;
revoke all on function public.admin_save_academic_year(text, date, date, boolean) from public, anon;
revoke all on function public.admin_save_academic_term(uuid, text, smallint, date, date, boolean) from public, anon;
revoke all on function public.admin_save_academic_programme(text) from public, anon;
revoke all on function public.admin_save_academic_class(text, uuid) from public, anon;
revoke all on function public.admin_save_academic_subject(text, text, uuid) from public, anon;
revoke all on function public.admin_save_academic_department(text) from public, anon;
revoke all on function public.admin_assign_student_class(uuid, uuid, uuid) from public, anon;
revoke all on function public.admin_assign_class_subject(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.staff_list_academic_assignments() from public, anon;
revoke all on function public.staff_list_academic_terms(uuid) from public, anon;
revoke all on function public.staff_list_academic_assessments() from public, anon;
revoke all on function public.staff_list_academic_students(uuid, uuid) from public, anon;
revoke all on function public.staff_save_academic_assessment(uuid, uuid, text, numeric) from public, anon;
revoke all on function public.staff_save_academic_result(uuid, uuid, numeric) from public, anon;
revoke all on function public.staff_submit_academic_assessment(uuid) from public, anon;
revoke all on function public.admin_publish_academic_assessment(uuid) from public, anon;
revoke all on function public.student_list_my_academic_subjects() from public, anon;
revoke all on function public.student_list_my_academic_results() from public, anon;

grant execute on function public.admin_list_academic_data() to authenticated;
grant execute on function public.admin_save_academic_year(text, date, date, boolean) to authenticated;
grant execute on function public.admin_save_academic_term(uuid, text, smallint, date, date, boolean) to authenticated;
grant execute on function public.admin_save_academic_programme(text) to authenticated;
grant execute on function public.admin_save_academic_class(text, uuid) to authenticated;
grant execute on function public.admin_save_academic_subject(text, text, uuid) to authenticated;
grant execute on function public.admin_save_academic_department(text) to authenticated;
grant execute on function public.admin_assign_student_class(uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_assign_class_subject(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.staff_list_academic_assignments() to authenticated;
grant execute on function public.staff_list_academic_terms(uuid) to authenticated;
grant execute on function public.staff_list_academic_assessments() to authenticated;
grant execute on function public.staff_list_academic_students(uuid, uuid) to authenticated;
grant execute on function public.staff_save_academic_assessment(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.staff_save_academic_result(uuid, uuid, numeric) to authenticated;
grant execute on function public.staff_submit_academic_assessment(uuid) to authenticated;
grant execute on function public.admin_publish_academic_assessment(uuid) to authenticated;
grant execute on function public.student_list_my_academic_subjects() to authenticated;
grant execute on function public.student_list_my_academic_results() to authenticated;
