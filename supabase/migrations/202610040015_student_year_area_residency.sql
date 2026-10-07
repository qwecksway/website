-- Canonical values for year, learning area and residency.
create or replace function public.normalize_student_year(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v ~ '(^|[^0-9])1([^0-9]|$)' or v ~ '\mone\M' then 'SHS 1'
    when v ~ '(^|[^0-9])2([^0-9]|$)' or v ~ '\mtwo\M' then 'SHS 2'
    when v ~ '(^|[^0-9])3([^0-9]|$)' or v ~ '\mthree\M' then 'SHS 3'
    else null
  end
  from (select lower(trim(coalesce(raw, ''))) as v) as t;
$$;

create or replace function public.normalize_learning_area(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v in ('AGRIC', 'AGRICULTURE', 'AGRICULTURAL SCIENCE', 'AGRIC SCIENCE') then 'AGRIC'
    when v in ('GARTS', 'GENERALARTS', 'ARTS') then 'G.ARTS'
    when v in ('TECHNICAL', 'TECH') then 'TECHNICAL'
    when v in ('HOMEECONOMICS', 'HOMEECONS', 'HOMEECON') then 'HOME ECONOMICS'
    when v = 'BUSINESS' then 'BUSINESS'
    else null
  end
  from (select upper(regexp_replace(trim(coalesce(raw, '')), '[\s.\-_]+', '', 'g')) as v) as t;
$$;

create or replace function public.normalize_student_residency(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v like '%board%' then 'Boarding'
    when v like '%day%' then 'Day'
    else null
  end
  from (select lower(trim(coalesce(raw, ''))) as v) as t;
$$;

create or replace function public.student_details_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  normalized text;
begin
  if coalesce(trim(new.form_class), '') <> '' and (tg_op = 'INSERT' or new.form_class is distinct from old.form_class) then
    normalized := public.normalize_student_year(new.form_class);
    if normalized is null then
      raise exception using errcode = '22023', message = 'Year must be Year 1, Year 2 or Year 3.';
    end if;
    new.form_class := normalized;
  end if;
  if coalesce(trim(new.programme), '') <> '' and (tg_op = 'INSERT' or new.programme is distinct from old.programme) then
    normalized := public.normalize_learning_area(new.programme);
    if normalized is null then
      raise exception using errcode = '22023', message = 'Learning area must be AGRIC, G.ARTS, TECHNICAL, HOME ECONOMICS or BUSINESS.';
    end if;
    new.programme := normalized;
  end if;
  if coalesce(trim(new.residency), '') <> '' and (tg_op = 'INSERT' or new.residency is distinct from old.residency) then
    normalized := public.normalize_student_residency(new.residency);
    if normalized is null then
      raise exception using errcode = '22023', message = 'Residency must be Boarding or Day.';
    end if;
    new.residency := normalized;
  end if;
  return new;
end;
$$;

-- Tidy existing rows where the old value can be mapped; others are left as they are.
update public.student_details
set form_class = public.normalize_student_year(form_class)
where coalesce(trim(form_class), '') <> ''
  and public.normalize_student_year(form_class) is not null
  and form_class is distinct from public.normalize_student_year(form_class);

update public.student_details
set programme = public.normalize_learning_area(programme)
where coalesce(trim(programme), '') <> ''
  and public.normalize_learning_area(programme) is not null
  and programme is distinct from public.normalize_learning_area(programme);

update public.student_details
set residency = public.normalize_student_residency(residency)
where coalesce(trim(residency), '') <> ''
  and public.normalize_student_residency(residency) is not null
  and residency is distinct from public.normalize_student_residency(residency);

drop trigger if exists student_details_normalize on public.student_details;
create trigger student_details_normalize
  before insert or update on public.student_details
  for each row execute function public.student_details_normalize();

create index if not exists student_details_form_class_idx on public.student_details (form_class);