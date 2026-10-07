drop function if exists public.admin_register_staff_by_email(text, text, text);

alter table public.profiles add column if not exists must_change_password boolean not null default false;

create table if not exists public.staff_initial_passwords (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  temp_password text not null,
  created_at timestamptz not null default now()
);
alter table public.staff_initial_passwords enable row level security;
revoke all on public.staff_initial_passwords from public, anon, authenticated;

create or replace function public.admin_get_staff_temp_password(target_staff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  select temp_password into result from public.staff_initial_passwords where profile_id = target_staff_id;
  return result;
end;
$$;

create or replace function public.my_must_change_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.must_change_password from public.profiles as p where p.id = (select auth.uid())), false)
$$;

create or replace function public.complete_forced_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set must_change_password = false where id = (select auth.uid());
  delete from public.staff_initial_passwords where profile_id = (select auth.uid());
end;
$$;

revoke all on function public.admin_get_staff_temp_password(uuid) from public, anon;
revoke all on function public.my_must_change_password() from public, anon;
revoke all on function public.complete_forced_password_change() from public, anon;
grant execute on function public.admin_get_staff_temp_password(uuid) to authenticated;
grant execute on function public.my_must_change_password() to authenticated;
grant execute on function public.complete_forced_password_change() to authenticated;