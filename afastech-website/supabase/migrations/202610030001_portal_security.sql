do $$
declare
  profile_role_type text;
  role_values text[];
  auth_trigger_exists boolean;
  admin_helper_exists boolean;
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.student_details') is null
    or to_regclass('public.staff_details') is null
  then
    raise exception 'Existing profiles, student_details, and staff_details tables are required.';
  end if;

  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into profile_role_type
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'public.profiles'::regclass
    and a.attname = 'role'
    and a.attnum > 0
    and not a.attisdropped;

  if profile_role_type is distinct from 'user_role' then
    raise exception 'Expected existing public.profiles.role to use public.user_role; found %.', profile_role_type;
  end if;

  select array_agg(e.enumlabel::text order by e.enumsortorder)
  into role_values
  from pg_catalog.pg_enum as e
  join pg_catalog.pg_type as t on t.oid = e.enumtypid
  join pg_catalog.pg_namespace as n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'user_role';

  if role_values is distinct from array['student', 'staff', 'admin']::text[] then
    raise exception 'Expected public.user_role values student, staff, admin; found %.', role_values;
  end if;

  select exists (
    select 1
    from pg_catalog.pg_trigger as tr
    join pg_catalog.pg_class as c on c.oid = tr.tgrelid
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    join pg_catalog.pg_proc as p on p.oid = tr.tgfoid
    where n.nspname = 'auth'
      and c.relname = 'users'
      and tr.tgname = 'on_auth_user_created'
      and not tr.tgisinternal
      and p.proname = 'handle_new_user'
  ) into auth_trigger_exists;

  select exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_admin'
      and p.prosecdef
  ) into admin_helper_exists;

  if not auth_trigger_exists or not admin_helper_exists then
    raise exception 'Expected existing auth user trigger and SECURITY DEFINER public.is_admin() helper.';
  end if;
end;
$$;
