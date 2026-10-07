-- Move many students to a year (SHS 1, SHS 2 or SHS 3) in one step.
create or replace function public.admin_set_students_year(
  target_student_ids uuid[],
  target_year text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_value text := public.normalize_student_year(target_year);
  updated_count integer;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if year_value is null then
    raise exception using errcode = '22023', message = 'Choose Year 1, Year 2 or Year 3.';
  end if;
  if target_student_ids is null or cardinality(target_student_ids) = 0 then
    raise exception using errcode = '22023', message = 'Select at least one student.';
  end if;
  if cardinality(target_student_ids) > 1000 then
    raise exception using errcode = '22023', message = 'Move no more than 1000 students at a time.';
  end if;

  update public.student_details
  set form_class = year_value, updated_at = now()
  where profile_id = any (target_student_ids)
    and exists (
      select 1 from public.profiles as p
      where p.id = student_details.profile_id and p.role::text = 'student'
    );
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.admin_set_students_year(uuid[], text) from public, anon;
grant execute on function public.admin_set_students_year(uuid[], text) to authenticated;