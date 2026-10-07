drop policy "update own or admin" on public.profiles;

create policy "update own or admin"
on public.profiles for update to authenticated
using (
  (select auth.uid()) = id
  or (select public.is_admin())
)
with check (
  (select public.is_admin())
  or (
    (select auth.uid()) = id
    and role is not distinct from (select public.current_portal_role())
  )
);
