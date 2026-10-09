-- Fix: UPDATE without WHERE is rejected by the database.
create or replace function public.admin_save_academic_term(
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
    update public.academic_years set is_current = (id = target_year_id) where is_current or id = target_year_id;
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
