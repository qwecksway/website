-- Class is assigned in the Academics menu; year (SHS 1..3) stays on the student record.
drop trigger if exists student_details_sync_enrolment on public.student_details;
drop function if exists public.sync_student_enrolment();

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
    'class', (select c.name from public.academic_enrolments as e
       join public.academic_years as y on y.id = e.academic_year_id and y.is_current
       join public.academic_classes as c on c.id = e.class_id
       where e.student_id = p.id limit 1),
    'house_name', h.name,
    'academic_year', coalesce((select y.name from public.academic_years as y where y.is_current limit 1), fs.academic_year, ''),
    'semester', coalesce((select t.name from public.academic_terms as t where t.is_current limit 1), ''),
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
