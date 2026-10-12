-- Academic calendar: sessions, semesters, the published grade scale and the
-- tenant-wide academic settings the registration workflow reads.
--
-- 0001-0005 are frozen, so everything that used to be derived from them is
-- restated here: re-pasting this file must land the database in exactly the
-- same state, which is why every statement is guarded.

---------------------------------------------------------------------------
-- Academic sessions (one per academic year, e.g. 2025/2026)
---------------------------------------------------------------------------
create table if not exists public.academic_sessions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_sessions_tenant_name_unique unique (tenant_id, name),
  constraint academic_sessions_dates_check check (end_date > start_date)
);

create index if not exists academic_sessions_tenant_active_idx
  on public.academic_sessions (tenant_id, is_active, start_date desc);

-- "Only one session is active per tenant" is a database rule, not a UI rule:
-- a partial unique index makes the second concurrent activation fail instead of
-- leaving the tenant with two calendars to choose from.
create unique index if not exists academic_sessions_one_active_per_tenant
  on public.academic_sessions (tenant_id) where is_active;

---------------------------------------------------------------------------
-- Semesters, each belonging to one session
---------------------------------------------------------------------------
create table if not exists public.semesters (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  academic_session_id uuid not null references public.academic_sessions (id) on delete cascade,
  name                text not null,
  number              smallint not null default 1,
  start_date          date not null,
  end_date            date not null,
  is_active           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint semesters_session_name_unique unique (academic_session_id, name),
  constraint semesters_number_check check (number between 1 and 3),
  constraint semesters_dates_check check (end_date > start_date)
);

create index if not exists semesters_tenant_active_idx
  on public.semesters (tenant_id, is_active, academic_session_id);
create index if not exists semesters_session_idx
  on public.semesters (academic_session_id);

create unique index if not exists semesters_one_active_per_tenant
  on public.semesters (tenant_id) where is_active;

---------------------------------------------------------------------------
-- Grade scale: the letter bands and grade points the school publishes
---------------------------------------------------------------------------
create table if not exists public.grade_scale (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  letter      text not null,
  min_percent double precision not null,
  max_percent double precision not null,
  points      numeric(4, 2) not null,
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint grade_scale_tenant_letter_unique unique (tenant_id, letter),
  constraint grade_scale_points_check check (points between 0 and 10),
  constraint grade_scale_range_check check (max_percent >= min_percent)
);

create index if not exists grade_scale_tenant_band_idx
  on public.grade_scale (tenant_id, min_percent);

-- The Nigerian-style scale the school asked for: 5.0 for a 70 and above,
-- nothing below 40 carries credit. Every existing tenant gets the same bands so
-- GPA is computable from day one of this migration.
insert into public.grade_scale (tenant_id, letter, min_percent, max_percent, points, position)
select t.id, s.letter, s.min_percent, s.max_percent, s.points, s.position
  from public.tenants t
 cross join (values
   ('A', 70.0, 100.0, 5.00, 1),
   ('B', 60.0,  69.0, 4.00, 2),
   ('C', 50.0,  59.0, 3.00, 3),
   ('D', 45.0,  49.0, 2.00, 4),
   ('E', 40.0,  44.0, 1.00, 5),
   ('F',  0.0,  39.0, 0.00, 6)
 ) as s (letter, min_percent, max_percent, points, position)
on conflict (tenant_id, letter) do update
  set min_percent = excluded.min_percent,
      max_percent = excluded.max_percent,
      points      = excluded.points,
      position    = excluded.position;

---------------------------------------------------------------------------
-- Academic settings: one row per tenant, holds the registration window
---------------------------------------------------------------------------
create table if not exists public.academic_settings (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id) on delete cascade,
  registration_opens_at   timestamptz,
  registration_closes_at  timestamptz,
  min_credit_units        integer not null default 10,
  max_credit_units        integer not null default 30,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint academic_settings_credit_units_check
    check (min_credit_units between 0 and 60 and max_credit_units between 1 and 60
           and max_credit_units >= min_credit_units),
  constraint academic_settings_window_check
    check (registration_closes_at is null or registration_opens_at is null
           or registration_closes_at > registration_opens_at)
);

create unique index if not exists academic_settings_tenant_unique
  on public.academic_settings (tenant_id);

insert into public.academic_settings (tenant_id, min_credit_units, max_credit_units)
select id, 10, 30 from public.tenants
on conflict (tenant_id) do nothing;

-- A school created after this migration must not start without a grade scale or
-- a credit-unit limit: registration and GPA both read those rows.
create or replace function public.seed_tenant_academics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.grade_scale (tenant_id, letter, min_percent, max_percent, points, position)
  select new.id, s.letter, s.min_percent, s.max_percent, s.points, s.position
    from (values
      ('A', 70.0, 100.0, 5.00, 1),
      ('B', 60.0,  69.0, 4.00, 2),
      ('C', 50.0,  59.0, 3.00, 3),
      ('D', 45.0,  49.0, 2.00, 4),
      ('E', 40.0,  44.0, 1.00, 5),
      ('F',  0.0,  39.0, 0.00, 6)
    ) as s (letter, min_percent, max_percent, points, position)
  on conflict (tenant_id, letter) do nothing;

  insert into public.academic_settings (tenant_id, min_credit_units, max_credit_units)
  values (new.id, 10, 30)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

drop trigger if exists seed_tenant_academics on public.tenants;
create trigger seed_tenant_academics
  after insert on public.tenants
  for each row execute function public.seed_tenant_academics();

---------------------------------------------------------------------------
-- Credit units are the weight of every grade point average, so a course
-- without one is now a data error rather than an invisible zero.
---------------------------------------------------------------------------
update public.courses set credit_units = 3 where credit_units is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where connamespace = 'public'::regnamespace
       and conrelid = 'public.courses'::regclass
       and conname = 'courses_credit_units_check'
  ) then
    alter table public.courses
      add constraint courses_credit_units_check check (credit_units between 1 and 24);
  end if;
end;
$$;

alter table public.courses alter column credit_units set default 3;
alter table public.courses alter column credit_units set not null;

---------------------------------------------------------------------------
-- Grading helpers. letter_from_score() replaces the 90/80/70/60 scale that
-- 0002 shipped with: the tenant's own grade_scale rows win, and the CASE below
-- is the fallback for a caller with no tenant (the SQL editor path) or a
-- tenant whose scale rows were deleted.
--
-- SECURITY DEFINER because the default_grade_letter() trigger calls it while
-- inserting grade_entries, and reading grade_scale from inside that insert must
-- not recurse into grade_scale's own policy.
---------------------------------------------------------------------------
drop function if exists public.letter_from_score(double precision);
create or replace function public.letter_from_score(p_score double precision)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select gs.letter
       from public.grade_scale gs
      where gs.tenant_id = public.auth_tenant_id()
        and p_score between gs.min_percent and gs.max_percent
      order by gs.min_percent desc
      limit 1),
    case
      when p_score >= 70 then 'A'
      when p_score >= 60 then 'B'
      when p_score >= 50 then 'C'
      when p_score >= 45 then 'D'
      when p_score >= 40 then 'E'
      else 'F'
    end
  );
$$;

-- Null for a letter the scale does not know (an externally imported grade), so
-- the GPA functions can skip it instead of counting it as a zero.
create or replace function public.grade_points(p_letter text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select gs.points
       from public.grade_scale gs
      where gs.tenant_id = public.auth_tenant_id()
        and gs.letter = upper(btrim(p_letter))
      limit 1),
    case upper(btrim(p_letter))
      when 'A' then 5.00
      when 'B' then 4.00
      when 'C' then 3.00
      when 'D' then 2.00
      when 'E' then 1.00
      when 'F' then 0.00
    end
  );
$$;

---------------------------------------------------------------------------
-- Active calendar helpers
---------------------------------------------------------------------------
create or replace function public.active_academic_session()
returns public.academic_sessions
language sql
stable
security definer
set search_path = public
as $$
  select s.*
    from public.academic_sessions s
   where s.tenant_id = public.auth_tenant_id()
     and s.is_active
   order by s.start_date desc
   limit 1;
$$;

create or replace function public.active_semester()
returns public.semesters
language sql
stable
security definer
set search_path = public
as $$
  select m.*
    from public.semesters m
   where m.tenant_id = public.auth_tenant_id()
     and m.is_active
   order by m.start_date desc
   limit 1;
$$;

create or replace function public.active_semester_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select id from public.active_semester();
$$;

---------------------------------------------------------------------------
-- Activation RPCs. Deactivate first, then activate: flipping both flags in one
-- statement could momentarily put two rows in the partial unique index.
---------------------------------------------------------------------------
create or replace function public.set_active_academic_session(p_session_id uuid)
returns public.academic_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.academic_sessions;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change the active academic session'
      using hint = 'Sign in as a school administrator and try again.';
  end if;

  select * into v_row from public.academic_sessions where id = p_session_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Academic session not found';
  end if;

  update public.academic_sessions set is_active = false
    where tenant_id = v_row.tenant_id and id <> v_row.id;

  -- A semester cannot stay active when its own session is no longer current.
  update public.semesters set is_active = false
    where tenant_id = v_row.tenant_id and academic_session_id <> v_row.id;

  update public.academic_sessions set is_active = true
    where id = v_row.id
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_active_semester(p_semester_id uuid)
returns public.semesters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.semesters;
  v_session public.academic_sessions;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change the active semester'
      using hint = 'Sign in as a school administrator and try again.';
  end if;

  select * into v_row from public.semesters where id = p_semester_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Semester not found';
  end if;

  select * into v_session from public.academic_sessions where id = v_row.academic_session_id;
  if not v_session.is_active then
    raise exception 'Activate the % academic session first', v_session.name
      using hint = 'Choose the session in the academic calendar, then pick one of its semesters.';
  end if;

  update public.semesters set is_active = false
    where tenant_id = v_row.tenant_id and id <> v_row.id;

  update public.semesters set is_active = true
    where id = v_row.id
    returning * into v_row;

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- A semester must sit inside its session, and only an administrator maintains
-- the calendar.
---------------------------------------------------------------------------
create or replace function public.guard_semester_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.academic_sessions;
begin
  -- auth.uid() is null on the SQL-editor / service-role path, which is how a
  -- school is first configured; every other caller must be an administrator.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an administrator can change the academic calendar';
  end if;

  select * into v_session from public.academic_sessions where id = new.academic_session_id;
  if not found then
    raise exception 'Academic session not found';
  end if;
  if v_session.tenant_id <> new.tenant_id then
    raise exception 'Academic session does not belong to this school';
  end if;
  if new.start_date < v_session.start_date or new.end_date > v_session.end_date then
    raise exception 'The semester dates must fall inside the % session', v_session.name;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_semester_write on public.semesters;
create trigger guard_semester_write
  before insert or update on public.semesters
  for each row execute function public.guard_semester_write();

---------------------------------------------------------------------------
-- updated_at bookkeeping, tenant default and audit trail. 0002 and 0003 only
-- enumerate the tables that existed when they ran, so the new tables register
-- themselves here.
---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'academic_sessions', 'semesters', 'grade_scale', 'academic_settings'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      t
    );
    execute format('alter table public.%I alter column tenant_id set default public.auth_tenant_id()', t);
  end loop;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'academic_sessions', 'semesters', 'grade_scale', 'academic_settings'
  ]
  loop
    execute format('drop trigger if exists audit_changes on public.%I', t);
    execute format(
      'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
      t
    );
  end loop;
end;
$$;

---------------------------------------------------------------------------
-- Row Level Security
---------------------------------------------------------------------------
alter table public.academic_sessions enable row level security;
alter table public.semesters         enable row level security;
alter table public.grade_scale       enable row level security;
alter table public.academic_settings enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.academic_sessions, public.semesters, public.grade_scale,
  public.academic_settings to authenticated;
grant insert, update, delete on public.academic_sessions, public.semesters,
  public.grade_scale, public.academic_settings to authenticated;

-- The calendar is read by everyone in the school: a student sees which session
-- their result slip belongs to.
drop policy if exists academic_sessions_read on public.academic_sessions;
create policy academic_sessions_read on public.academic_sessions
  for select to authenticated using (tenant_id = public.auth_tenant_id());

drop policy if exists academic_sessions_write on public.academic_sessions;
create policy academic_sessions_write on public.academic_sessions
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists academic_sessions_update on public.academic_sessions;
create policy academic_sessions_update on public.academic_sessions
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists academic_sessions_delete on public.academic_sessions;
create policy academic_sessions_delete on public.academic_sessions
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists semesters_read on public.semesters;
create policy semesters_read on public.semesters
  for select to authenticated using (tenant_id = public.auth_tenant_id());

drop policy if exists semesters_insert on public.semesters;
create policy semesters_insert on public.semesters
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists semesters_update on public.semesters;
create policy semesters_update on public.semesters
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists semesters_delete on public.semesters;
create policy semesters_delete on public.semesters
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists grade_scale_read on public.grade_scale;
create policy grade_scale_read on public.grade_scale
  for select to authenticated using (tenant_id = public.auth_tenant_id());

drop policy if exists grade_scale_write on public.grade_scale;
create policy grade_scale_write on public.grade_scale
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists grade_scale_update on public.grade_scale;
create policy grade_scale_update on public.grade_scale
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists grade_scale_delete on public.grade_scale;
create policy grade_scale_delete on public.grade_scale
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists academic_settings_read on public.academic_settings;
create policy academic_settings_read on public.academic_settings
  for select to authenticated using (tenant_id = public.auth_tenant_id());

drop policy if exists academic_settings_insert on public.academic_settings;
create policy academic_settings_insert on public.academic_settings
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists academic_settings_update on public.academic_settings;
create policy academic_settings_update on public.academic_settings
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
