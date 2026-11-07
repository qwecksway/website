-- Public submissions are write-only. Only a verified administrator can read them.
create table public.first_year_registrations (
  id uuid primary key,
  created_at timestamptz not null default now(),
  learning_area text not null,
  option_number integer not null,
  electives text[] not null,
  details jsonb not null
);

alter table public.first_year_registrations enable row level security;
revoke all on public.first_year_registrations from public, anon, authenticated;

create table public.first_year_registration_settings (
  id boolean primary key default true check (id),
  is_open boolean not null default true
);
insert into public.first_year_registration_settings (id, is_open) values (true, true);
alter table public.first_year_registration_settings enable row level security;
revoke all on public.first_year_registration_settings from public, anon, authenticated;

create function public.submit_first_year_registration(submission_id uuid, registration jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  area text := registration->>'learning_area';
  option_text text := registration->>'option_number';
  electives text[];
  k text;
  value text;
  dob date;
  clean jsonb := '{}'::jsonb;
  registrations_open boolean;
begin
  if submission_id is null or jsonb_typeof(registration) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Invalid registration.';
  end if;

  select s.is_open into registrations_open
  from public.first_year_registration_settings s where s.id = true for share;
  if registrations_open is distinct from true then
    raise exception using errcode = '55000', message = 'First year registration is closed.';
  end if;

  electives := case area || ':' || option_text
    when 'General Arts:1' then array['Government','Economics','Additional Mathematics','Geography']
    when 'General Arts:2' then array['Government','Economics','French','Geography']
    when 'General Arts:3' then array['Government','Economics','Business Management','French']
    when 'Business:1' then array['Accounting','Economics','Business Management','Computing','Agriculture']
    when 'Applied Technology:1' then array['Design and Communication Technology','Building Construction and Wood Technology','Business Management','Additional Mathematics']
    when 'Applied Technology:2' then array['Design and Communication Technology','Electrical and Electronic Technology','Geography','Physics']
    when 'Applied Technology:3' then array['Design and Communication Technology','Electrical and Electronic Technology','Geography','Computing']
    when 'Home Economics:1' then array['Agriculture','Biology','Management in Living','Food and Nutrition']
    when 'Home Economics:2' then array['Agriculture','Biology','Management in Living','Clothing and Textiles']
    when 'Agriculture:1' then array['Agriculture','Biology','Business Management','Chemistry']
    when 'Languages:1' then array['Government','Literature-in-English','Agriculture','Ewe']
    when 'Languages:2' then array['Government','Literature-in-English','French','History']
    else null
  end;
  if electives is null then
    raise exception using errcode = '22023', message = 'Choose a valid learning area and option.';
  end if;

  foreach k in array array['surname','firstname','othernames','nationalid','gender','disability','braille','dob','guardian','relationship','phone','profession','address','year'] loop
    if jsonb_typeof(registration->k) is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Invalid registration details.';
    end if;
    value := trim(registration->>k);
    if length(value) > 160 or (k not in ('othernames', 'nationalid') and value = '') then
      raise exception using errcode = '22023', message = 'Complete all required fields (maximum 160 characters).';
    end if;
    if k in ('surname','firstname','guardian') and length(value) < 3 then
      raise exception using errcode = '22023', message = 'Names must contain at least 3 characters.';
    end if;
    if k in ('surname','firstname','othernames','nationalid','guardian','profession','address') then
      value := upper(value);
    end if;
    clean := clean || jsonb_build_object(k, value);
  end loop;

  if clean->>'gender' not in ('M','F')
    or clean->>'disability' not in ('1','2','3','4','5','6','7')
    or clean->>'braille' not in ('0','1')
    or clean->>'relationship' not in ('1','2','3','4','5','6','7','8','9','10')
    or clean->>'phone' !~ '^[0-9]{10}$'
    or (clean->>'nationalid' <> '' and length(clean->>'nationalid') <> 13)
    or clean->>'year' <> '2026'
    or clean->>'dob' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'Check the date, year, phone, ID and selected details.';
  end if;
  begin
    dob := (clean->>'dob')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'Enter a valid date of birth.';
  end;
  if dob > current_date or dob < date '1900-01-01' then
    raise exception using errcode = '22023', message = 'Enter a valid date of birth.';
  end if;

  insert into public.first_year_registrations (id, learning_area, option_number, electives, details)
  values (submission_id, area, option_text::integer, electives, clean)
  on conflict (id) do nothing;
  if not found and not exists (
    select 1 from public.first_year_registrations r
    where r.id = submission_id and r.learning_area = area
      and r.option_number = option_text::integer and r.details = clean
  ) then
    raise exception using errcode = '23505', message = 'This submission reference was already used with different details.';
  end if;
end;
$$;

create function public.admin_list_first_year_registrations()
returns table (id uuid, created_at timestamptz, learning_area text, option_number integer, electives text[], details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  return query select r.id, r.created_at, r.learning_area, r.option_number, r.electives, r.details
    from public.first_year_registrations r order by r.created_at, r.id;
end;
$$;

create function public.admin_get_first_year_registration_status()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  registrations_open boolean;
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  select s.is_open into registrations_open from public.first_year_registration_settings s where s.id = true;
  if not found then
    raise exception using errcode = '55000', message = 'Registration settings are unavailable.';
  end if;
  return registrations_open;
end;
$$;

create function public.admin_set_first_year_registration_status(registrations_open boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_portal_role())::text is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if registrations_open is null then
    raise exception using errcode = '22023', message = 'Choose whether registration is open or closed.';
  end if;
  update public.first_year_registration_settings s set is_open = registrations_open where s.id = true;
  if not found then
    raise exception using errcode = '55000', message = 'Registration settings are unavailable.';
  end if;
  return registrations_open;
end;
$$;

revoke all on function public.submit_first_year_registration(uuid, jsonb) from public;
grant execute on function public.submit_first_year_registration(uuid, jsonb) to anon, authenticated;
revoke all on function public.admin_list_first_year_registrations() from public, anon;
grant execute on function public.admin_list_first_year_registrations() to authenticated;
revoke all on function public.admin_get_first_year_registration_status() from public, anon;
revoke all on function public.admin_set_first_year_registration_status(boolean) from public, anon;
grant execute on function public.admin_get_first_year_registration_status() to authenticated;
grant execute on function public.admin_set_first_year_registration_status(boolean) to authenticated;
