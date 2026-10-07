create or replace function public.admin_register_staff_by_email(
  target_email text,
  target_full_name text,
  target_department text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
  normalized_name text := trim(coalesce(target_full_name, ''));
  normalized_department text := nullif(trim(coalesce(target_department, '')), '');
  found_id uuid;
  found_role public.user_role;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if normalized_name = '' or char_length(normalized_name) > 120 then
    raise exception using errcode = '22023', message = 'Enter a valid staff name.';
  end if;
  if normalized_department is not null and normalized_department <> all (array[
    'MATHS/ICT', 'SCIENCE', 'ENGLISH', 'BUSINESS', 'TECHNICAL', 'HOME ECONOMICS'
  ]) then
    raise exception using errcode = '22023', message = 'Choose an approved department.';
  end if;

  select u.id into found_id from auth.users as u where lower(u.email) = normalized_email;
  if found_id is null then
    raise exception using errcode = '22023',
      message = 'No sign-in account exists for that email. Create the user in Supabase Authentication first.';
  end if;

  select p.role into found_role from public.profiles as p where p.id = found_id for update;
  if not found then
    insert into public.profiles (id, full_name) values (found_id, normalized_name);
  elsif found_role is not null and found_role::text <> 'staff' then
    raise exception using errcode = '22023', message = 'That account already has a different role.';
  end if;

  update public.profiles set full_name = normalized_name, role = 'staff' where id = found_id;

  if found_role is null then
    insert into public.admin_role_audit (actor_id, target_user_id, previous_role, new_role)
    values ((select auth.uid()), found_id, null, 'staff');
  end if;

  insert into public.staff_details (profile_id, position, department)
  values (found_id, 'Teacher', normalized_department)
  on conflict (profile_id) do update
    set department = coalesce(excluded.department, public.staff_details.department);
end;
$$;

revoke all on function public.admin_register_staff_by_email(text, text, text) from public, anon;
grant execute on function public.admin_register_staff_by_email(text, text, text) to authenticated;