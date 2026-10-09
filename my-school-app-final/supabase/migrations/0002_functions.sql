-- Functions, triggers and RPCs. This is the logic that previously lived in
-- backend/src/controllers and backend/src/middleware/authMiddleware.ts.

---------------------------------------------------------------------------
-- updated_at bookkeeping
---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
-- Every trigger body pins its own search_path instead of inheriting the
-- caller's, which is whatever the requesting role happened to set.
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'profiles', 'faculties', 'departments', 'class_sections', 'courses',
    'enrollments', 'timetable_slots', 'department_timetable_slots', 'grade_periods',
    'grade_entries', 'fee_structures', 'invoices', 'bulk_import_jobs', 'site_settings'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      t
    );
  end loop;
end;
$$;

---------------------------------------------------------------------------
-- Identity helpers used by RLS policies.
-- SECURITY DEFINER so that reading profiles from a policy on profiles does
-- not recurse into the very policy being evaluated.
---------------------------------------------------------------------------
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('SUPER_ADMIN', 'SCHOOL_ADMIN') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'SUPER_ADMIN' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Teachers may act on a course only when they are attached to it; this mirrors
-- assertTeachesCourse() in gradesController and the guards in academicsController.
create or replace function public.teaches_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.course_teachers ct
    where ct.course_id = p_course_id and ct.teacher_id = auth.uid()
  );
$$;

create or replace function public.owns_class_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_sections cs
    where cs.id = p_section_id and cs.homeroom_teacher_id = auth.uid()
  );
$$;

---------------------------------------------------------------------------
-- Profile bootstrap
---------------------------------------------------------------------------
-- Signup from the client puts firstName/lastName/role into user metadata; this
-- turns that into the row every other policy depends on.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'pinnacle-school' limit 1;
  if v_tenant is null then
    raise exception 'No default tenant configured';
  end if;

  -- The role is deliberately NOT read from raw_user_meta_data: anyone holding
  -- the anon key can pass arbitrary metadata to signUp(). Public sign-ups are
  -- students, and create_school_user() promotes the profile it provisions.
  insert into public.profiles (id, tenant_id, email, role, first_name, last_name, department_id)
  values (
    new.id,
    v_tenant,
    new.email,
    'STUDENT',
    coalesce(nullif(new.raw_user_meta_data ->> 'firstName', ''), 'New'),
    coalesce(nullif(new.raw_user_meta_data ->> 'lastName', ''), 'User'),
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Self-registration must never mint an admin. Only an existing admin may set a
-- privileged role, and only for the tenant they belong to.
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Two trusted paths reach here, both through a SECURITY DEFINER body that
  -- keeps the caller's JWT in request.jwt.claims:
  --   * GoTrue's own insert during sign-up, which carries no user claim at all;
  --   * create_school_user(), which an administrator calls, and whose new row
  --     deliberately has a different id.
  -- Everyone else is already stopped by the absence of an INSERT policy.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.id <> auth.uid() or new.role <> 'STUDENT' then
    raise exception 'New accounts may only register themselves as STUDENT';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_insert on public.profiles;
create trigger guard_profile_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();

---------------------------------------------------------------------------
-- Grades
---------------------------------------------------------------------------
create or replace function public.letter_from_score(p_score double precision)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_score >= 90 then 'A'
    when p_score >= 80 then 'B'
    when p_score >= 70 then 'C'
    when p_score >= 60 then 'D'
    else 'F'
  end;
$$;

create or replace function public.default_grade_letter()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Recompute whenever the score moves and the caller left the letter alone, so
  -- an edited score can never be displayed with the previous letter attached.
  if new.letter_grade is null or btrim(new.letter_grade) = ''
     or (tg_op = 'UPDATE'
         and new.score is distinct from old.score
         and new.letter_grade is not distinct from old.letter_grade) then
    new.letter_grade := public.letter_from_score(new.score);
  end if;
  return new;
end;
$$;

drop trigger if exists default_grade_letter on public.grade_entries;
create trigger default_grade_letter
  before insert or update on public.grade_entries
  for each row execute function public.default_grade_letter();

---------------------------------------------------------------------------
-- Invoices and payments
---------------------------------------------------------------------------
create or replace function public.generate_invoice_reference()
returns trigger
language plpgsql
-- gen_random_bytes() is a pgcrypto function, and pgcrypto lives in `extensions`.
set search_path = public, extensions
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'INV-' || upper(to_char(now(), 'YYMMDDHH24MISS')) || '-' ||
                     upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
  end if;
  return new;
end;
$$;

drop trigger if exists generate_invoice_reference on public.invoices;
create trigger generate_invoice_reference
  before insert on public.invoices
  for each row execute function public.generate_invoice_reference();

-- Keep paid_amount and status in step with the payment ledger, and refuse a
-- payment that would overdraw the invoice.
create or replace function public.apply_payment_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_paid    numeric(14, 2);
begin
  select * into v_invoice from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Invoice % not found', new.invoice_id;
  end if;

  v_paid := coalesce(v_invoice.paid_amount, 0) + new.amount;
  if v_paid > v_invoice.total_amount then
    raise exception 'Payment amount cannot exceed remaining invoice balance';
  end if;

  update public.invoices
     set paid_amount = v_paid,
         status = case when v_paid >= total_amount then 'PAID' else 'PARTIAL' end
   where id = new.invoice_id;

  return new;
end;
$$;

drop trigger if exists apply_payment_to_invoice on public.payments;
create trigger apply_payment_to_invoice
  after insert on public.payments
  for each row execute function public.apply_payment_to_invoice();

create or replace function public.recompute_invoice_from_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric(14, 2);
begin
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = old.invoice_id;
  update public.invoices
     set paid_amount = v_paid,
         status = case
           when v_paid >= total_amount then 'PAID'
           when v_paid > 0 then 'PARTIAL'
           else status
         end
   where id = old.invoice_id;
  return old;
end;
$$;

drop trigger if exists recompute_invoice_from_payments on public.payments;
create trigger recompute_invoice_from_payments
  after delete on public.payments
  for each row execute function public.recompute_invoice_from_payments();

---------------------------------------------------------------------------
-- Audit trail
---------------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_row     jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_payload := v_row;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, changed_data, summary)
  values (
    coalesce((v_row ->> 'tenant_id')::uuid, public.auth_tenant_id()),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', ''),
    v_payload #>> '{}',
    tg_table_name || ' ' || lower(tg_op)
  );
  return coalesce(new, old);
exception
  when others then
    return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'courses', 'enrollments', 'class_sections', 'attendance_records',
    'grade_periods', 'grade_entries', 'invoices', 'payments', 'fee_structures',
    'departments', 'faculties', 'site_settings'
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
-- Account provisioning (replaces AdminController.createStudent / createTeacher
-- and the bulk import endpoint). The anon key cannot call the GoTrue admin API
-- from the browser, so admins create accounts through this definer function.
---------------------------------------------------------------------------
create or replace function public.create_school_user(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_role       text,
  p_password   text default 'ChangeMe123!'
)
returns uuid
language plpgsql
security definer
-- `extensions` because Supabase installs pgcrypto there, and crypt()/gen_salt()
-- are invisible to a body pinned to public alone.
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_email   text := lower(btrim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Only school admins can create accounts';
  end if;
  if p_role not in ('TEACHER', 'STUDENT', 'NON_ACADEMIC_STAFF') then
    raise exception 'Provisioned accounts must be TEACHER, STUDENT or NON_ACADEMIC_STAFF';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'A user with that email already exists' using errcode = '23505';
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone, phone_change, phone_change_token,
    is_sso_user, deleted_at
  ) values (
    v_user_id, 'authenticated', 'authenticated', v_email, crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('firstName', p_first_name, 'lastName', p_last_name, 'role', p_role),
    now(), now(), '', '', '', '', '', null, '', '', false, null
  );

  -- auth.identities has no `status` column on hosted GoTrue, and its email
  -- column is a STORED generated column over identity_data->>'email', so
  -- neither may appear in the column list.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id, v_user_id::text, 'email',
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    now(), now(), now()
  );

  update public.profiles
     set role = p_role, tenant_id = public.auth_tenant_id()
   where id = v_user_id;

  return v_user_id;
end;
$$;

-- Supabase's default privileges hand EXECUTE to anon directly, so revoking from
-- `public` alone still leaves the RPC callable by the anon key.
revoke execute on function public.create_school_user(text, text, text, text, text) from public, anon;
grant execute on function public.create_school_user(text, text, text, text, text) to authenticated;

---------------------------------------------------------------------------
-- Notifications
---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_notification_id uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid()
    from public.notifications n
   where n.tenant_id = public.auth_tenant_id()
     and (p_notification_id is null or n.id = p_notification_id)
  on conflict (notification_id, user_id) do nothing;
$$;

---------------------------------------------------------------------------
-- Analytics
-- The old controllers grouped by the raw timestamp column, which produced one
-- bucket per row and made the dashboard charts meaningless. These aggregate on
-- a real period instead.
---------------------------------------------------------------------------
create or replace function public.enrollment_analytics()
returns table (month text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
         count(*) as count
    from public.enrollments
   where tenant_id = public.auth_tenant_id()
   group by 1
   order by 1;
$$;

create or replace function public.fee_collection_analytics()
returns table (month text, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(date_trunc('month', p.paid_at), 'YYYY-MM') as month,
         coalesce(sum(p.amount), 0) as total
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
   where i.tenant_id = public.auth_tenant_id()
   group by 1
   order by 1;
$$;

create or replace function public.attendance_analytics()
returns table (status text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.status, count(*) as count
    from public.attendance_records a
   where a.tenant_id = public.auth_tenant_id()
   group by 1
   order by 1;
$$;

create or replace function public.dashboard_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
  declare
    v_average double precision;
  begin
    select avg(score) into v_average
      from public.grade_entries
     where tenant_id = public.auth_tenant_id();

    return jsonb_build_object(
      'totalStudents', (select count(*) from public.profiles where tenant_id = public.auth_tenant_id() and role = 'STUDENT'),
      'totalTeachers', (select count(*) from public.profiles where tenant_id = public.auth_tenant_id() and role = 'TEACHER'),
      'averageScore', round(v_average),
      'averageLetter', case when v_average is null then null else public.letter_from_score(v_average) end
    );
  end;
$$;

---------------------------------------------------------------------------
-- Tenant scoping defaults
-- With these in place the client never sends tenant_id, so a mistyped or
-- forged value cannot leak a row into another school.
---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.table_name::text as tbl
      from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'tenant_id'
  loop
    execute format('alter table public.%I alter column tenant_id set default public.auth_tenant_id()', t.tbl);
  end loop;
end;
$$;
