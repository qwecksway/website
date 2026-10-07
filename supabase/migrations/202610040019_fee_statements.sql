create table if not exists public.student_fee_statements (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  academic_year text not null default '',
  item_description text not null default 'School Fees',
  total_fees numeric(12, 2) not null default 0 check (total_fees >= 0),
  previous_balance numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.student_fee_statements enable row level security;
revoke all on public.student_fee_statements from public, anon, authenticated;

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
    'total_fees', coalesce(fs.total_fees, 0),
    'previous_balance', coalesce(fs.previous_balance, 0),
    'amount_paid', coalesce(fs.amount_paid, 0),
    'amount_payable', coalesce(fs.total_fees, 0) + coalesce(fs.previous_balance, 0) - coalesce(fs.amount_paid, 0),
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

create or replace function public.get_my_fee_statement()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.fee_statement_json((select auth.uid()))
$$;

create or replace function public.get_fee_statement(target_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role text := (select public.current_portal_role())::text;
begin
  if caller_role is null or caller_role not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'Administrator or staff access required.';
  end if;
  if caller_role = 'staff' and not exists (
    select 1
    from public.student_details as sd
    join public.staff_house_assignments as sha on sha.house_id = sd.house_id
    where sd.profile_id = target_student_id and sha.staff_id = (select auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'You are not assigned to this student''s house.';
  end if;
  return public.fee_statement_json(target_student_id);
end;
$$;

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
  payable numeric(12, 2);
  summary text;
  previous_status text;
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

  payable := round(target_total + target_previous - target_paid, 2);
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
    values (target_student_id, caller_id, coalesce(previous_status, ''), summary);
  end if;
end;
$$;

revoke all on function public.get_my_fee_statement() from public, anon;
revoke all on function public.get_fee_statement(uuid) from public, anon;
revoke all on function public.save_fee_statement(uuid, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.get_my_fee_statement() to authenticated;
grant execute on function public.get_fee_statement(uuid) to authenticated;
grant execute on function public.save_fee_statement(uuid, text, text, numeric, numeric, numeric) to authenticated;