create table public.student_transcripts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  imported_by uuid not null references public.profiles (id),
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.student_transcript_entries (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.student_transcripts (id) on delete cascade,
  year_level smallint not null check (year_level between 1 and 3),
  semester_no smallint not null check (semester_no between 1 and 2),
  subject_name text not null check (length(trim(subject_name)) between 1 and 120),
  grade_point_average numeric(9, 3) check (grade_point_average is null or grade_point_average >= 0),
  final_grade text check (final_grade is null or length(trim(final_grade)) between 1 and 24),
  row_order integer not null check (row_order > 0),
  created_at timestamptz not null default now(),
  check (grade_point_average is not null or final_grade is not null),
  unique (transcript_id, row_order)
);

create index student_transcripts_student_status_idx
  on public.student_transcripts (student_id, status, created_at desc);
create index student_transcript_entries_transcript_order_idx
  on public.student_transcript_entries (transcript_id, year_level, semester_no, row_order);

alter table public.student_transcripts enable row level security;
alter table public.student_transcript_entries enable row level security;

revoke all on public.student_transcripts, public.student_transcript_entries
  from anon, authenticated;

create function public.admin_stage_student_transcript(
  target_student_id uuid,
  target_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_transcript_id uuid := gen_random_uuid();
  transcript_entry jsonb;
  year_level_text text;
  semester_no_text text;
  subject_text text;
  gpa_text text;
  grade_text text;
  entry_order bigint;
  entry_count integer;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  if jsonb_typeof(target_entries) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Transcript rows must be provided as a list.';
  end if;

  select count(*)::integer
  into entry_count
  from jsonb_array_elements(target_entries);

  if entry_count < 1 or entry_count > 500 then
    raise exception using errcode = '22023', message = 'A transcript must contain between 1 and 500 rows.';
  end if;

  perform 1
  from public.profiles
  where id = target_student_id and role::text = 'student';
  if not found then
    raise exception using errcode = '22023', message = 'Select an existing student account.';
  end if;

  insert into public.student_transcripts (id, student_id, imported_by)
  values (new_transcript_id, target_student_id, (select auth.uid()));

  for transcript_entry, entry_order in
    select item.value, item.ordinality
    from jsonb_array_elements(target_entries) with ordinality as item(value, ordinality)
  loop
    year_level_text := trim(coalesce(transcript_entry ->> 'year_level', ''));
    semester_no_text := trim(coalesce(transcript_entry ->> 'semester_no', ''));
    subject_text := trim(coalesce(transcript_entry ->> 'subject_name', ''));
    gpa_text := trim(coalesce(transcript_entry ->> 'grade_point_average', ''));
    grade_text := trim(coalesce(transcript_entry ->> 'final_grade', ''));

    if year_level_text not in ('1', '2', '3')
      or semester_no_text not in ('1', '2')
      or subject_text = ''
      or char_length(subject_text) > 120
      or (gpa_text <> '' and gpa_text !~ '^[0-9]{1,6}([.][0-9]{1,3})?$')
      or (grade_text <> '' and char_length(grade_text) > 24)
      or (gpa_text = '' and grade_text = '')
    then
      raise exception using errcode = '22023', message = 'A transcript row contains invalid year, semester, subject, GPA, or final grade data.';
    end if;

    insert into public.student_transcript_entries (
      transcript_id,
      year_level,
      semester_no,
      subject_name,
      grade_point_average,
      final_grade,
      row_order
    )
    values (
      new_transcript_id,
      year_level_text::smallint,
      semester_no_text::smallint,
      subject_text,
      nullif(gpa_text, '')::numeric,
      nullif(grade_text, ''),
      entry_order::integer
    );
  end loop;

  return new_transcript_id;
end;
$$;

create function public.admin_list_student_transcripts()
returns table (
  id uuid,
  student_id uuid,
  student_name text,
  index_number text,
  status text,
  created_at timestamptz,
  published_at timestamptz,
  entry_count integer,
  entries jsonb
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
    select transcript.id, transcript.student_id, profile.full_name,
      student.index_number, transcript.status, transcript.created_at,
      transcript.published_at,
      count(entry.id)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'year_level', entry.year_level,
        'semester_no', entry.semester_no,
        'subject_name', entry.subject_name,
        'grade_point_average', entry.grade_point_average,
        'final_grade', entry.final_grade
      ) order by entry.year_level, entry.semester_no, entry.row_order)
        filter (where entry.id is not null), '[]'::jsonb)
    from public.student_transcripts as transcript
    join public.profiles as profile on profile.id = transcript.student_id
    left join public.student_details as student on student.profile_id = transcript.student_id
    left join public.student_transcript_entries as entry on entry.transcript_id = transcript.id
    group by transcript.id, profile.full_name, student.index_number
    order by transcript.created_at desc;
end;
$$;

create function public.admin_publish_student_transcript(target_transcript_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  update public.student_transcripts
  set status = 'published', published_at = now()
  where id = target_transcript_id and status = 'draft';
  if not found then
    raise exception using errcode = 'P0002', message = 'Draft transcript not found.';
  end if;
end;
$$;

create function public.admin_delete_draft_student_transcript(target_transcript_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  delete from public.student_transcripts
  where id = target_transcript_id and status = 'draft';
  if not found then
    raise exception using errcode = 'P0002', message = 'Draft transcript not found.';
  end if;
end;
$$;

create function public.student_list_my_transcript_entries()
returns table (
  transcript_id uuid,
  year_level smallint,
  semester_no smallint,
  subject_name text,
  grade_point_average numeric,
  final_grade text,
  imported_at timestamptz
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
    select entry.transcript_id, entry.year_level, entry.semester_no,
      entry.subject_name, entry.grade_point_average, entry.final_grade,
      transcript.published_at
    from public.student_transcript_entries as entry
    join public.student_transcripts as transcript
      on transcript.id = entry.transcript_id
      and transcript.student_id = (select auth.uid())
      and transcript.status = 'published'
    order by transcript.published_at desc, entry.year_level, entry.semester_no, entry.row_order;
end;
$$;

revoke all on function public.admin_stage_student_transcript(uuid, jsonb) from public, anon;
revoke all on function public.admin_list_student_transcripts() from public, anon;
revoke all on function public.admin_publish_student_transcript(uuid) from public, anon;
revoke all on function public.admin_delete_draft_student_transcript(uuid) from public, anon;
revoke all on function public.student_list_my_transcript_entries() from public, anon;

grant execute on function public.admin_stage_student_transcript(uuid, jsonb) to authenticated;
grant execute on function public.admin_list_student_transcripts() to authenticated;
grant execute on function public.admin_publish_student_transcript(uuid) to authenticated;
grant execute on function public.admin_delete_draft_student_transcript(uuid) to authenticated;
grant execute on function public.student_list_my_transcript_entries() to authenticated;
