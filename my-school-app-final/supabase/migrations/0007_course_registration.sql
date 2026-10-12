-- Course registration. A student picks courses for the active semester inside
-- the window an administrator opens; an administrator approves or rejects and
-- an approved registration becomes an ACTIVE enrolment, which is what the
-- existing grade books and timetables already read.

---------------------------------------------------------------------------
-- Table
---------------------------------------------------------------------------
create table if not exists public.course_registrations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  student_id       uuid not null references public.profiles (id) on delete cascade,
  course_id        uuid not null references public.courses (id) on delete cascade,
  semester_id      uuid not null references public.semesters (id) on delete cascade,
  -- Snapshotted: a later edit of the course catalogue must not rewrite the
  -- credit load a student actually registered under.
  credit_units     integer not null,
  status           text not null default 'PENDING',
  requested_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by_id   uuid references public.profiles (id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint course_registrations_status_check
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'DROPPED')),
  constraint course_registrations_credit_units_check check (credit_units between 1 and 24),
  constraint course_registrations_student_course_semester_unique
    unique (student_id, course_id, semester_id)
);

create index if not exists course_registrations_semester_status_idx
  on public.course_registrations (tenant_id, semester_id, status);
create index if not exists course_registrations_student_idx
  on public.course_registrations (student_id, semester_id);
create index if not exists course_registrations_course_idx
  on public.course_registrations (course_id);

---------------------------------------------------------------------------
-- Registration window
---------------------------------------------------------------------------
create or replace function public.academic_settings_row()
returns public.academic_settings
language sql
stable
security definer
set search_path = public
as $$
  select * from public.academic_settings
   where tenant_id = public.auth_tenant_id()
   order by created_at
   limit 1;
$$;

create or replace function public.registration_window_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.academic_settings_row() s
     where s.registration_opens_at is not null
       and s.registration_closes_at is not null
       and now() >= s.registration_opens_at
       and now() <  s.registration_closes_at
  );
$$;

create or replace function public.registration_window_message()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.academic_settings;
begin
  s := public.academic_settings_row();

  if s.id is null then
    return 'Registration is not open yet: no window has been set for this school.';
  end if;
  if s.registration_opens_at is null or s.registration_closes_at is null then
    return 'Registration is closed: an administrator must set both an open and a close time.';
  end if;
  if now() < s.registration_opens_at then
    return 'Registration opens on ' || to_char(s.registration_opens_at, 'FMDD Mon YYYY') || '.';
  end if;
  if now() >= s.registration_closes_at then
    return 'Registration closed on ' || to_char(s.registration_closes_at, 'FMDD Mon YYYY') || '.';
  end if;
  return null;
end;
$$;

---------------------------------------------------------------------------
-- Credit load
-- Counted from the registrations that still occupy a place: PENDING and
-- APPROVED. REJECTED and DROPPED no longer weigh anything.
---------------------------------------------------------------------------
create or replace function public.student_credit_load(
  p_student_id  uuid,
  p_semester_id uuid,
  p_statuses    text[] default array['PENDING', 'APPROVED']
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(credit_units), 0)::integer
    from public.course_registrations r
   where r.student_id = p_student_id
     and r.semester_id = p_semester_id
     and r.status = any (p_statuses);
$$;

---------------------------------------------------------------------------
-- Registration RPCs
---------------------------------------------------------------------------
create or replace function public.register_for_course(p_course_id uuid)
returns public.course_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student  uuid := auth.uid();
  v_semester public.semesters;
  v_settings public.academic_settings;
  v_course   public.courses;
  v_existing public.course_registrations;
  v_load     integer;
  v_row      public.course_registrations;
begin
  if v_student is null then
    raise exception 'You must be signed in to register for a course';
  end if;

  if public.auth_role() <> 'STUDENT' and not public.is_admin() then
    raise exception 'Only students register their own courses';
  end if;

  select * into v_semester from public.active_semester();
  if v_semester.id is null then
    raise exception 'Registration is closed: no semester is currently active';
  end if;

  v_settings := public.academic_settings_row();
  if not public.registration_window_open() then
    raise exception '%', coalesce(public.registration_window_message(), 'Registration is closed');
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found or v_course.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Course not found';
  end if;

  select * into v_existing
    from public.course_registrations
   where student_id = v_student and course_id = v_course.id and semester_id = v_semester.id;

  if found and v_existing.status in ('PENDING', 'APPROVED') then
    raise exception 'You have already registered for %', v_course.code;
  end if;

  if found and v_existing.status = 'DROPPED' then
    raise exception 'You dropped % this semester. Ask an administrator to re-open it.', v_course.code;
  end if;

  v_load := public.student_credit_load(v_student, v_semester.id);
  if v_load + v_course.credit_units > v_settings.max_credit_units then
    raise exception 'Adding % (% credit units) takes you above the maximum of % for a semester',
      v_course.code, v_course.credit_units, v_settings.max_credit_units
      using hint = 'Drop a course you no longer need, or ask an administrator to raise the limit.';
  end if;

  insert into public.course_registrations (
    tenant_id, student_id, course_id, semester_id, credit_units, status, requested_at
  ) values (
    public.auth_tenant_id(), v_student, v_course.id, v_semester.id, v_course.credit_units, 'PENDING', now()
  )
  on conflict on constraint course_registrations_student_course_semester_unique do update
    set status = 'PENDING', credit_units = excluded.credit_units,
        requested_at = now(), reviewed_at = null, reviewed_by_id = null, notes = null
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.drop_course_registration(p_registration_id uuid)
returns public.course_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student  uuid := auth.uid();
  v_row      public.course_registrations;
  v_settings public.academic_settings;
  v_load     integer;
begin
  select * into v_row from public.course_registrations where id = p_registration_id;
  if not found then
    raise exception 'Registration not found';
  end if;
  if v_row.student_id <> v_student and not public.is_admin() then
    raise exception 'You can only drop your own courses';
  end if;
  if v_row.status in ('REJECTED', 'DROPPED') then
    raise exception 'This registration is already %', lower(v_row.status);
  end if;

  if not public.is_admin() then
    if not public.registration_window_open() then
      raise exception '%', coalesce(public.registration_window_message(), 'Registration is closed');
    end if;
  end if;

  v_settings := public.academic_settings_row();
  v_load := public.student_credit_load(v_row.student_id, v_row.semester_id) - v_row.credit_units;
  if v_load < v_settings.min_credit_units then
    raise exception 'Dropping this course leaves you with % credit units, below the minimum of %',
      v_load, v_settings.min_credit_units
      using hint = format('A semester needs at least %s credit units.', v_settings.min_credit_units);
  end if;

  update public.course_registrations
     set status = 'DROPPED', reviewed_at = now(),
         reviewed_by_id = case when public.is_admin() then v_student else reviewed_by_id end
   where id = v_row.id
  returning * into v_row;

  -- Keep the enrolment in step so the grade book stops showing the course.
  update public.enrollments set status = 'DROPPED'
   where student_id = v_row.student_id and course_id = v_row.course_id;

  return v_row;
end;
$$;

create or replace function public.review_course_registration(
  p_registration_id uuid,
  p_approve         boolean,
  p_notes           text default null
)
returns public.course_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.course_registrations;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can approve or reject a registration'
      using hint = 'Ask a school administrator to review the registration.';
  end if;

  select * into v_row from public.course_registrations where id = p_registration_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Registration not found';
  end if;
  if v_row.status not in ('PENDING', 'APPROVED') then
    raise exception 'This registration has already been %', lower(v_row.status);
  end if;

  if p_approve then
    update public.course_registrations
       set status = 'APPROVED', reviewed_at = now(), reviewed_by_id = auth.uid(), notes = p_notes
     where id = v_row.id
    returning * into v_row;

    -- The approved registration becomes an enrolment; a student re-taking a
    -- course they dropped earlier reactivates the existing row.
    insert into public.enrollments (tenant_id, student_id, course_id, status, enrolled_at)
    values (v_row.tenant_id, v_row.student_id, v_row.course_id, 'ACTIVE', now())
    on conflict (student_id, course_id) do update
      set status = 'ACTIVE', enrolled_at = now();
  else
    update public.course_registrations
       set status = 'REJECTED', reviewed_at = now(), reviewed_by_id = auth.uid(), notes = p_notes
     where id = v_row.id
    returning * into v_row;

    update public.enrollments set status = 'REJECTED'
     where student_id = v_row.student_id and course_id = v_row.course_id
       and status = 'PENDING';
  end if;

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Guard: the table is writable through PostgREST as well as the RPCs, so a
-- student may never approve their own registration.
---------------------------------------------------------------------------
create or replace function public.guard_course_registration_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_tenant uuid;
begin
  select tenant_id into v_course_tenant from public.courses where id = new.course_id;
  if v_course_tenant is null or v_course_tenant <> new.tenant_id then
    raise exception 'Course does not belong to this school';
  end if;

  -- A null auth.uid() is the SQL-editor / service-role path used to seed and
  -- repair data; every authenticated caller is checked below.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Registration does not belong to this school';
  end if;

  if new.student_id is distinct from auth.uid() then
    raise exception 'Students may only register their own courses';
  end if;

  if new.status not in ('PENDING', 'DROPPED') then
    raise exception 'Only an administrator can approve or reject a registration';
  end if;

  if tg_op = 'UPDATE' and new.semester_id is distinct from old.semester_id then
    raise exception 'A registration cannot be moved to another semester';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_course_registration_write on public.course_registrations;
create trigger guard_course_registration_write
  before insert or update on public.course_registrations
  for each row execute function public.guard_course_registration_write();

---------------------------------------------------------------------------
-- updated_at, tenant default and audit trail for the new table.
---------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.course_registrations;
create trigger set_updated_at before update on public.course_registrations
  for each row execute function public.touch_updated_at();

drop trigger if exists audit_changes on public.course_registrations;
create trigger audit_changes after insert or update or delete on public.course_registrations
  for each row execute function public.write_audit_log();

alter table public.course_registrations
  alter column tenant_id set default public.auth_tenant_id();

---------------------------------------------------------------------------
-- Row Level Security
---------------------------------------------------------------------------
alter table public.course_registrations enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.course_registrations to authenticated;
grant insert, update on public.course_registrations to authenticated;
-- No delete: a registration is a record of what was requested, so it is
-- dropped or rejected rather than erased. Admins clear a term by rejecting.

drop policy if exists course_registrations_read on public.course_registrations;
create policy course_registrations_read on public.course_registrations
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or student_id = auth.uid() or public.teaches_course(course_id))
  );

drop policy if exists course_registrations_insert_self on public.course_registrations;
create policy course_registrations_insert_self on public.course_registrations
  for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and student_id = auth.uid()
    and status = 'PENDING'
  );

drop policy if exists course_registrations_insert_admin on public.course_registrations;
create policy course_registrations_insert_admin on public.course_registrations
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

-- Students drop their own; everything else (approve, reject) goes through the
-- admin-only RPCs and the guard trigger above.
drop policy if exists course_registrations_update on public.course_registrations;
create policy course_registrations_update on public.course_registrations
  for update to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or student_id = auth.uid())
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or (student_id = auth.uid() and status = 'DROPPED'))
  );
