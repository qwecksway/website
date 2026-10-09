-- Itemised fee charges that the administrator can push to a whole year,
-- a programme, every student, or one student.

create table if not exists public.fee_charges (
  id uuid primary key default gen_random_uuid(),
  description text not null check (length(trim(description)) between 1 and 200),
  amount numeric(12, 2) not null check (amount <> 0),
  scope_type text not null check (scope_type in ('all', 'year', 'programme', 'student')),
  scope_value text not null default '',
  student_count integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id)
);
alter table public.fee_charges enable row level security;
revoke all on public.fee_charges from public, anon, authenticated;

create table if not exists public.student_fee_items (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.fee_charges (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  description text not null,
  amount numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  unique (charge_id, student_id)
);
create index if not exists student_fee_items_student_idx on public.student_fee_items (student_id);
alter table public.student_fee_items enable row level security;
revoke all on public.student_fee_items from public, anon, authenticated;

-- Statement JSON now carries the itemised charges. total_fees = base fees + charges.
create or replace function public.fee_statement_json(target_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'student_id', p.id,
    'student_name', p.full_name,
    'index_number', sd.index_number,
    'programme', sd.programme,
    'year', sd.form_class,
    'house_name', h.name,
    'academic_year', coalesce(fs.academic_year, ''),
    'item_description', coalesce(fs.item_description, 'School Fees'),
    'base_fees', coalesce(fs.total_fees, 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('description', i.description, 'amount', i.amount) order by i.created_at, i.id)
      from public.student_fee_items as i where i.student_id = p.id
    ), '[]'::jsonb),
    'total_fees', coalesce(fs.total_fees, 0) + coalesce((select sum(i.amount) from public.student_fee_items as i where i.student_id = p.id), 0),
    'previous_balance', coalesce(fs.previous_balance, 0),
    'amount_paid', coalesce(fs.amount_paid, 0),
    'amount_payable', coalesce(fs.total_fees, 0) + coalesce((select sum(i.amount) from public.student_fee_items as i where i.student_id = p.id), 0)
      + coalesce(fs.previous_balance, 0) - coalesce(fs.amount_paid, 0),
    'updated_at', fs.updated_at,
    'recorded', fs.student_id is not null
  )
  from public.profiles as p
  left join public.student_details as sd on sd.profile_id = p.id
  left join public.school_houses as h on h.id = sd.house_id
  left join public.student_fee_statements as fs on fs.student_id = p.id
  where p.id = target_student_id and p.role::text = 'student'
$$;
revoke all on function public.fee_statement_json(uuid) from public, anon, authenticated;

-- Recomputes the short fee status text and audits changes.
create or replace function public.refresh_fee_summary(target_student_id uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payable numeric(12, 2);
  summary text;
  previous_status text;
begin
  select round(coalesce(fs.total_fees, 0) + coalesce((select sum(i.amount) from public.student_fee_items as i where i.student_id = target_student_id), 0)
    + coalesce(fs.previous_balance, 0) - coalesce(fs.amount_paid, 0), 2)
  into payable
  from (select 1) as d
  left join public.student_fee_statements as fs on fs.student_id = target_student_id;

  summary := case
    when payable > 0 then 'Owing GHS ' || to_char(payable, 'FM999,999,990.00')
    when payable < 0 then 'Credit GHS ' || to_char(-payable, 'FM999,999,990.00')
    else 'Fully paid'
  end;

  select fees_status into previous_status from public.student_details where profile_id = target_student_id;
  insert into public.student_details (profile_id, fees_status)
  values (target_student_id, summary)
  on conflict (profile_id) do update set fees_status = excluded.fees_status, updated_at = now();

  if previous_status is distinct from summary then
    insert into public.student_fee_status_audit (student_id, changed_by, previous_status, new_status)
    values (target_student_id, actor, coalesce(previous_status, ''), summary);
  end if;
end;
$$;
revoke all on function public.refresh_fee_summary(uuid, uuid) from public, anon, authenticated;

-- save_fee_statement: same signature, balance now includes itemised charges.
create or replace function public.save_fee_statement(
  target_student_id uuid,
  target_academic_year text,
  target_item text,
  target_total numeric,
  target_previous numeric,
  target_paid numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text := (select public.current_portal_role())::text;
begin
  if caller_role is null or caller_role not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'Administrator or staff access required.';
  end if;
  if caller_role = 'staff' and not exists (
    select 1
    from public.student_details as sd
    join public.staff_house_assignments as sha on sha.house_id = sd.house_id
    where sd.profile_id = target_student_id and sha.staff_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'You are not assigned to this student''s house.';
  end if;
  if not exists (select 1 from public.profiles where id = target_student_id and role::text = 'student') then
    raise exception using errcode = 'P0002', message = 'Student record not found.';
  end if;
  if target_total is null or target_total < 0 or target_total > 100000000
    or target_paid is null or target_paid < 0 or target_paid > 100000000
    or target_previous is null or abs(target_previous) > 100000000 then
    raise exception using errcode = '22023', message = 'Enter valid amounts. Total fees and amount paid cannot be negative.';
  end if;

  insert into public.student_fee_statements
    (student_id, academic_year, item_description, total_fees, previous_balance, amount_paid, updated_by, updated_at)
  values (
    target_student_id,
    left(trim(coalesce(target_academic_year, '')), 20),
    coalesce(nullif(left(trim(coalesce(target_item, '')), 200), ''), 'School Fees'),
    round(target_total, 2), round(target_previous, 2), round(target_paid, 2), caller_id, now()
  )
  on conflict (student_id) do update set
    academic_year = excluded.academic_year,
    item_description = excluded.item_description,
    total_fees = excluded.total_fees,
    previous_balance = excluded.previous_balance,
    amount_paid = excluded.amount_paid,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  perform public.refresh_fee_summary(target_student_id, caller_id);
end;
$$;

create or replace function public.require_admin_for_fees()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
end;
$$;
revoke all on function public.require_admin_for_fees() from public, anon, authenticated;

create or replace function public.fee_charge_targets(scope_type text, scope_value text, target_student_id uuid)
returns table (student_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles as p
  left join public.student_details as sd on sd.profile_id = p.id
  where p.role::text = 'student'
    and case scope_type
      when 'all' then true
      when 'year' then lower(trim(coalesce(sd.form_class, ''))) = lower(trim(coalesce(scope_value, '')))
      when 'programme' then lower(trim(coalesce(sd.programme, ''))) = lower(trim(coalesce(scope_value, '')))
      when 'student' then p.id = target_student_id
      else false
    end
$$;
revoke all on function public.fee_charge_targets(text, text, uuid) from public, anon, authenticated;

create or replace function public.fee_charge_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin_for_fees();
  return jsonb_build_object(
    'years', coalesce((select jsonb_agg(v order by v) from (select distinct trim(form_class) as v from public.student_details where nullif(trim(form_class), '') is not null) x), '[]'::jsonb),
    'programmes', coalesce((select jsonb_agg(v order by v) from (select distinct trim(programme) as v from public.student_details where nullif(trim(programme), '') is not null) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.preview_fee_charge(scope_type text, scope_value text, target_student_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin_for_fees();
  return (select count(*) from public.fee_charge_targets(scope_type, scope_value, target_student_id))::integer;
end;
$$;

create or replace function public.apply_fee_charge(
  charge_description text,
  charge_amount numeric,
  scope_type text,
  scope_value text,
  target_student_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_id uuid;
  affected integer;
  sid uuid;
  clean_description text := left(trim(coalesce(charge_description, '')), 200);
begin
  perform public.require_admin_for_fees();
  if clean_description = '' then
    raise exception using errcode = '22023', message = 'Enter a description for the charge.';
  end if;
  if charge_amount is null or charge_amount = 0 or abs(charge_amount) > 100000000 then
    raise exception using errcode = '22023', message = 'Enter a valid, non-zero amount.';
  end if;
  if scope_type not in ('all', 'year', 'programme', 'student') then
    raise exception using errcode = '22023', message = 'Choose who the charge applies to.';
  end if;
  if scope_type in ('year', 'programme') and nullif(trim(coalesce(scope_value, '')), '') is null then
    raise exception using errcode = '22023', message = 'Choose a year or programme.';
  end if;
  if scope_type = 'student' and target_student_id is null then
    raise exception using errcode = '22023', message = 'Choose a student.';
  end if;

  insert into public.fee_charges (description, amount, scope_type, scope_value, created_by)
  values (clean_description, round(charge_amount, 2), scope_type,
    case scope_type when 'student' then coalesce(target_student_id::text, '') else coalesce(trim(scope_value), '') end, caller_id)
  returning id into new_id;

  insert into public.student_fee_statements (student_id, updated_by)
  select t.student_id, caller_id from public.fee_charge_targets(scope_type, scope_value, target_student_id) as t
  on conflict (student_id) do nothing;

  insert into public.student_fee_items (charge_id, student_id, description, amount)
  select new_id, t.student_id, clean_description, round(charge_amount, 2)
  from public.fee_charge_targets(scope_type, scope_value, target_student_id) as t;
  get diagnostics affected = row_count;

  if affected = 0 then
    raise exception using errcode = 'P0002', message = 'No students matched, so nothing was charged.';
  end if;
  update public.fee_charges set student_count = affected where id = new_id;

  for sid in select i.student_id from public.student_fee_items as i where i.charge_id = new_id loop
    perform public.refresh_fee_summary(sid, caller_id);
  end loop;
  return affected;
end;
$$;

create or replace function public.void_fee_charge(target_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  sids uuid[];
  sid uuid;
begin
  perform public.require_admin_for_fees();
  if not exists (select 1 from public.fee_charges where id = target_charge_id and voided_at is null) then
    raise exception using errcode = 'P0002', message = 'Charge not found or already reversed.';
  end if;
  select array_agg(student_id) into sids from public.student_fee_items where charge_id = target_charge_id;
  delete from public.student_fee_items where charge_id = target_charge_id;
  update public.fee_charges set voided_at = now(), voided_by = caller_id where id = target_charge_id;
  foreach sid in array coalesce(sids, '{}') loop
    perform public.refresh_fee_summary(sid, caller_id);
  end loop;
end;
$$;

create or replace function public.list_fee_charges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin_for_fees();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'description', c.description, 'amount', c.amount, 'scope_type', c.scope_type,
      'scope_label', case c.scope_type
        when 'all' then 'All students'
        when 'student' then coalesce((select full_name from public.profiles where id::text = c.scope_value), 'One student')
        when 'year' then 'Year: ' || c.scope_value
        else 'Programme: ' || c.scope_value end,
      'student_count', c.student_count, 'created_at', c.created_at, 'voided', c.voided_at is not null
    ) order by c.created_at desc)
    from (select * from public.fee_charges order by created_at desc limit 100) as c
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.save_fee_statement(uuid, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.save_fee_statement(uuid, text, text, numeric, numeric, numeric) to authenticated;
revoke all on function public.fee_charge_options() from public, anon;
revoke all on function public.preview_fee_charge(text, text, uuid) from public, anon;
revoke all on function public.apply_fee_charge(text, numeric, text, text, uuid) from public, anon;
revoke all on function public.void_fee_charge(uuid) from public, anon;
revoke all on function public.list_fee_charges() from public, anon;
grant execute on function public.fee_charge_options() to authenticated;
grant execute on function public.preview_fee_charge(text, text, uuid) to authenticated;
grant execute on function public.apply_fee_charge(text, numeric, text, text, uuid) to authenticated;
grant execute on function public.void_fee_charge(uuid) to authenticated;
grant execute on function public.list_fee_charges() to authenticated;
