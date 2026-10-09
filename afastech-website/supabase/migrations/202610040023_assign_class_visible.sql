-- Assigning a class (Academics menu) must show on the student's portal and must not overwrite their year.
create or replace function public.admin_assign_student_class(
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

  select p.name into student_programme
  from public.academic_classes as c
  join public.academic_programmes as p on p.id = c.programme_id
  where c.id = target_class_id;
  if not found or not exists (select 1 from public.academic_years where id = target_year_id) then
    raise exception using errcode = '22023', message = 'Select a valid class and academic year.';
  end if;
  select y.is_current into year_is_current from public.academic_years as y where y.id = target_year_id;

  insert into public.academic_enrolments (student_id, class_id, academic_year_id)
  values (target_student_id, target_class_id, target_year_id)
  on conflict (student_id, academic_year_id) do update set class_id = excluded.class_id;

  if year_is_current then
    update public.student_details
      set programme = student_programme, updated_at = now()
      where profile_id = target_student_id;
  end if;
end;
$$;
revoke all on function public.admin_assign_student_class(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_assign_student_class(uuid, uuid, uuid) to authenticated;

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
                   join public.academic_years as y on y.id = e.academic_year_id
                   join public.academic_classes as c on c.id = e.class_id
                   where e.student_id = (select auth.uid())
                   order by y.is_current desc, y.starts_on desc limit 1)
  )
$$;
revoke all on function public.student_academic_context() from public, anon;
grant execute on function public.student_academic_context() to authenticated;