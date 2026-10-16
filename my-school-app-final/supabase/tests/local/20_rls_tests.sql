-- ---------------------------------------------------------------------------
-- Persona assertions against the migrated schema.
--
-- Each check re-runs the session as a Supabase role (anon / authenticated) with
-- a forged JWT claim set, exactly the way PostgREST does, so Row Level Security
-- and the guard triggers are exercised rather than trusted.
--
-- Print `select * from testhelp.failures;` after a run, or look for FAILED lines.
-- ---------------------------------------------------------------------------

create schema if not exists testhelp;

create table if not exists testhelp.results (
  label  text primary key,
  passed boolean not null,
  detail text
);

-- The helpers run while the session is switched to anon / authenticated, so the
-- persona roles need to reach testhelp on the way back out.
grant usage on schema testhelp to anon, authenticated;
grant select, insert, update on testhelp.results to anon, authenticated;
grant execute on all functions in schema testhelp to anon, authenticated;
alter default privileges in schema testhelp grant execute on functions to anon, authenticated;

create or replace function testhelp.claims(p_sub uuid)
returns text language sql immutable as $$
  select case
    when p_sub is null then '{"role":"anon"}'
    else json_build_object('sub', p_sub::text, 'role', 'authenticated', 'aud', 'authenticated')::text
  end
$$;

-- SECURITY INVOKER is essential: a definer body would run as its owner and
-- silently bypass RLS, making every check below vacuous.
create or replace function testhelp.switch(p_sub uuid)
returns void language plpgsql security invoker as $$
begin
  perform set_config('request.jwt.claims', testhelp.claims(p_sub), false);
  execute 'set role ' || (case when p_sub is null then 'anon' else 'authenticated' end);
end
$$;

create or replace function testhelp.back()
returns void language plpgsql security invoker as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end
$$;

create or replace function testhelp.record(p_label text, p_passed boolean, p_detail text)
returns void language sql security invoker as $$
  insert into testhelp.results (label, passed, detail)
  values (p_label, p_passed, p_detail)
  on conflict (label) do update set passed = excluded.passed, detail = excluded.detail
$$;

-- The persona may read exactly `expected` rows.
create or replace function testhelp.sees(p_label text, p_sub uuid, p_query text, p_expected bigint)
returns void language plpgsql security invoker as $$
declare v bigint;
begin
  perform testhelp.switch(p_sub);
  begin
    execute p_query into v;
  exception when others then
    v := null;
  end;
  perform testhelp.back();
  perform testhelp.record(p_label, v = p_expected, 'got ' || coalesce(v::text, 'permission error') || ', want ' || p_expected);
end
$$;

-- The statement must be blocked - by RLS, by a guard trigger or by the function.
create or replace function testhelp.blocked(p_label text, p_sub uuid, p_stmt text)
returns void language plpgsql security invoker as $$
declare v_ok boolean := false;
begin
  perform testhelp.switch(p_sub);
  begin
    execute p_stmt;
    v_ok := true;
  exception when others then
    null;
  end;
  perform testhelp.back();
  perform testhelp.record(p_label, not v_ok, case when v_ok then 'statement succeeded' else 'rejected as expected' end);
end
$$;

-- The statement must succeed and be visible afterwards.
create or replace function testhelp.allows(p_label text, p_sub uuid, p_stmt text, p_verify text, p_expected text)
returns void language plpgsql security invoker as $$
declare v_actual text;
begin
  perform testhelp.switch(p_sub);
  begin
    execute p_stmt;
  exception when others then
    perform testhelp.back();
    perform testhelp.record(p_label, false, 'raised ' || SQLERRM);
    return;
  end;
  perform testhelp.back();
  begin
    execute p_verify into v_actual;
  exception when others then
    perform testhelp.record(p_label, false, 'verify raised ' || SQLERRM);
    return;
  end;
  perform testhelp.record(p_label, coalesce(v_actual = p_expected, false), 'verify=' || coalesce(v_actual, 'null') || ', want ' || p_expected);
end
$$;

-- Same, but as the unauthenticated privileged path: SQL editor, service_role or
-- GoTrue's own writes. RLS does not apply here, only the guard triggers.
create or replace function testhelp.direct(p_label text, p_stmt text, p_verify text, p_expected text)
returns void language plpgsql security invoker as $$
begin
  perform set_config('request.jwt.claims', '', false);
  execute p_stmt;
  perform testhelp.allows(p_label, null, 'select 1', p_verify, p_expected);
end
$$;

-- A claim-dependent expression must be evaluated as the persona, not after
-- the role is reset, or auth.uid() inside the function would read the wrong JWT.
create or replace function testhelp.truth(p_label text, p_sub uuid, p_query text)
returns void language plpgsql security invoker as $$
declare v boolean;
begin
  perform testhelp.switch(p_sub);
  begin
    execute p_query into v;
  exception when others then
    v := null;
  end;
  perform testhelp.back();
  perform testhelp.record(p_label, v is true, coalesce(v::text, 'permission error or non-boolean'));
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Provisioning: create_school_user()
-- ---------------------------------------------------------------------------
-- Wrapped in one block so psql prints no per-assertion result rows.
do $body$
begin
  perform testhelp.allows(
  'admin can provision a student',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.create_school_user('Erin','Ext',' erin@example.com ','STUDENT')$q$,
  $q$select role || '/' || (tenant_id = (select id from public.tenants where slug = 'pinnacle-school'))::text
        || '/' || (select count(*) from public.tenants t where t.id = profiles.tenant_id)::text
     from public.profiles where email = 'erin@example.com'$q$,
  'STUDENT/true/1');

  perform testhelp.allows(
  'provisioned identity carries a generated email column',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.create_school_user('Frank','Ftn','frank@example.com','TEACHER','AnotherPass!1')$q$,
  $q$select i.email || '/' || (u.email_confirmed_at is not null)::text
     from auth.identities i join auth.users u on u.id = i.user_id
    where u.email = 'frank@example.com'$q$,
  'frank@example.com/true');

  perform testhelp.allows(
  'provisioned password is bcrypt-hashed, not plaintext',
  null,
  $q$select 1$q$,
  $q$select (encrypted_password like '$2a$%' or encrypted_password like '$2b$%')
           and encrypted_password <> 'AnotherPass!1'
     from auth.users where email = 'frank@example.com'$q$,
  'true');

  -- Hosted GoTrue filters credential lookup by instance, so a NULL instance_id
  -- signs in as invalid_credentials despite a hash that verifies in Postgres.
  perform testhelp.allows(
  'provisioned user is attached to the default auth instance',
  null,
  $q$select 1$q$,
  $q$select coalesce(instance_id = '00000000-0000-0000-0000-000000000000'::uuid, false)
     from auth.users where email = 'frank@example.com'$q$,
  'true');

  perform testhelp.blocked(
  'a student cannot provision accounts',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.create_school_user('Mallory','X','mallory@example.com','SUPER_ADMIN')$q$);

  perform testhelp.blocked(
  'an anon request cannot provision accounts',
  null,
  $q$select public.create_school_user('Mallory','X','mallory2@example.com','STUDENT')$q$);

  perform testhelp.blocked(
  'provisioning cannot mint an admin role',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.create_school_user('Mallory','X','mallory3@example.com','SUPER_ADMIN')$q$);

  perform testhelp.blocked(
  'provisioning rejects a duplicate email',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.create_school_user('Erin','Again','erin@example.com','STUDENT')$q$);

  perform testhelp.allows(
  'a second school admin provisions into its own tenant',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select public.create_school_user('Grace','Riv','grace@riverside.test','STUDENT')$q$,
  $q$select p.tenant_id = (select id from public.tenants where slug = 'riverside-college')
     from public.profiles p where p.email = 'grace@riverside.test'$q$,
  'true');

-- ---------------------------------------------------------------------------
-- 2. The documented first-admin bootstrap must actually stick
-- ---------------------------------------------------------------------------
  perform testhelp.direct(
  'SQL-editor promotion to SUPER_ADMIN is not reverted',
  $q$update public.profiles set role = 'SUPER_ADMIN' where email = 'erin@example.com'$q$,
  $q$select role from public.profiles where email = 'erin@example.com'$q$,
  'SUPER_ADMIN');

  -- RLS denies by filtering, so a blocked UPDATE reports success with zero rows
  -- changed; the assertion is that the stored value never moved.
  perform testhelp.allows(
  'a student promoting themselves leaves the role unchanged',
  '00000000-0000-0000-0000-0000000000c0',
  $q$update public.profiles set role = 'SUPER_ADMIN' where id = '00000000-0000-0000-0000-0000000000c0'$q$,
  $q$select role from public.profiles where id = '00000000-0000-0000-0000-0000000000c0'$q$,
  'STUDENT');

  perform testhelp.allows(
  'a student editing their own name keeps it',
  '00000000-0000-0000-0000-0000000000c0',
  $q$update public.profiles set first_name = 'Robert' where id = '00000000-0000-0000-0000-0000000000c0'$q$,
  $q$select first_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c0'$q$,
  'Robert');

  perform testhelp.direct(
  'a self-signup insert with attacker-supplied metadata stays a STUDENT',
  $q$insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
     values ('00000000-0000-0000-0000-0000000000ee','authenticated','authenticated','evil@example.com','x',now(),
             '{"firstName":"Evil","lastName":"User","role":"SUPER_ADMIN"}')$q$,
  $q$select role from public.profiles where email = 'evil@example.com'$q$,
  'STUDENT');

  perform testhelp.blocked(
  'a user cannot insert a profile for somebody else',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into public.profiles (id, email, first_name, last_name, role)
     values ('00000000-0000-0000-0000-0000000000ff','plant@example.com','P','L','SCHOOL_ADMIN')$q$);

-- ---------------------------------------------------------------------------
-- 3. Tenant isolation on reads
-- ---------------------------------------------------------------------------
  perform testhelp.sees('a student reads only own-tenant profiles',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.profiles$q$, 6);

  perform testhelp.sees('the other school reads only its own profiles',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select count(*) from public.profiles$q$, 2);

  perform testhelp.sees('anon reads no profiles', null,
  $q$select count(*) from public.profiles$q$, 0);

  perform testhelp.sees('anon can still see the public tenant row', null,
  $q$select count(*) from public.tenants$q$, 2);

  perform testhelp.sees('a student cannot see another school courses',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select count(*) from public.courses$q$, 0);

-- ---------------------------------------------------------------------------
-- 4. Writes the admin UI performs
-- ---------------------------------------------------------------------------
  perform testhelp.allows('an admin inserts a course the way the client does',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.courses (title, code, description, level)
     values ('Compilers','CS401','Backend builds','400')$q$,
  $q$select tenant_id = (select id from public.tenants where slug = 'pinnacle-school')
     from public.courses where code = 'CS401'$q$,
  'true');

  perform testhelp.allows('an admin inserts a class section without sending tenant_id',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.class_sections (name, grade, homeroom_teacher_id)
     values ('Section B','Year 2','00000000-0000-0000-0000-0000000000b0')$q$,
  $q$select tenant_id is not null from public.class_sections where name = 'Section B'$q$,
  'true');

  perform testhelp.blocked('a teacher cannot create a class section',
  '00000000-0000-0000-0000-0000000000b0',
  $q$insert into public.class_sections (name, grade) values ('Section C','Year 3')$q$);

  perform testhelp.allows('an admin adds a student of their own school to a section',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.class_section_students (section_id, student_id)
     values ('00000000-0000-0000-0000-00000000002a','00000000-0000-0000-0000-0000000000ee')$q$,
  $q$select count(*)::text from public.class_section_students where section_id = '00000000-0000-0000-0000-00000000002a'$q$,
  '2');

  perform testhelp.blocked('an admin cannot seat a student from another school',
  '00000000-0000-0000-0000-0000000000d0',
  $q$insert into public.class_section_students (section_id, student_id)
     values ('00000000-0000-0000-0000-00000000002a','00000000-0000-0000-0000-0000000000c0')$q$);

  perform testhelp.blocked('a student cannot seat themselves in a class',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into public.class_section_students (section_id, student_id)
     values ('00000000-0000-0000-0000-00000000002a','00000000-0000-0000-0000-0000000000c0')$q$);

-- ---------------------------------------------------------------------------
-- 5. Grades
-- ---------------------------------------------------------------------------
  perform testhelp.allows('a missing letter grade is derived from the score',
  '00000000-0000-0000-0000-0000000000b0',
  $q$insert into public.grade_entries (enrollment_id, grade_period_id, score)
     values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000041',95)$q$,
  $q$select letter_grade from public.grade_entries where score = 95$q$, 'A');

  -- 0006 replaces the 90/80/70/60 scale: 40 is now the bottom of the E band.
  perform testhelp.allows('editing a score refreshes an untouched letter grade',
  '00000000-0000-0000-0000-0000000000b0',
  $q$update public.grade_entries set score = 40 where score = 95$q$,
  $q$select letter_grade from public.grade_entries where score = 40$q$, 'E');

  perform testhelp.allows('an explicit letter grade survives a score change',
  '00000000-0000-0000-0000-0000000000b0',
  $q$update public.grade_entries set score = 10, letter_grade = 'MANUAL' where score = 40$q$,
  $q$select letter_grade from public.grade_entries where score = 10$q$, 'MANUAL');

  perform testhelp.blocked('a student cannot write grades',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into public.grade_entries (enrollment_id, grade_period_id, score)
     values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000041',100)$q$);

  perform testhelp.blocked('a teacher cannot grade a course they do not teach',
  '00000000-0000-0000-0000-0000000000b0',
  $q$insert into public.grade_entries (enrollment_id, grade_period_id, score)
     values ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000042',100)$q$);

-- ---------------------------------------------------------------------------
-- 6. Attendance
-- ---------------------------------------------------------------------------
  perform testhelp.allows('a homeroom teacher marks attendance for her class',
  '00000000-0000-0000-0000-0000000000b0',
  $q$insert into public.attendance_records (student_id, class_section_id, status, recorded_at)
     values ('00000000-0000-0000-0000-0000000000c0','00000000-0000-0000-0000-00000000002a','PRESENT', now())$q$,
  $q$select status from public.attendance_records
     where class_section_id = '00000000-0000-0000-0000-00000000002a'$q$, 'PRESENT');

  perform testhelp.blocked('a teacher cannot mark attendance for a student outside the class',
  '00000000-0000-0000-0000-0000000000b0',
  $q$insert into public.attendance_records (student_id, class_section_id, status, recorded_at)
     values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000002a','PRESENT', now())$q$);

  perform testhelp.blocked('a student cannot record their own attendance',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into public.attendance_records (student_id, class_section_id, status, recorded_at)
     values ('00000000-0000-0000-0000-0000000000c0','00000000-0000-0000-0000-00000000002a','PRESENT', now())$q$);

  perform testhelp.sees('a student reads only their own attendance',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.attendance_records$q$, 1);

-- ---------------------------------------------------------------------------
-- 7. Fees
-- ---------------------------------------------------------------------------
  perform testhelp.allows('issuing an invoice derives a reference and totals',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.invoices (student_id, status, due_date, total_amount, paid_amount)
     values ('00000000-0000-0000-0000-0000000000c0','ISSUED', now() + interval '7 days', 500, 0)
     returning id$q$,
  $q$select (reference is not null) and tenant_id is not null from public.invoices where total_amount = 500$q$,
  'true');

  perform testhelp.allows('a payment rolls up into the invoice status',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.payments (invoice_id, student_id, amount, method, transaction_id)
     select id, student_id, 500, 'CASH', 'TX-1' from public.invoices where total_amount = 500$q$,
  $q$select status || '/' || paid_amount::text from public.invoices where total_amount = 500$q$,
  'PAID/500.00');

  perform testhelp.blocked('a student cannot record a payment',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into public.payments (invoice_id, student_id, amount, method)
     select id, student_id, 1, 'CASH' from public.invoices where total_amount = 500$q$);

-- ---------------------------------------------------------------------------
-- 8. Branding, notifications, analytics
-- ---------------------------------------------------------------------------
  perform testhelp.sees('everyone can read public site settings', null,
  $q$select count(*) from public.site_settings$q$, 2);

  perform testhelp.allows('an admin edits branding',
  '00000000-0000-0000-0000-0000000000a1',
  $q$update public.site_settings set logo_path = 'branding/logo.png',
        welcome_message = 'Hello'
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$,
  $q$select welcome_message from public.site_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$,
  'Hello');

  perform testhelp.allows('a student editing branding changes nothing',
  '00000000-0000-0000-0000-0000000000c0',
  $q$update public.site_settings set primary_color = '#000000'$q$,
  $q$select primary_color from public.site_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$,
  '#1976D2');

  perform testhelp.allows('an admin uploads branding to the public bucket',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into storage.objects (bucket_id, name, owner)
     values ('branding','hero.png','00000000-0000-0000-0000-0000000000a1')$q$,
  $q$select bucket_id from storage.objects where name = 'hero.png'$q$, 'branding');

  perform testhelp.blocked('a student cannot upload branding',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into storage.objects (bucket_id, name) values ('branding','sneaky.png')$q$);

  perform testhelp.sees('anon may read stored objects', null,
  $q$select count(*) from storage.objects$q$, 2);

  perform testhelp.allows('marking a notification read is per-user',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.mark_notifications_read(null)$q$,
  $q$select user_id = '00000000-0000-0000-0000-0000000000c0'
     from public.notification_reads where notification_id = '00000000-0000-0000-0000-00000000009a'$q$,
  'true');

  perform testhelp.sees('a student reads only their own read receipts',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select count(*) from public.notification_reads$q$, 0);

  perform testhelp.truth('dashboard totals count only the caller''s school',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select (public.dashboard_totals() ->> 'totalStudents')::int
             = (select count(*) from public.profiles where role = 'STUDENT')$q$);

  perform testhelp.truth('analytics rpcs return rows to an admin',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select (select count(*) from public.enrollment_analytics()) > 0
        and (select count(*) from public.attendance_analytics()) >= 0$q$);

  -- These three are SECURITY DEFINER, so RLS on the underlying tables does not
  -- protect them; the tenant filter inside each body has to do it instead.
  perform testhelp.truth('security definer analytics stay inside the caller''s school',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select (select count(*) from public.enrollment_analytics()) = 0
        and (select count(*) from public.fee_collection_analytics()) = 0$q$);

  perform testhelp.truth('a student''s dashboard totals are their own school',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select (public.dashboard_totals() ->> 'totalStudents')::int
             = (select count(*) from public.profiles where role = 'STUDENT')$q$);

  perform testhelp.sees('the audit trail is admin-only',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.audit_logs$q$, 0);

-- ---------------------------------------------------------------------------
-- 9. Academic calendar (0006)
-- ---------------------------------------------------------------------------
  perform testhelp.sees('a student reads their school''s academic sessions',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.academic_sessions$q$, 1);

  perform testhelp.sees('another school reads none of those sessions',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select count(*) from public.academic_sessions$q$, 0);

  perform testhelp.sees('anon reads no academic sessions',
  null,
  $q$select count(*) from public.academic_sessions$q$, 0);

  perform testhelp.sees('a student reads the published grade scale',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.grade_scale$q$, 6);

  -- seed_tenant_academics() gives a school its own scale the moment it exists,
  -- so a brand-new tenant is never without grade points.
  perform testhelp.sees('a school created after the migration is seeded too',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select count(*) from public.grade_scale$q$, 6);

  perform testhelp.truth('the published scale drives letters and points',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.letter_from_score(70) = 'A'
        and public.letter_from_score(45) = 'D'
        and public.letter_from_score(39) = 'F'
        and public.grade_points('C') = 3.00::numeric$q$);

  perform testhelp.blocked('a student cannot create an academic session',
  '00000000-0000-0000-0000-0000000000c0',
  $q$insert into public.academic_sessions (name, start_date, end_date)
     values ('1999/2000', current_date, current_date + 10)$q$);

  perform testhelp.allows('an administrator creates the next academic session',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.academic_sessions (id, name, start_date, end_date)
     values ('00000000-0000-0000-0000-0000000000a8', '2026/2027',
             date '2026-09-01', date '2027-07-31')$q$,
  $q$select count(*)::text from public.academic_sessions$q$, '2');

  -- One active session per tenant is an index, not a user interface convention.
  perform testhelp.blocked('a second active session is refused',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.academic_sessions (name, start_date, end_date, is_active)
     values ('2027/2028', date '2027-09-01', date '2028-07-31', true)$q$);

  perform testhelp.blocked('a teacher cannot move the active session',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.set_active_academic_session('00000000-0000-0000-0000-0000000000a8')$q$);

  perform testhelp.allows('activating a session clears the stale semester',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.set_active_academic_session('00000000-0000-0000-0000-0000000000a8')$q$,
  $q$select (select count(*) from public.academic_sessions where is_active)::text
        || '/' || (select count(*) from public.semesters where is_active)::text$q$, '1/0');

  perform testhelp.blocked('a semester cannot activate while its session is not current',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.set_active_semester('00000000-0000-0000-0000-0000000000a7')$q$);

  perform testhelp.allows('the fixture calendar is restored for the rest of the suite',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.set_active_academic_session('00000000-0000-0000-0000-0000000000a6')$q$,
  $q$select name from public.academic_sessions where is_active$q$, '2025/2026');

  perform testhelp.allows('an administrator activates a semester',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.set_active_semester('00000000-0000-0000-0000-0000000000a7')$q$,
  $q$select name from public.semesters where is_active$q$, 'First Semester');

  perform testhelp.blocked('a semester outside its own session is refused',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.semesters (academic_session_id, name, number, start_date, end_date)
     values ('00000000-0000-0000-0000-0000000000a6', 'Impossible', 2,
             date '2020-01-01', date '2020-06-30')$q$);

  perform testhelp.allows('a student editing the credit ceiling changes nothing',
  '00000000-0000-0000-0000-0000000000c0',
  $q$update public.academic_settings set max_credit_units = 999$q$,
  $q$select max_credit_units::text from public.academic_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$, '12');

-- ---------------------------------------------------------------------------
-- 10. Course registration (0007)
-- ---------------------------------------------------------------------------
  perform testhelp.truth('registration is open inside the window',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.registration_window_open()$q$);

  perform testhelp.sees('a student starts with no registrations',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.course_registrations$q$, 0);

  perform testhelp.allows('a student registers a course for the active semester',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.register_for_course('00000000-0000-0000-0000-0000000000c1')$q$,
  $q$select status || '/' || credit_units::text from public.course_registrations
     where course_id = '00000000-0000-0000-0000-0000000000c1'$q$, 'PENDING/6');

  perform testhelp.blocked('the same course cannot be registered twice',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.register_for_course('00000000-0000-0000-0000-0000000000c1')$q$);

  perform testhelp.sees('the course teacher reads its registrations',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select count(*) from public.course_registrations$q$, 1);

  perform testhelp.sees('another school reads no registrations',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select count(*) from public.course_registrations$q$, 0);

  perform testhelp.blocked('a student cannot approve their own registration',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.review_course_registration(
        (select id from public.course_registrations where student_id = auth.uid()),
        true, null)$q$);

  perform testhelp.blocked('writing APPROVED straight to the table is refused',
  '00000000-0000-0000-0000-0000000000c0',
  $q$update public.course_registrations set status = 'APPROVED'
     where student_id = auth.uid()$q$);

  perform testhelp.blocked('a teacher cannot approve a registration',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.review_course_registration(
        (select id from public.course_registrations limit 1), true, null)$q$);

  perform testhelp.allows('an approving administrator creates the enrolment',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.review_course_registration(
        (select id from public.course_registrations limit 1), true,
        'Approved for the whole cohort')$q$,
  $q$select (select status from public.course_registrations)
        || '/' || (select status from public.enrollments
                    where student_id = '00000000-0000-0000-0000-0000000000c0'
                      and course_id  = '00000000-0000-0000-0000-0000000000c1')$q$,
  'APPROVED/ACTIVE');

  perform testhelp.allows('an administrator lowers the credit ceiling',
  '00000000-0000-0000-0000-0000000000a1',
  $q$update public.academic_settings set max_credit_units = 6$q$,
  $q$select max_credit_units::text from public.academic_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$, '6');

  perform testhelp.blocked('a student cannot register past the ceiling',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.register_for_course('00000000-0000-0000-0000-0000000000c2')$q$);

  perform testhelp.blocked('dropping below the minimum credit load is refused',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.drop_course_registration(
        (select id from public.course_registrations where student_id = auth.uid()))$q$);

  perform testhelp.allows('the ceiling is raised back for the next check',
  '00000000-0000-0000-0000-0000000000a1',
  $q$update public.academic_settings set max_credit_units = 12$q$,
  $q$select max_credit_units::text from public.academic_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$, '12');

  perform testhelp.allows('an administrator closes the registration window',
  '00000000-0000-0000-0000-0000000000a1',
  $q$update public.academic_settings
     set registration_closes_at = now() - interval '1 hour'
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$,
  $q$select (registration_closes_at < now())::text from public.academic_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$, 'true');

  -- The RPC is what the pages call, so it has to agree with the stored window.
  perform testhelp.truth('the closed window fails the open check',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.registration_window_open() = false$q$);

  perform testhelp.blocked('registration is refused once the window has closed',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.register_for_course('00000000-0000-0000-0000-0000000000c2')$q$);

  perform testhelp.truth('the closed window tells the student when it ended',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select coalesce(public.registration_window_message(), '')
             like 'Registration closed %'$q$);

  perform testhelp.allows('the window is reopened for the rest of the suite',
  '00000000-0000-0000-0000-0000000000a1',
  $q$update public.academic_settings
     set registration_closes_at = now() + interval '60 days'
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$,
  $q$select (registration_closes_at > now())::text from public.academic_settings
     where tenant_id = (select id from public.tenants where slug = 'pinnacle-school')$q$, 'true');

  perform testhelp.truth('the reopened window passes the open check',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.registration_window_open()$q$);

  perform testhelp.allows('a student registers a second course within the ceiling',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.register_for_course('00000000-0000-0000-0000-0000000000c2')$q$,
  $q$select public.student_credit_load('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000a7')::text$q$,
  '12');

  perform testhelp.blocked('a school with no active semester cannot register',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select public.register_for_course('00000000-0000-0000-0000-0000000000c1')$q$);

-- ---------------------------------------------------------------------------
-- 11. Result workflow, GPA and CGPA (0008)
-- ---------------------------------------------------------------------------
  -- Section 5 left a hand-written letter in Bob's CS201 book; give it a score
  -- the scale recognises, so the aggregates have something to weigh.
  perform testhelp.allows('a teacher corrects a draft grade',
  '00000000-0000-0000-0000-0000000000b0',
  $q$update public.grade_entries set score = 75, letter_grade = 'A'
     where enrollment_id = '00000000-0000-0000-0000-000000000031'
       and grade_period_id = '00000000-0000-0000-0000-000000000041'$q$,
  $q$select letter_grade from public.grade_entries where score = 75$q$, 'A');

  perform testhelp.allows('an administrator grades the course with no teacher',
  '00000000-0000-0000-0000-0000000000a1',
  $q$insert into public.grade_entries (enrollment_id, grade_period_id, score, letter_grade)
     values ('00000000-0000-0000-0000-000000000032',
             '00000000-0000-0000-0000-000000000042', 65, 'B')$q$,
  $q$select count(*)::text from public.grade_entries$q$, '2');

  perform testhelp.sees('a student sees no results before publication',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.grade_entries$q$, 0);

  perform testhelp.sees('the teacher still sees the book she has to submit',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select count(*) from public.grade_entries$q$, 1);

  perform testhelp.blocked('a teacher cannot publish her own results',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.publish_grade_period('00000000-0000-0000-0000-000000000041')$q$);

  perform testhelp.blocked('an administrator cannot publish an unapproved book',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.publish_grade_period('00000000-0000-0000-0000-000000000041')$q$);

  perform testhelp.allows('a teacher submits the grade book',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.submit_grade_period('00000000-0000-0000-0000-000000000041')$q$,
  $q$select status from public.grade_entries
     where grade_period_id = '00000000-0000-0000-0000-000000000041'$q$, 'SUBMITTED');

  perform testhelp.blocked('an empty book cannot be submitted twice',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.submit_grade_period('00000000-0000-0000-0000-000000000041')$q$);

  perform testhelp.blocked('a teacher cannot edit a submitted grade',
  '00000000-0000-0000-0000-0000000000b0',
  $q$update public.grade_entries set score = 99
     where grade_period_id = '00000000-0000-0000-0000-000000000041'$q$);

  perform testhelp.blocked('a teacher cannot approve a book through the RPC',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.review_grade_period('00000000-0000-0000-0000-000000000041', true)$q$);

  perform testhelp.allows('an administrator approves the book',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.review_grade_period('00000000-0000-0000-0000-000000000041', true)$q$,
  $q$select status from public.grade_entries
     where grade_period_id = '00000000-0000-0000-0000-000000000041'$q$, 'APPROVED');

  perform testhelp.allows('an administrator publishes it to the students',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.publish_grade_period('00000000-0000-0000-0000-000000000041')$q$,
  $q$select status from public.grade_entries
     where grade_period_id = '00000000-0000-0000-0000-000000000041'$q$, 'PUBLISHED');

  perform testhelp.sees('the student reads exactly the published result',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.grade_entries$q$, 1);

  perform testhelp.blocked('a teacher cannot reopen a published book',
  '00000000-0000-0000-0000-0000000000b0',
  $q$update public.grade_entries set status = 'DRAFT'
     where grade_period_id = '00000000-0000-0000-0000-000000000041'$q$);

  perform testhelp.allows('a student marking results published changes nothing',
  '00000000-0000-0000-0000-0000000000c0',
  $q$update public.grade_entries set status = 'PUBLISHED'$q$,
  $q$select count(*)::text from public.grade_entries where status = 'PUBLISHED'$q$, '1');

  perform testhelp.truth('the semester GPA weighs the published credits',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.semester_gpa(auth.uid(), '00000000-0000-0000-0000-0000000000a7')
             = 5.00::numeric$q$);

  -- These aggregates are SECURITY DEFINER, so the check inside each one is the
  -- only thing keeping another learner's figures out of reach.
  perform testhelp.truth('another student''s GPA comes back empty',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.semester_gpa(
        (select id from public.profiles where email = 'erin@example.com'),
        '00000000-0000-0000-0000-0000000000a7') is null$q$);

  perform testhelp.allows('the second book moves through the workflow',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.submit_grade_period('00000000-0000-0000-0000-000000000042'),
        public.review_grade_period('00000000-0000-0000-0000-000000000042', true),
        public.publish_grade_period('00000000-0000-0000-0000-000000000042')$q$,
  $q$select count(*)::text from public.grade_entries where status = 'PUBLISHED'$q$, '2');

  perform testhelp.truth('the CGPA is the credit-weighted average',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.student_cgpa(auth.uid()) = 4.50::numeric$q$);

  perform testhelp.truth('the class of degree follows the CGPA',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.class_of_degree(public.student_cgpa(auth.uid())) = 'First Class Honours'$q$);

  perform testhelp.truth('the result slip carries every published course',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select (public.student_results(auth.uid(),
            '00000000-0000-0000-0000-0000000000a7') ->> 'gpa')::numeric = 4.50::numeric
        and jsonb_array_length(public.student_results(auth.uid(),
            '00000000-0000-0000-0000-0000000000a7') -> 'courses') = 2$q$);

  perform testhelp.truth('the transcript reports the CGPA and its semesters',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select (public.student_transcript(auth.uid()) ->> 'cgpa')::numeric = 4.50::numeric
        and jsonb_array_length(public.student_transcript(auth.uid()) -> 'semesters') = 1$q$);

  perform testhelp.blocked('a student cannot read another student''s transcript',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select public.student_transcript(
        (select id from public.profiles where email = 'erin@example.com'))$q$);

  perform testhelp.blocked('another school''s administrator cannot read it either',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select public.student_transcript('00000000-0000-0000-0000-0000000000c0')$q$);

  perform testhelp.blocked('a teacher cannot reopen a published book through the RPC',
  '00000000-0000-0000-0000-0000000000b0',
  $q$select public.reopen_grade_period('00000000-0000-0000-0000-000000000041')$q$);

  perform testhelp.blocked('another school''s administrator cannot reopen it',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select public.reopen_grade_period('00000000-0000-0000-0000-000000000041')$q$);

  perform testhelp.allows('an administrator pulls a published book back to draft',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.reopen_grade_period('00000000-0000-0000-0000-000000000041')$q$,
  $q$select status || ' ' || (submitted_at is null and approved_at is null
                                        and published_at is null)::text
     from public.grade_entries
    where grade_period_id = '00000000-0000-0000-0000-000000000041'$q$, 'DRAFT true');

  perform testhelp.sees('the student loses that result again',
  '00000000-0000-0000-0000-0000000000c0',
  $q$select count(*) from public.grade_entries$q$, 1);

  perform testhelp.blocked('a draft book cannot be reopened twice',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.reopen_grade_period('00000000-0000-0000-0000-000000000041')$q$);

  -- Put the book back where the school left it, so the published figures above
  -- describe the state the suite finishes in.
  perform testhelp.allows('the corrected book travels the workflow again',
  '00000000-0000-0000-0000-0000000000a1',
  $q$select public.submit_grade_period('00000000-0000-0000-0000-000000000041'),
        public.review_grade_period('00000000-0000-0000-0000-000000000041', true),
        public.publish_grade_period('00000000-0000-0000-0000-000000000041')$q$,
  $q$select count(*)::text from public.grade_entries where status = 'PUBLISHED'$q$, '2');

  perform testhelp.sees('another school reads no registrations or calendar',
  '00000000-0000-0000-0000-0000000000d0',
  $q$select count(*) from public.semesters$q$, 0);
end
$body$;


-- ---------------------------------------------------------------------------
-- 12. Paystack checkout, the webhook ledger and fee reminders (0010)
-- ---------------------------------------------------------------------------
do $body$
declare
  v_bob     uuid := '00000000-0000-0000-0000-0000000000c0';
  v_admin   uuid := '00000000-0000-0000-0000-0000000000a1';
  v_teacher uuid := '00000000-0000-0000-0000-0000000000b0';
  v_evil    uuid := '00000000-0000-0000-0000-0000000000ee';
  v_riv     uuid := '00000000-0000-0000-0000-0000000000d0';
  v_invoice uuid;
  v_late    uuid;
  v_draft   uuid;
  v_ref     text;
  v_a       text;
  v_b       text;
  v_c       text;
begin
  perform testhelp.allows(
    'an administrator issues the invoices this section needs',
    v_admin,
    $q$insert into public.invoices (student_id, status, due_date, total_amount, paid_amount, reference)
       values ('00000000-0000-0000-0000-0000000000c0', 'ISSUED', now() + interval '30 days', 4200.00, 0, 'RLS-PAY-1'),
              ('00000000-0000-0000-0000-0000000000c0', 'ISSUED', now() - interval '9 days',  1500.00, 0, 'RLS-PAY-2'),
              ('00000000-0000-0000-0000-0000000000c0', 'DRAFT',  now() + interval '30 days',    10.00, 0, 'RLS-PAY-3')$q$,
    $q$select count(*)::text from public.invoices where reference like 'RLS-PAY-%'$q$,
    '3');

  select id into v_invoice from public.invoices where reference = 'RLS-PAY-1';
  select id into v_late    from public.invoices where reference = 'RLS-PAY-2';
  select id into v_draft   from public.invoices where reference = 'RLS-PAY-3';

  ---------------------------------------------------------------------
  -- Opening a session is the only thing a student may do
  ---------------------------------------------------------------------
  perform testhelp.allows(
    'a student opens a checkout session for their own invoice',
    v_bob,
    format($q$select public.begin_payment(%L::uuid)$q$, v_invoice),
    format($q$select status || '/' || (reference like 'PY-%%')::text || '/' ||
                  lower(email) || '/' || currency
       from public.payment_attempts where invoice_id = %L::uuid$q$, v_invoice),
    'PENDING/true/bob@example.com/NGN');

  select reference into v_ref from public.payment_attempts where invoice_id = v_invoice;

  perform testhelp.allows(
    'reopening the checkout page reuses the live session instead of stacking another',
    v_bob,
    format($q$select public.begin_payment(%L::uuid)$q$, v_invoice),
    format($q$select status || '/' || (reference = %L)::text || '/' ||
                  (authorization_url is null)::text
       from public.payment_attempts where invoice_id = %L::uuid$q$, v_ref, v_invoice),
    'PENDING/true/true');

  perform testhelp.blocked(
    'another student cannot open a session on someone else''s invoice',
    v_evil, format($q$select public.begin_payment(%L::uuid)$q$, v_invoice));

  perform testhelp.blocked(
    'a session may not ask for more than the outstanding balance',
    v_bob, format($q$select public.begin_payment(%L::uuid, null, 99999)$q$, v_invoice));

  perform testhelp.blocked(
    'a draft invoice is not payable yet',
    v_bob, format($q$select public.begin_payment(%L::uuid)$q$, v_draft));

  perform testhelp.blocked(
    'an amount of zero opens nothing',
    v_bob, format($q$select public.begin_payment(%L::uuid, null, 0)$q$, v_invoice));

  perform testhelp.blocked(
    'a receipt address has to be an address',
    v_bob, format($q$select public.begin_payment(%L::uuid, 'not-an-email')$q$, v_invoice));

  perform testhelp.blocked(
    'a signed-out visitor cannot open a checkout session at all',
    null, format($q$select public.begin_payment(%L::uuid)$q$, v_invoice));

  ---------------------------------------------------------------------
  -- The three RPCs that move money are sealed off from every persona
  ---------------------------------------------------------------------
  perform testhelp.blocked(
    'the browser cannot confirm its own payment',
    v_bob, format($q$select public.confirm_payment_success(%L, 'evt-forged')$q$, v_ref));

  perform testhelp.blocked(
    'nor mark the session it is sitting in as started',
    v_bob, format($q$select public.mark_payment_started(%L)$q$, v_ref));

  perform testhelp.blocked(
    'nor close out a session it does not like',
    v_bob, format($q$select public.mark_payment_failed(%L, 'oops')$q$, v_ref));

  perform testhelp.blocked(
    'an administrator cannot credit a payment either',
    v_admin, format($q$select public.confirm_payment_success(%L, 'evt-admin')$q$, v_ref));

  perform testhelp.blocked(
    'not even a caller with no credentials at all',
    null, format($q$select public.confirm_payment_success(%L, 'evt-anon')$q$, v_ref));

  perform testhelp.blocked(
    'the checkout table cannot be edited from a session',
    v_bob,
    $q$update public.payment_attempts set status = 'SUCCESS'$q$);

  perform testhelp.blocked(
    'and cannot be inserted into either',
    v_bob,
    format($q$insert into public.payment_attempts (invoice_id, student_id, reference, email, amount)
                values (%L::uuid, %L::uuid, 'PY-FORGED', 'bob@example.com', 1)$q$, v_invoice, v_bob));

  perform testhelp.blocked(
    'an administrator cannot delete a session that has already been paid',
    v_admin,
    $q$delete from public.payment_attempts$q$);

  ---------------------------------------------------------------------
  -- The webhook path: one delivery, one ledger row
  ---------------------------------------------------------------------
  perform testhelp.direct(
    'the payment service marks the session it was handed as started',
    format($q$select public.mark_payment_started(%L, 'PS_RLS_1', 'https://paystack.test/checkout')$q$, v_ref),
    format($q$select status || '/' || coalesce(paystack_tx_id, '-') || '/' ||
                  (authorization_url like 'https://%%')::text
       from public.payment_attempts where reference = %L$q$, v_ref),
    'STARTED/PS_RLS_1/true');

  perform testhelp.direct(
    'a verified delivery credits the ledger and closes the invoice',
    format($q$select public.confirm_payment_success(%L, 'evt-1', 'charge.success', 'PS_RLS_1', 4200)$q$, v_ref),
    format($q$select status || '/' || paid_amount::text from public.invoices where id = %L::uuid$q$, v_invoice),
    'PAID/4200.00');

  perform testhelp.sees(
    'the credit notice is addressed to the student who paid',
    v_bob, $q$select count(*) from public.notifications where title = 'Payment received'$q$, 1);

  perform testhelp.sees(
    'a classmate hears nothing about it',
    v_evil, $q$select count(*) from public.notifications where title = 'Payment received'$q$, 0);

  perform testhelp.sees(
    'the bursar can see it on the student''s behalf',
    v_admin, $q$select count(*) from public.notifications where title = 'Payment received'$q$, 1);

  perform testhelp.sees(
    'the card payment sits in the ledger beside the cash one',
    v_admin, $q$select count(*) from public.payments where method = 'CARD'$q$, 1);

  perform testhelp.direct(
    'the same delivery replayed adds nothing',
    format($q$select public.confirm_payment_success(%L, 'evt-1', 'charge.success', 'PS_RLS_1', 4200)$q$, v_ref),
    format($q$select count(*)::text from public.payments where invoice_id = %L::uuid$q$, v_invoice),
    '1');

  perform testhelp.direct(
    'a second delivery of the same transaction is refused too',
    format($q$select public.confirm_payment_success(%L, 'evt-2', 'charge.success', 'PS_RLS_1', 4200)$q$, v_ref),
    $q$select count(*)::text from public.webhook_events where event = 'charge.success'$q$,
    '2');

  perform testhelp.blocked(
    'the webhook log is read-only even for an administrator',
    v_admin,
    $q$update public.webhook_events set result = 'tampered'$q$);

  ---------------------------------------------------------------------
  -- A session that does not add up is refused, not half-credited
  ---------------------------------------------------------------------
  perform testhelp.allows(
    'the student opens a session for the overdue invoice',
    v_bob, format($q$select public.begin_payment(%L::uuid)$q$, v_late),
    format($q$select amount::text || '/' || status from public.payment_attempts
       where invoice_id = %L::uuid$q$, v_late),
    '1500.00/PENDING');

  select reference into v_a from public.payment_attempts where invoice_id = v_late;

  perform testhelp.direct(
    'the service points that session at Paystack',
    format($q$select public.mark_payment_started(%L, 'PS_RLS_2')$q$, v_a),
    format($q$select status from public.payment_attempts where reference = %L$q$, v_a),
    'STARTED');

  perform testhelp.direct(
    'a delivery that charged a different amount banks nothing and says why',
    format($q$select public.confirm_payment_success(%L, 'evt-3', 'charge.success', 'PS_RLS_2', 500)$q$, v_a),
    format($q$select (select status from public.payment_attempts where reference = %L) || '/' ||
                  (select paid_amount::text from public.invoices where id = %L::uuid) || '/' ||
                  (select result from public.webhook_events where event_id = 'evt-3')$q$, v_a, v_late),
    'FAILED/0.00/not credited, amount mismatch');

  perform testhelp.direct(
    'the honest retry cannot repair a session the mismatch closed',
    format($q$select public.confirm_payment_success(%L, 'evt-4', 'charge.success', 'PS_RLS_2', 1500)$q$, v_a),
    format($q$select count(*)::text from public.payments where invoice_id = %L::uuid$q$, v_late),
    '0');

  perform testhelp.allows(
    'so the student has to open a fresh session',
    v_bob, format($q$select public.begin_payment(%L::uuid)$q$, v_late),
    $q$select count(*)::text from public.payment_attempts where status = 'PENDING'$q$,
    '1');

  select reference into v_b from public.payment_attempts where status = 'PENDING';

  perform testhelp.direct(
    'a declined card is explained without touching the ledger',
    format($q$select public.mark_payment_failed(%L, 'Card declined by the issuer.', 'evt-5', 'charge.failed')$q$, v_b),
    format($q$select (select status from public.payment_attempts where reference = %L) || '/' ||
                  (select count(*)::text from public.payments where invoice_id = %L::uuid) || '/' ||
                  (select message like '%%Card declined%%'
                     from public.notifications where title = 'Payment did not go through')$q$, v_b, v_late),
    'FAILED/0/true');

  perform testhelp.sees(
    'the declined session is still the student''s own to read',
    v_bob, $q$select count(*) from public.notifications where title = 'Payment did not go through'$q$, 1);

  ---------------------------------------------------------------------
  -- Overdue reminders
  ---------------------------------------------------------------------
  perform testhelp.blocked('a teacher cannot send fee reminders',
    v_teacher, $q$select public.flag_overdue_invoices()$q$);

  perform testhelp.blocked('nor can the student whose fees are late',
    v_bob, $q$select public.flag_overdue_invoices()$q$);

  perform testhelp.allows(
    'an administrator reminds the one student who is behind',
    v_admin, $q$select public.flag_overdue_invoices()$q$,
    $q$select count(*)::text from public.notifications
       where title = 'Fee reminder: invoice overdue'
         and recipient_id = '00000000-0000-0000-0000-0000000000c0'$q$,
    '1');

  perform testhelp.allows(
    'a second run inside the week does not pester anyone',
    v_admin, $q$select public.flag_overdue_invoices()$q$,
    $q$select count(*)::text from public.notifications
       where title = 'Fee reminder: invoice overdue'$q$,
    '1');

  perform testhelp.allows(
    'the invoice now carries the date it was last chased',
    v_admin, 'select 1',
    $q$select (last_reminder_at between now() - interval '1 minute' and now())::text
       from public.invoices where reference = 'RLS-PAY-2'$q$,
    'true');

  perform testhelp.direct(
    'eight days later the reminder is allowed again',
    $q$update public.invoices set last_reminder_at = now() - interval '8 days'
       where reference = 'RLS-PAY-2'$q$,
    $q$select count(*)::text from public.invoices
       where reference = 'RLS-PAY-2' and last_reminder_at < now() - interval '7 days'$q$,
    '1');

  perform testhelp.allows(
    'and the student hears from the bursar twice',
    v_admin, $q$select public.flag_overdue_invoices()$q$,
    $q$select count(*)::text from public.notifications
       where title = 'Fee reminder: invoice overdue'$q$,
    '2');

  ---------------------------------------------------------------------
  -- Paying it off, then dropping out of the run
  ---------------------------------------------------------------------
  perform testhelp.allows(
    'the student opens one last session and this time the money arrives',
    v_bob, format($q$select public.begin_payment(%L::uuid)$q$, v_late),
    $q$select status from public.payment_attempts where status = 'PENDING'$q$,
    'PENDING');

  select reference into v_c from public.payment_attempts where status = 'PENDING';

  perform testhelp.direct(
    'the service starts it',
    format($q$select public.mark_payment_started(%L, 'PS_RLS_3')$q$, v_c),
    format($q$select status from public.payment_attempts where reference = %L$q$, v_c),
    'STARTED');

  perform testhelp.direct(
    'and the verified delivery settles the overdue invoice',
    format($q$select public.confirm_payment_success(%L, 'evt-6', 'charge.success', 'PS_RLS_3', 1500)$q$, v_c),
    format($q$select status || '/' || paid_amount::text from public.invoices where id = %L::uuid$q$, v_late),
    'PAID/1500.00');

  perform testhelp.allows(
    'a settled invoice drops out of the reminder run',
    v_admin, $q$select public.flag_overdue_invoices()$q$,
    $q$select count(*)::text from public.notifications
       where title = 'Fee reminder: invoice overdue'$q$,
    '2');

  perform testhelp.blocked(
    'and an invoice that is already paid cannot be paid twice',
    v_bob, format($q$select public.begin_payment(%L::uuid)$q$, v_invoice));

  perform testhelp.sees(
    'both card payments are in the ledger',
    v_admin, $q$select count(*) from public.payments where method = 'CARD'$q$, 2);

  ---------------------------------------------------------------------
  -- Visibility
  ---------------------------------------------------------------------
  perform testhelp.sees('a student reads their own checkout sessions',
    v_bob, $q$select count(*) from public.payment_attempts$q$, 4);

  perform testhelp.sees('the other student in the tenant reads none of them',
    v_evil, $q$select count(*) from public.payment_attempts$q$, 0);

  perform testhelp.sees('the other school reads none of them',
    v_riv, $q$select count(*) from public.payment_attempts$q$, 0);

  perform testhelp.sees('an administrator reads every session in the school',
    v_admin, $q$select count(*) from public.payment_attempts$q$, 4);

  perform testhelp.sees('a student never sees the webhook log',
    v_bob, $q$select count(*) from public.webhook_events$q$, 0);

  perform testhelp.sees('an administrator can audit every delivery',
    v_admin, $q$select count(*) from public.webhook_events$q$, 6);

  perform testhelp.blocked('nobody signed in reads the checkout table at all',
    null, $q$select count(*) from public.payment_attempts$q$);

  perform testhelp.blocked('and cannot see the webhook log either',
    null, $q$select count(*) from public.webhook_events$q$);

  perform testhelp.truth(
    'addressing notices did not break the tenant-wide feed',
    v_evil,
    $q$select exists (select 1 from public.notifications
                       where title = 'Welcome' and recipient_id is null)$q$);
end
$body$;

-- ---------------------------------------------------------------------------
-- 13. Matric-number login (0011)
-- ---------------------------------------------------------------------------
do $body$
declare
  v_bob     uuid := '00000000-0000-0000-0000-0000000000c0';
  v_admin   uuid := '00000000-0000-0000-0000-0000000000a1';
  v_teacher uuid := '00000000-0000-0000-0000-0000000000b0';
  v_evil    uuid := '00000000-0000-0000-0000-0000000000ee';
  v_riv     uuid := '00000000-0000-0000-0000-0000000000d0';
  v_grace   uuid;
begin
  perform testhelp.allows(
    'the registry issues a matric number and normalises it',
    v_admin,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000c0', ' pin/2026/0042 ')$q$,
    $q$select matric_number from public.profiles
       where id = '00000000-0000-0000-0000-0000000000c0'$q$,
    'PIN/2026/0042');

  perform testhelp.blocked('a second student cannot be given the same number',
    v_admin,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000ee', 'PIN/2026/0042')$q$);

  perform testhelp.blocked('and a number that cannot be typed on an ID card is refused',
    v_admin,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000ee', 'not a number')$q$);

  perform testhelp.blocked('a teacher issues nothing',
    v_teacher,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000b0', 'PIN/2026/0043')$q$);

  perform testhelp.blocked('nor does an administrator reach into another school',
    v_riv,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000c0', 'RIV/2026/0009')$q$);

  perform testhelp.allows(
    'a student cannot write their own number through the profile',
    v_bob,
    $q$update public.profiles set matric_number = 'PIN/2026/9999'
       where id = '00000000-0000-0000-0000-0000000000c0'$q$,
    $q$select matric_number from public.profiles
       where id = '00000000-0000-0000-0000-0000000000c0'$q$,
    'PIN/2026/0042');

  -- Both halves are needed, so a guessed number reveals nothing.
  perform testhelp.allows(
    'matric number plus surname finds the sign-in address, however it is typed',
    null,
    $q$select public.resolve_login_email('pin/2026/0042', 'Bo')$q$,
    $q$select public.resolve_login_email('PIN/2026/0042', ' bo ')$q$,
    'bob@example.com');

  perform testhelp.blocked('the number on its own does not',
    null, $q$select public.resolve_login_email('PIN/2026/0042', 'Nobody')$q$);

  perform testhelp.blocked('nor does a half-typed pair',
    null, $q$select public.resolve_login_email('  ', 'Bo')$q$);

  select id into v_grace from public.profiles where email = 'grace@riverside.test';

  perform testhelp.allows(
    'the other school keeps its own number space',
    v_riv,
    format($q$select public.set_student_matric_number(%L::uuid, 'PIN/2026/0042')$q$, v_grace),
    $q$select matric_number from public.profiles where email = 'grace@riverside.test'$q$,
    'PIN/2026/0042');

  perform testhelp.allows(
    'until the account is withdrawn',
    v_riv,
    $q$update public.profiles set active = false where email = 'grace@riverside.test'$q$,
    $q$select count(*)::text from public.profiles
       where email = 'grace@riverside.test' and not active$q$,
    '1');

  perform testhelp.blocked('a withdrawn student cannot sign in by number',
    null, $q$select public.resolve_login_email('PIN/2026/0042', 'Riv')$q$);

  perform testhelp.allows(
    'and can again once the school restores the account',
    v_riv,
    $q$update public.profiles set active = true where email = 'grace@riverside.test'$q$,
    $q$select public.resolve_login_email('PIN/2026/0042', 'Riv')$q$,
    'grace@riverside.test');

  perform testhelp.allows(
    'clearing a number frees it for the next student',
    v_admin,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000c0', '')$q$,
    $q$select coalesce(matric_number, 'none') from public.profiles
       where id = '00000000-0000-0000-0000-0000000000c0'$q$,
    'none');

  perform testhelp.allows(
    'so the freed number can be issued to someone else',
    v_admin,
    $q$select public.set_student_matric_number('00000000-0000-0000-0000-0000000000ee', 'PIN/2026/0042')$q$,
    $q$select matric_number from public.profiles
       where id = '00000000-0000-0000-0000-0000000000ee'$q$,
    'PIN/2026/0042');

  perform testhelp.blocked('but Riverside''s bursar cannot sign in through Pinnacle''s number',
    v_riv,
    $q$select public.resolve_login_email('PIN/2026/0042', 'Bo')$q$);

  perform testhelp.allows(
    'the number is never editable by the student who owns it',
    v_evil,
    $q$update public.profiles set matric_number = 'PIN/2026/0099'
       where id = '00000000-0000-0000-0000-0000000000ee'$q$,
    $q$select matric_number from public.profiles
       where id = '00000000-0000-0000-0000-0000000000ee'$q$,
    'PIN/2026/0042');
end
$body$;

-- ---------------------------------------------------------------------------
-- 14. Parents and guardian links (0012)
-- ---------------------------------------------------------------------------
-- The persona count on profiles grew here, so this section never asserts the
-- tenant-wide totals the earlier sections pinned: those ran before it.
do $body$
declare
  v_admin   uuid := '00000000-0000-0000-0000-0000000000a1';
  v_teacher uuid := '00000000-0000-0000-0000-0000000000b0';
  v_bob     uuid := '00000000-0000-0000-0000-0000000000c0';
  v_riv     uuid := '00000000-0000-0000-0000-0000000000d0';
  v_evil    uuid := '00000000-0000-0000-0000-0000000000ee';
  v_ada     uuid;
  v_quentin uuid;
  v_pin     uuid;
  v_link    uuid;
begin
  select id into v_pin from public.tenants where slug = 'pinnacle-school';

  perform testhelp.allows(
    'an admin provisions a parent, and a parent is not on the student register',
    v_admin,
    $q$select public.create_school_user('Ada','Lovelace','ada@example.com','PARENT')$q$,
    $q$select role || '/' || student_status || '/' || student_level
       from public.profiles where email = 'ada@example.com'$q$,
    'PARENT/NONE/N/A');

  select id into v_ada from public.profiles where email = 'ada@example.com';

  perform testhelp.blocked('widening provisioning to parents did not widen it to admins',
    v_admin,
    $q$select public.create_school_user('Wannabe','Admin','want@example.com','SCHOOL_ADMIN')$q$);

  perform testhelp.allows(
    'a second parent, for the case where nobody has linked them',
    v_admin,
    $q$select public.create_school_user('Quentin','Quot','quentin@example.com','PARENT')$q$,
    $q$select count(*)::text from public.profiles where role = 'PARENT'$q$,
    '2');
  select id into v_quentin from public.profiles where email = 'quentin@example.com';

  perform testhelp.allows(
    'the other school provisions its own parent',
    v_riv,
    $q$select public.create_school_user('Zoe','Rivers','zoe@riverside.test','PARENT')$q$,
    $q$select coalesce(role,'?') from public.profiles where email = 'zoe@riverside.test'$q$,
    'PARENT');

  perform testhelp.allows(
    'an admin links a parent to their child, however the address is typed',
    v_admin,
    format($q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', %L, 'mother')$q$,
           ' ADA@Example.com '),
    format($q$select relationship || '/' || (tenant_id = %L::uuid)::text
       from public.student_guardians where student_id = '00000000-0000-0000-0000-0000000000c0'$q$, v_pin),
    'Mother/true');

  select id into v_link from public.student_guardians;

  perform testhelp.blocked('a teacher links nobody',
    v_teacher,
    $q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', 'carol@example.com')$q$);

  perform testhelp.blocked('an address with no account behind it is refused',
    v_admin,
    $q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', 'ghost@example.com')$q$);

  perform testhelp.blocked('so is a profile that is not a parent',
    v_admin,
    $q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', 'carol@example.com')$q$);

  perform testhelp.blocked('and a parent from another school cannot adopt a child',
    v_admin,
    $q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', 'zoe@riverside.test')$q$);

  perform testhelp.blocked('the same parent is not linked to the same child twice',
    v_admin,
    $q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', 'ada@example.com')$q$);

  perform testhelp.blocked('nor may an admin reach a child in another school',
    v_riv,
    $q$select public.link_guardian('00000000-0000-0000-0000-0000000000c0', 'ada@example.com')$q$);

  perform testhelp.blocked('a profile cannot be its own guardian',
    v_admin,
    format($q$insert into public.student_guardians (tenant_id, student_id, guardian_id, relationship)
           values (%L::uuid, '00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000ee', 'Self')$q$,
           v_pin));

  perform testhelp.sees('a parent reads the link that names them', v_ada,
    $q$select count(*) from public.student_guardians$q$, 1);

  perform testhelp.sees('an unlinked parent reads none', v_quentin,
    $q$select count(*) from public.student_guardians$q$, 0);

  perform testhelp.sees('the child themselves reads none', v_bob,
    $q$select count(*) from public.student_guardians$q$, 0);

  perform testhelp.sees('an admin reads the school''s links', v_admin,
    $q$select count(*) from public.student_guardians$q$, 1);

  perform testhelp.sees('and nothing from another school', v_riv,
    $q$select count(*) from public.student_guardians$q$, 0);

  -- Not merely filtered: 0012 revokes the anon read of the link table outright,
  -- so the publishable key cannot even ask.
  perform testhelp.blocked('anon cannot ask at all', null,
    $q$select count(*) from public.student_guardians$q$);

  perform testhelp.blocked('a parent cannot link a second child themselves',
    v_ada,
    format($q$insert into public.student_guardians (tenant_id, student_id, guardian_id, relationship)
           values (%L::uuid, '00000000-0000-0000-0000-0000000000ee', %L::uuid, 'Father')$q$, v_pin, v_ada));

  perform testhelp.blocked('nor remove their own link',
    v_ada,
    format($q$delete from public.student_guardians where id = %L::uuid$q$, v_link));

  -- The narrowing 0012 exists for: a parent holds an account in the school but is
  -- not in it, so the tenant-wide read of profiles stops at their own children.
  perform testhelp.sees('a parent sees themselves and the child they are linked to', v_ada,
    $q$select count(*) from public.profiles$q$, 2);

  perform testhelp.sees('a parent with no link sees only themselves', v_quentin,
    $q$select count(*) from public.profiles$q$, 1);

  perform testhelp.sees('and no other family''s record', v_ada,
    $q$select count(*) from public.profiles where role <> 'STUDENT'$q$, 1);

  perform testhelp.sees('a parent never reads another school''s register', v_ada,
    $q$select count(*) from public.profiles where email like '%riverside.test'$q$, 0);

  perform testhelp.truth('a student''s own read is unchanged by the parent policy', v_bob,
    $q$select exists (select 1 from public.profiles where email = 'quentin@example.com')
          and exists (select 1 from public.profiles where email = 'alice@example.com')$q$);

  perform testhelp.allows(
    'a parent editing their own name keeps it',
    v_ada,
    format($q$update public.profiles set first_name = 'Adeline' where id = %L::uuid$q$, v_ada),
    $q$select first_name from public.profiles where email = 'ada@example.com'$q$,
    'Adeline');

  perform testhelp.allows(
    'a parent promoting themselves stays a parent',
    v_ada,
    format($q$update public.profiles set role = 'SUPER_ADMIN' where id = %L::uuid$q$, v_ada),
    $q$select role from public.profiles where email = 'ada@example.com'$q$,
    'PARENT');

  perform testhelp.blocked('a teacher removes nobody',
    v_teacher,
    format($q$select public.unlink_guardian(%L::uuid)$q$, v_link));

  perform testhelp.blocked('nor does an admin of another school',
    v_riv,
    format($q$select public.unlink_guardian(%L::uuid)$q$, v_link));

  perform testhelp.allows(
    'the school can remove a link',
    v_admin,
    format($q$select public.unlink_guardian(%L::uuid)$q$, v_link),
    $q$select count(*)::text from public.student_guardians$q$, '0');

  perform testhelp.sees('and once removed the parent is back to seeing only themselves', v_ada,
    $q$select count(*) from public.profiles$q$, 1);
end
$body$;

-- ---------------------------------------------------------------------------
-- 15. Announcements, their audience and the mail outbox (0013)
-- ---------------------------------------------------------------------------
-- Pinnacle's roster at this point is eight profiles: two students (bob, evil),
-- two teachers (carol, frank), two admins (alice, erin) and two parents
-- (ada, quentin). Those numbers are what the fan-out assertions compare against.
do $body$
declare
  v_admin   uuid := '00000000-0000-0000-0000-0000000000a1';
  v_teacher uuid := '00000000-0000-0000-0000-0000000000b0';
  v_bob     uuid := '00000000-0000-0000-0000-0000000000c0';
  v_riv     uuid := '00000000-0000-0000-0000-0000000000d0';
  v_evil    uuid := '00000000-0000-0000-0000-0000000000ee';
  v_ada     uuid;
  v_pin     uuid;
  v_rivpin  uuid;
  v_all     uuid;
  v_students uuid;
  v_parents  uuid;
  v_staff    uuid;
  v_expired  uuid;
  v_future   uuid;
  v_late     uuid;
  v_theirs   uuid;
  v_result   jsonb;
  v_n        int;
  v_row      public.email_deliveries;
  v_d1       uuid;
  v_d2       uuid;
  v_ok       boolean;
  v_detail   text;
begin
  select id into v_pin from public.tenants where slug = 'pinnacle-school';
  select id into v_rivpin from public.tenants where slug = 'riverside-college';
  select id into v_ada from public.profiles where email = 'ada@example.com';

  -- Seven drafts, each written the way the compose screen writes one.
  perform testhelp.switch(v_admin);
  -- The first omits tenant_id on purpose: PostgREST sends exactly this column
  -- list, so the row can only belong to the school if the default does its work.
  insert into public.announcements (author_id, title, body, audience)
    values (v_admin, 'Term begins earlier', 'The new term starts on Monday.', 'ALL')
    returning id into v_all;
  insert into public.announcements (tenant_id, author_id, title, body, audience)
    values (v_pin, v_admin, 'Mid-semester exams', 'Exams start next week.
Check your timetable.', 'STUDENTS')
    returning id into v_students;
  insert into public.announcements (tenant_id, author_id, title, body, audience)
    values (v_pin, v_admin, 'Parents'' evening', 'Come and see the work.', 'PARENTS')
    returning id into v_parents;
  insert into public.announcements (tenant_id, author_id, title, body, audience)
    values (v_pin, v_admin, 'Staff briefing', 'All staff, hall, ten o''clock.', 'STAFF')
    returning id into v_staff;
  insert into public.announcements (tenant_id, author_id, title, body, audience)
    values (v_pin, v_admin, 'Welcome week', 'The week is over.', 'STUDENTS')
    returning id into v_expired;
  insert into public.announcements (tenant_id, author_id, title, body, audience, published_at)
    values (v_pin, v_admin, 'Founders'' day', 'Hand-set release time.', 'ALL', now() + interval '2 hours')
    returning id into v_future;
  insert into public.announcements (tenant_id, author_id, title, body, audience, published_at)
    values (v_pin, v_admin, 'Founders'' day again', 'Publishing releases it now.', 'ALL', now() + interval '3 hours')
    returning id into v_late;
  perform testhelp.back();

  perform testhelp.sees('a draft is invisible to a student', v_bob,
    $q$select count(*) from public.announcements$q$, 0);

  perform testhelp.sees('an unlinked parent sees nothing yet', v_ada,
    $q$select count(*) from public.announcements$q$, 0);

  perform testhelp.sees('the school office sees every draft', v_admin,
    $q$select count(*) from public.announcements$q$, 7);

  perform testhelp.truth('and the draft that named no school still belongs to this one', v_admin,
    format($q$select exists (select 1 from public.announcements
                              where id = %L::uuid and tenant_id = %L::uuid)$q$, v_all, v_pin));

  perform testhelp.truth('an audience resolves to exactly the roles it names', v_admin,
    $q$select public.announcement_audience_matches('ALL','PARENT')
          and public.announcement_audience_matches('STUDENTS','STUDENT')
          and not public.announcement_audience_matches('STUDENTS','PARENT')
          and public.announcement_audience_matches('TEACHERS','TEACHER')
          and public.announcement_audience_matches('STAFF','TEACHER')
          and public.announcement_audience_matches('STAFF','SUPER_ADMIN')
          and not public.announcement_audience_matches('STAFF','STUDENT')
          and public.announcement_audience_matches('PARENTS','PARENT')
          and not public.announcement_audience_matches('PARENTS','TEACHER')$q$);

  perform testhelp.blocked('an audience the school has not defined is refused',
    v_admin,
    format($q$insert into public.announcements (tenant_id, title, body, audience)
           values (%L::uuid, 'Ghost', 'Body', 'VISITORS')$q$, v_pin));

  perform testhelp.blocked('and so is a notice with nothing in it',
    v_admin,
    format($q$insert into public.announcements (tenant_id, title, body)
           values (%L::uuid, '   ', 'Body')$q$, v_pin));

  perform testhelp.blocked('a teacher drafts nothing',
    v_teacher,
    format($q$insert into public.announcements (tenant_id, title, body)
           values (%L::uuid, 'From a teacher', 'Body')$q$, v_pin));

  perform testhelp.blocked('anon writes nothing',
    null,
    format($q$insert into public.announcements (tenant_id, title, body)
           values (%L::uuid, 'From anon', 'Body')$q$, v_pin));

  perform testhelp.blocked('a teacher publishes nothing',
    v_teacher,
    format($q$select public.publish_announcement(%L::uuid)$q$, v_all));

  perform testhelp.blocked('nor does an admin of another school',
    v_riv,
    format($q$select public.publish_announcement(%L::uuid)$q$, v_all));

  perform testhelp.switch(v_admin);
  select public.publish_announcement(v_students, false) into v_result;
  perform testhelp.back();
  perform testhelp.record('publishing to students tells every active student and queues no mail',
    (v_result->>'notified')::int = 2 and (v_result->>'emailsQueued')::int = 0
      and v_result->>'status' = 'PUBLISHED',
    coalesce(v_result::text, 'null'));

  perform testhelp.sees('the notice appears in the student''s list', v_bob,
    $q$select count(*) from public.announcements where title = 'Mid-semester exams'$q$, 1);

  perform testhelp.sees('and once in their bell', v_bob,
    $q$select count(*) from public.notifications where title = 'Mid-semester exams'$q$, 1);

  perform testhelp.sees('but not in a parent''s list', v_ada,
    $q$select count(*) from public.announcements where title = 'Mid-semester exams'$q$, 0);

  perform testhelp.sees('nor in their bell', v_ada,
    $q$select count(*) from public.notifications where title = 'Mid-semester exams'$q$, 0);

  perform testhelp.switch(v_admin);
  select public.publish_announcement(v_staff, false) into v_result;
  perform testhelp.back();
  perform testhelp.record('a staff notice reaches the four people who work here',
    (v_result->>'notified')::int = 4, coalesce(v_result::text, 'null'));

  perform testhelp.sees('a teacher reads it', v_teacher,
    $q$select count(*) from public.announcements where title = 'Staff briefing'$q$, 1);

  perform testhelp.sees('a student does not', v_bob,
    $q$select count(*) from public.announcements where title = 'Staff briefing'$q$, 0);

  -- The outbox is written here and drained by the worker below. Locally a client
  -- has no privilege on the table at all, and on hosted Supabase the default
  -- grants stand but no policy admits anyone: both must come back empty.
  perform testhelp.switch(v_admin);
  select public.publish_announcement(v_parents, true) into v_result;
  perform testhelp.back();
  perform testhelp.record('publishing to parents queues one email per parent',
    (v_result->>'notified')::int = 2 and (v_result->>'emailsQueued')::int = 2,
    coalesce(v_result::text, 'null'));

  perform testhelp.sees('a parent reads the notice addressed to parents', v_ada,
    $q$select count(*) from public.announcements where title = 'Parents'' evening'$q$, 1);

  perform testhelp.sees('and a student does not', v_bob,
    $q$select count(*) from public.announcements where title = 'Parents'' evening'$q$, 0);

  perform testhelp.direct('every queued row is addressed to one parent',
    $q$select 1$q$,
    $q$select coalesce(((select count(*) from public.email_deliveries
                         where status = 'QUEUED' and attempts = 0)::int = 2)::text,'?')$q$,
    'true');

  perform testhelp.switch(v_admin);
  begin
    select count(*) into v_n from public.email_deliveries;
    v_ok := v_n = 0;
    v_detail := 'rows visible to an admin: ' || v_n;
  exception when others then
    v_ok := true;
    v_detail := 'refused: ' || left(SQLERRM, 60);
  end;
  perform testhelp.back();
  perform testhelp.record('no client role reads the mail outbox', v_ok, v_detail);

  perform testhelp.blocked('no client may write the outbox either',
    v_admin,
    format($q$insert into public.email_deliveries (tenant_id, to_address, subject, body)
           values (%L::uuid, 'ada@example.com', 'Forged', 'Body')$q$, v_pin));

  perform testhelp.truth('the delivery summary adds up for the office', v_admin,
    format($q$select (public.announcement_delivery_summary(%L::uuid) -> 'emails' ->> 'QUEUED')::int = 2
             and (public.announcement_delivery_summary(%L::uuid) ->> 'audience')::int = 2
             and (public.announcement_delivery_summary(%L::uuid) ->> 'readBy')::int = 0$q$,
           v_parents, v_parents, v_parents));

  perform testhelp.sees('and returns nothing to someone who is not the office', v_bob,
    format($q$select (public.announcement_delivery_summary(%L::uuid) is null)::int$q$, v_parents), 1);

  perform testhelp.truth('the recipient list names exactly the active students', v_admin,
    format($q$select (select count(*) from public.announcement_recipients(%L::uuid))
                  = (select count(*) from public.profiles
                      where role = 'STUDENT' and active and tenant_id = %L::uuid)$q$,
           v_students, v_pin));

  perform testhelp.sees('and a student asking for that list gets nothing', v_bob,
    format($q$select count(*) from public.announcement_recipients(%L::uuid)$q$, v_students), 0);

  perform testhelp.sees('nor does an admin of another school', v_riv,
    format($q$select count(*) from public.announcement_recipients(%L::uuid)$q$, v_students), 0);

  perform testhelp.blocked('a notice is not sent twice',
    v_admin,
    format($q$select public.publish_announcement(%L::uuid)$q$, v_students));

  perform testhelp.switch(v_admin);
  select public.publish_announcement(v_all, false) into v_result;
  perform testhelp.back();
  perform testhelp.record('a notice addressed to all reaches every active profile in the school',
    (v_result->>'notified')::int = 8, coalesce(v_result::text, 'null'));

  -- Expired and not-yet-due notices are school-office business only.
  perform testhelp.switch(v_admin);
  select public.publish_announcement(v_expired, false) into v_result;
  perform testhelp.back();

  perform testhelp.direct('withdrawing a notice once its date has passed',
    format($q$update public.announcements
              set published_at = now() - interval '2 days',
                  expires_at = now() - interval '1 hour'
            where id = %L::uuid$q$, v_expired),
    format($q$select coalesce((expires_at < now())::text,'?') from public.announcements
           where id = %L::uuid$q$, v_expired),
    'true');

  perform testhelp.sees('a student does not read a notice that has expired', v_bob,
    $q$select count(*) from public.announcements where title = 'Welcome week'$q$, 0);

  perform testhelp.sees('the office still does', v_admin,
    $q$select count(*) from public.announcements where title = 'Welcome week'$q$, 1);

  perform testhelp.direct('a hand-set release time in the future stays unreleased',
    format($q$update public.announcements set status = 'PUBLISHED' where id = %L::uuid$q$, v_future),
    format($q$select coalesce((published_at > now())::text,'?') from public.announcements
           where id = %L::uuid$q$, v_future),
    'true');

  perform testhelp.sees('so nobody outside the office sees it', v_bob,
    $q$select count(*) from public.announcements where title = 'Founders'' day'$q$, 0);

  perform testhelp.allows(
    'and publishing a future-dated draft releases it now rather than leaking it early',
    v_admin,
    format($q$select public.publish_announcement(%L::uuid, false)$q$, v_late),
    format($q$select coalesce((published_at <= now())::text,'?') from public.announcements
           where id = %L::uuid$q$, v_late),
    'true');

  perform testhelp.sees('so its audience can read it', v_bob,
    $q$select count(*) from public.announcements where title = 'Founders'' day again'$q$, 1);

  perform testhelp.truth('the lists each role opens are their own audience', v_bob,
    $q$select (select count(*) from public.announcements) = 3$q$);

  perform testhelp.truth('a parent sees the notice to all, the parents'' one and the released one', v_ada,
    $q$select (select count(*) from public.announcements) = 3$q$);

  perform testhelp.truth('a teacher sees the notice to all, the staff one and the released one', v_teacher,
    $q$select (select count(*) from public.announcements) = 3$q$);

  perform testhelp.truth('the office sees all seven, drafts and all', v_admin,
    $q$select (select count(*) from public.announcements) = 7$q$);

  perform testhelp.sees('another school reads none of them', v_riv,
    $q$select count(*) from public.announcements$q$, 0);

  perform testhelp.blocked('and cannot post into ours',
    v_riv,
    format($q$insert into public.announcements (tenant_id, title, body)
           values (%L::uuid, 'Forged notice', 'Body')$q$, v_pin));

  perform testhelp.allows(
    'they run their own notices',
    v_riv,
    format($q$insert into public.announcements (tenant_id, author_id, title, body, audience)
           values (%L::uuid, '00000000-0000-0000-0000-0000000000d0', 'Boat race', 'Rowing regatta', 'ALL')$q$,
           v_rivpin),
    $q$select count(*)::text from public.announcements
       where tenant_id = (select id from public.tenants where slug = 'riverside-college')$q$, '1');

  perform testhelp.sees('and their notice is not ours', v_bob,
    $q$select count(*) from public.announcements where title = 'Boat race'$q$, 0);

  -- Read receipts: the table is readable by its owner and written only through
  -- the RPC, so a crafted client insert cannot fake one.
  perform testhelp.blocked('a client cannot write a read receipt, not even their own',
    v_bob,
    format($q$insert into public.announcement_reads (announcement_id, user_id)
           values (%L::uuid, '00000000-0000-0000-0000-0000000000c0')$q$, v_all));

  perform testhelp.blocked('nor for somebody else',
    v_admin,
    format($q$insert into public.announcement_reads (announcement_id, user_id)
           values (%L::uuid, '00000000-0000-0000-0000-0000000000c0')$q$, v_all));

  perform testhelp.switch(v_bob);
  select public.mark_announcements_read(v_all) into v_n;
  perform testhelp.back();
  perform testhelp.record('marking one notice read writes one receipt',
    v_n = 1, 'inserted ' || coalesce(v_n::text, 'null'));

  perform testhelp.sees('and only the reader can see it', v_bob,
    $q$select count(*) from public.announcement_reads$q$, 1);

  perform testhelp.sees('the office reads none of them', v_admin,
    $q$select count(*) from public.announcement_reads$q$, 0);

  perform testhelp.sees('nor does another user', v_teacher,
    $q$select count(*) from public.announcement_reads$q$, 0);

  perform testhelp.blocked('a read cannot be taken back', v_bob,
    $q$delete from public.announcement_reads$q$);

  perform testhelp.blocked('and anon marks nothing read', null,
    $q$select public.mark_announcements_read(null)$q$);

  perform testhelp.switch(v_evil);
  select public.mark_announcements_read(null) into v_n;
  perform testhelp.back();
  perform testhelp.record('marking everything read skips what the caller may not see',
    v_n = 3, 'inserted ' || coalesce(v_n::text, 'null'));

  perform testhelp.switch(v_ada);
  select public.mark_announcements_read(null) into v_n;
  perform testhelp.back();
  perform testhelp.record('and the same for a parent, whose three are a different three',
    v_n = 3, 'inserted ' || coalesce(v_n::text, 'null'));

  perform testhelp.allows(
    'marking again adds nothing',
    v_ada,
    format($q$select public.mark_announcements_read(%L::uuid)$q$, v_all),
    $q$select count(*)::text from public.announcement_reads
       where user_id = (select id from public.profiles where email = 'ada@example.com')$q$,
    '3');

  -- The outbox worker: sealed against any caller holding a user JWT, and the
  -- only path that moves mail is the service-role one (here, the owner path).
  select id into v_d1 from public.email_deliveries order by to_address;
  select id into v_d2 from public.email_deliveries order by to_address desc;

  perform testhelp.blocked('an admin cannot claim mail',
    v_admin,
    $q$select count(*) from public.claim_email_deliveries(10)$q$);

  perform testhelp.blocked('nor can the publishable key',
    null,
    $q$select count(*) from public.claim_email_deliveries(1)$q$);

  perform testhelp.blocked('and nobody holding a user JWT may record a delivery',
    v_admin,
    format($q$select public.record_email_delivery(%L::uuid, 'SENT', 'res_forged')$q$, v_d1));

  select count(*) into v_n from public.claim_email_deliveries(10);
  perform testhelp.record('the worker claims the queued mail',
    v_n = 2, 'claimed ' || v_n);

  perform testhelp.direct('and marks it in flight, one attempt in',
    $q$select 1$q$,
    $q$select coalesce(((select count(*) from public.email_deliveries
                          where status = 'SENDING' and attempts = 1)::int = 2)::text,'?')$q$,
    'true');

  -- The composite has to be expanded into columns for a row variable to take it.
  select (public.record_email_delivery(v_d1, 'SENT', 'res_001')).* into v_row;
  perform testhelp.record('a delivery reported as sent records the provider id and the time',
    v_row.status = 'SENT' and v_row.provider_id = 'res_001'
      and v_row.sent_at is not null and v_row.error is null,
    'status ' || coalesce(v_row.status, 'null'));

  select (public.record_email_delivery(v_d2, 'FAILED', null, 'The family mailbox is full')).* into v_row;
  perform testhelp.record('a failed delivery keeps its reason and no send time',
    v_row.status = 'FAILED' and v_row.sent_at is null
      and v_row.error = 'The family mailbox is full',
    'error ' || coalesce(v_row.error, 'null'));

  begin
    select (public.record_email_delivery(v_d1, 'BORROWED')).* into v_row;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  perform testhelp.record('and a status that does not exist is refused', v_ok,
    'accepted BORROWED');

  update public.email_deliveries set status = 'QUEUED', attempts = 5 where id = v_d2;
  select count(*) into v_n from public.claim_email_deliveries(10);
  perform testhelp.record('mail that has failed five times is left alone',
    v_n = 0, 'claimed ' || v_n);

  perform testhelp.direct('and its reason stays on the row for whoever asks about it',
    $q$select 1$q$,
    $q$select coalesce(((select count(*) from public.email_deliveries
                          where status = 'QUEUED' and attempts = 5
                            and error = 'The family mailbox is full')::int = 1)::text,'?')$q$,
    'true');

  -- One parent's mail went out, the other is queued but out of retries, and the
  -- only read receipt against this notice is the parent's.
  perform testhelp.truth('the summary follows the ledger', v_admin,
    format($q$select (public.announcement_delivery_summary(%L::uuid) -> 'emails' ->> 'SENT')::int = 1
             and (public.announcement_delivery_summary(%L::uuid) -> 'emails' ->> 'QUEUED')::int = 1
             and (public.announcement_delivery_summary(%L::uuid) ->> 'readBy')::int = 1$q$,
           v_parents, v_parents, v_parents));
end
$body$;

-- ---------------------------------------------------------------------------
-- 16. Assignments and submissions (0015)
-- ---------------------------------------------------------------------------
-- The pair of doors this migration builds is deliberate: a task may be reworded
-- from the browser, work may only be handed in through submit_assignment(), and a
-- mark only through grade_submission(). The assertions below try each handle, and
-- then the handles that should not exist - a hand-written submission row, a
-- status moved by hand, a file path naming a course the uploader is not in.
do $body$
declare
  v_admin   uuid := '00000000-0000-0000-0000-0000000000a1';
  v_carol   uuid := '00000000-0000-0000-0000-0000000000b0';
  v_bob     uuid := '00000000-0000-0000-0000-0000000000c0';
  v_dave    uuid := '00000000-0000-0000-0000-0000000000d0';
  v_cs201   uuid := '00000000-0000-0000-0000-0000000000c1';
  v_cs202   uuid := '00000000-0000-0000-0000-0000000000c2';
  v_lab     uuid := '00000000-0000-0000-0000-00000000f001';
  v_late    uuid := '00000000-0000-0000-0000-00000000f002';
  v_sub_path text;
begin
  v_sub_path := v_cs201::text || '/' || v_lab::text || '/' || v_bob::text || '/answer.pdf';

  perform testhelp.allows(
  'a teacher can set a task on the course they teach',
  v_carol,
  format($q$insert into public.assignments (id, course_id, created_by_id, title, instructions, due_at, points)
          values (%L, %L, %L, 'Lab 1: normal forms', 'Normalise the schema in the fixture file.',
                  now() + interval '7 days', 20)$q$, v_lab, v_cs201, v_carol),
  format($q$select status || '/' ||
                (tenant_id = (select id from public.tenants where slug = 'pinnacle-school'))::text
       from public.assignments where id = %L$q$, v_lab),
  'DRAFT/true');

  perform testhelp.blocked(
  'a teacher cannot set a task on a course they do not teach',
  v_carol,
  format($q$insert into public.assignments (course_id, created_by_id, title, due_at)
          values (%L, %L, 'Essay', now() + interval '7 days')$q$, v_cs202, v_carol));

  perform testhelp.blocked(
  'a student cannot set a task at all',
  v_bob,
  format($q$insert into public.assignments (course_id, created_by_id, title, due_at)
          values (%L, %L, 'Homework', now() + interval '7 days')$q$, v_cs201, v_bob));

  -- The draft is the teacher's own until it is published; this is the assertion
  -- that stops a half-written brief reaching a class.
  perform testhelp.sees('a draft is invisible to a student on the course', v_bob,
    format($q$select count(*) from public.assignments where id = %L$q$, v_lab), 0);
  perform testhelp.sees('visible to the teacher who wrote it', v_carol,
    format($q$select count(*) from public.assignments where id = %L$q$, v_lab), 1);
  perform testhelp.sees('and invisible to an administrator at another school', v_dave,
    format($q$select count(*) from public.assignments where id = %L$q$, v_lab), 0);

  perform testhelp.blocked('a draft cannot be closed before it is set', v_carol,
    format($q$select public.close_assignment(%L)$q$, v_lab));
  perform testhelp.blocked('a student cannot publish someone else''s task', v_bob,
    format($q$select public.publish_assignment(%L)$q$, v_lab));
  perform testhelp.blocked('nor can an administrator at another school', v_dave,
    format($q$select public.publish_assignment(%L)$q$, v_lab));

  -- The upload has to follow the publication, because a file in a folder is the
  -- one part of this flow a client does write directly.
  perform testhelp.blocked('work cannot be filed against a task that is still a draft', v_bob,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('assignment-submissions', %L, %L)$q$,
            (v_cs201::text || '/' || v_lab::text || '/' || v_bob::text || '/early.pdf'), v_bob));

  perform testhelp.truth('publishing reaches exactly the active roll', v_carol,
    format($q$select (public.publish_assignment(%L) ->> 'students')::int = 1$q$, v_lab));
  perform testhelp.blocked('and the same task cannot be published twice', v_carol,
    format($q$select public.publish_assignment(%L)$q$, v_lab));

  perform testhelp.sees('the student now sees the task', v_bob,
    format($q$select count(*) from public.assignments where id = %L$q$, v_lab), 1);

  perform testhelp.blocked('a student cannot file work into another student''s folder', v_bob,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('assignment-submissions', %L, %L)$q$,
            (v_cs201::text || '/' || v_lab::text || '/' || v_carol::text || '/note.txt'), v_bob));

  perform testhelp.allows('their own folder is open to them', v_bob,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('assignment-submissions', %L, %L)$q$, v_sub_path, v_bob),
    format($q$select count(*)::text from storage.objects
            where bucket_id = 'assignment-submissions' and name = %L$q$, v_sub_path),
    '1');

  perform testhelp.blocked('a submission cannot claim a file that was never uploaded', v_bob,
    format($q$select public.submit_assignment(%L, 'Typed answer', %L)$q$, v_lab,
      (v_cs201::text || '/' || v_lab::text || '/' || v_bob::text || '/ghost.pdf')));
  perform testhelp.blocked('nor a path that names another course', v_bob,
    format($q$select public.submit_assignment(%L, null, %L)$q$, v_lab,
      (v_cs202::text || '/' || v_lab::text || '/' || v_bob::text || '/x.pdf')));

  -- Submissions have no write policy and no table privilege. Both halves are
  -- tested here because either one alone would still let a crafted client in.
  perform testhelp.blocked('a student cannot write a submission row by hand', v_bob,
    format($q$insert into public.assignment_submissions (assignment_id, student_id, note)
            values (%L, %L, 'I did it')$q$, v_lab, v_bob));
  perform testhelp.blocked('not even an administrator at their own school', v_admin,
    format($q$insert into public.assignment_submissions (assignment_id, student_id, note)
            values (%L, %L, 'Backdated for a friend')$q$, v_lab, v_bob));

  perform testhelp.allows('the uploaded file becomes a submission', v_bob,
    format($q$select public.submit_assignment(%L, 'My answer is attached', %L)$q$, v_lab, v_sub_path),
    format($q$select status from public.assignment_submissions
            where assignment_id = %L and student_id = %L$q$, v_lab, v_bob),
    'SUBMITTED');

  perform testhelp.sees('the teacher sees the submission', v_carol,
    format($q$select count(*) from public.assignment_submissions where assignment_id = %L$q$, v_lab), 1);
  perform testhelp.sees('the office sees it', v_admin,
    format($q$select count(*) from public.assignment_submissions where assignment_id = %L$q$, v_lab), 1);
  perform testhelp.sees('another school does not', v_dave,
    format($q$select count(*) from public.assignment_submissions where assignment_id = %L$q$, v_lab), 0);

  perform testhelp.blocked('a student cannot mark their own work', v_bob,
    format($q$select public.grade_submission(id, 15, 'Nice')
             from public.assignment_submissions where assignment_id = %L$q$, v_lab));
  perform testhelp.blocked('a mark above the ceiling is refused before it is written', v_carol,
    format($q$select public.grade_submission((select id from public.assignment_submissions
                                              where assignment_id = %L), 21, 'Generous')$q$, v_lab));

  perform testhelp.allows('the teacher marks it', v_carol,
    format($q$select public.grade_submission((select id from public.assignment_submissions
                                              where assignment_id = %L), 18, 'Good normalisation.')$q$, v_lab),
    format($q$select status || '/' || score::text || '/' ||
                  (graded_by_id = %L)::text
       from public.assignment_submissions where assignment_id = %L$q$, v_carol, v_lab),
    'GRADED/18.00/true');

  perform testhelp.sees('and the student is told rather than left to notice', v_bob,
    format($q$select count(*) from public.notifications
            where category = 'academic' and recipient_id = %L$q$, v_bob), 1);

  perform testhelp.blocked('marked work cannot be handed in again', v_bob,
    format($q$select public.submit_assignment(%L, 'Second try')$q$, v_lab));
  -- The revoked UPDATE privilege and guard_submission_score() are two separate
  -- walls; this attempts the write and lets either one answer.
  perform testhelp.blocked('a hand-written mark cannot exceed the task', v_admin,
    format($q$update public.assignment_submissions set score = 99 where assignment_id = %L$q$, v_lab));

  perform testhelp.truth('the roster arrives in one call, tallied', v_carol,
    format($q$select (public.assignment_roster(%L) ->> 'graded')::int = 1
             and (public.assignment_roster(%L) ->> 'missing')::int = 0
             and jsonb_array_length(public.assignment_roster(%L) -> 'students') = 1$q$,
           v_lab, v_lab, v_lab));
  perform testhelp.blocked('a student cannot read the roster', v_bob,
    format($q$select public.assignment_roster(%L)$q$, v_lab));
  perform testhelp.blocked('nor can an administrator at another school', v_dave,
    format($q$select public.assignment_roster(%L)$q$, v_lab));

  perform testhelp.allows('closing the task stops it taking work', v_carol,
    format($q$select public.close_assignment(%L)$q$, v_lab),
    format($q$select status from public.assignments where id = %L$q$, v_lab),
    'CLOSED');
  perform testhelp.blocked('and a hand-in after closing is refused', v_bob,
    format($q$select public.submit_assignment(%L, 'Sorry, late')$q$, v_lab));
  -- A student keeps seeing a closed task: the mark and the wording stay together.
  perform testhelp.sees('the student still sees the closed task and their mark', v_bob,
    format($q$select count(*) from public.assignments where id = %L$q$, v_lab), 1);

  perform testhelp.allows('the teacher may reword a task', v_carol,
    format($q$update public.assignments set title = 'Lab 1: 1NF to 3NF' where id = %L$q$, v_lab),
    format($q$select title from public.assignments where id = %L$q$, v_lab),
    'Lab 1: 1NF to 3NF');
  perform testhelp.blocked('but may not move it onto another course', v_carol,
    format($q$update public.assignments set course_id = %L where id = %L$q$, v_cs202, v_lab));
  perform testhelp.blocked('nor publish it by setting the column', v_carol,
    format($q$update public.assignments set status = 'PUBLISHED' where id = %L$q$, v_lab));

  -- Past the deadline, the work is still taken - and labelled.
  perform testhelp.allows('a task set late into the term can be created', v_carol,
    format($q$insert into public.assignments (id, course_id, created_by_id, title, due_at, points)
            values (%L, %L, %L, 'Late exercise', now() - interval '2 days', 10)$q$, v_late, v_cs201, v_carol),
    format($q$select status from public.assignments where id = %L$q$, v_late),
    'DRAFT');
  perform testhelp.allows('and published', v_carol,
    format($q$select public.publish_assignment(%L)$q$, v_late),
    format($q$select status from public.assignments where id = %L$q$, v_late),
    'PUBLISHED');
  perform testhelp.allows('a student who missed the deadline still gets to hand in, marked LATE', v_bob,
    format($q$select public.submit_assignment(%L, 'Here is my attempt')$q$, v_late),
    format($q$select status from public.assignment_submissions where assignment_id = %L$q$, v_late),
    'LATE');
  perform testhelp.blocked('a lecturer is not on the roll, so they cannot hand in either', v_carol,
    format($q$select public.submit_assignment(%L, 'Demonstration answer')$q$, v_late));

  -- The storage bucket is shared by every school, so the tenant gate - not the
  -- administrator badge - is what keeps another school's files out of view.
  perform testhelp.sees('the student sees their own file in the bucket', v_bob,
    $q$select count(*) from storage.objects where bucket_id = 'assignment-submissions'$q$, 1);
  perform testhelp.sees('the teacher of the course sees it', v_carol,
    $q$select count(*) from storage.objects where bucket_id = 'assignment-submissions'$q$, 1);
  perform testhelp.sees('their own administrator sees it', v_admin,
    $q$select count(*) from storage.objects where bucket_id = 'assignment-submissions'$q$, 1);
  perform testhelp.sees('an administrator at another school sees none of it', v_dave,
    $q$select count(*) from storage.objects where bucket_id = 'assignment-submissions'$q$, 0);
end
$body$;

-- ---------------------------------------------------------------------------
-- 17. Course materials (0016)
-- ---------------------------------------------------------------------------
do $body$
declare
  v_admin  uuid := '00000000-0000-0000-0000-0000000000a1';
  v_carol  uuid := '00000000-0000-0000-0000-0000000000b0';
  v_bob    uuid := '00000000-0000-0000-0000-0000000000c0';
  v_dave   uuid := '00000000-0000-0000-0000-0000000000d0';
  v_cs201  uuid := '00000000-0000-0000-0000-0000000000c1';
  v_cs202  uuid := '00000000-0000-0000-0000-0000000000c2';
  v_slides text;
  v_os     text;
begin
  v_slides := v_cs201::text || '/slides-week1.pdf';
  v_os     := v_cs202::text || '/os-notes.pdf';

  perform testhelp.allows('a lecturer uploads a handout into their course folder', v_carol,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('course-materials', %L, %L)$q$, v_slides, v_carol),
    format($q$select count(*)::text from storage.objects
            where bucket_id = 'course-materials' and name = %L$q$, v_slides),
    '1');

  perform testhelp.blocked('a student cannot put a file on a course page', v_bob,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('course-materials', %L, %L)$q$,
            (v_cs201::text || '/essay-cheatsheet.pdf'), v_bob));
  perform testhelp.blocked('nor can an administrator from another school', v_dave,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('course-materials', %L, %L)$q$,
            (v_cs201::text || '/planted.pdf'), v_dave));

  perform testhelp.blocked('a material cannot point at a file that is not there', v_carol,
    format($q$select public.attach_course_material(%L, 'Ghost slides', %L, 'ghost.pdf')$q$,
      v_cs201, (v_cs201::text || '/ghost.pdf')));
  perform testhelp.blocked('a path from another course''s folder is refused', v_carol,
    format($q$select public.attach_course_material(%L, 'Mislabelled', %L, 'os-notes.pdf')$q$,
      v_cs201, v_os));
  perform testhelp.blocked('a student cannot publish a material', v_bob,
    format($q$select public.attach_course_material(%L, 'My notes', %L, 'slides-week1.pdf')$q$,
      v_cs201, v_slides));
  perform testhelp.blocked('nor can an administrator from another school', v_dave,
    format($q$select public.attach_course_material(%L, 'Cross-tenant', %L, 'slides-week1.pdf')$q$,
      v_cs201, v_slides));
  perform testhelp.blocked('a material without a title is refused', v_carol,
    format($q$select public.attach_course_material(%L, '   ', %L, 'slides-week1.pdf')$q$,
      v_cs201, v_slides));

  perform testhelp.allows('the lecturer publishes the handout', v_carol,
    format($q$select public.attach_course_material(%L, 'Week 1 slides', %L, 'slides-week1.pdf',
                                                   'Normalisation basics', 'Week 1', 'application/pdf', 512000)$q$,
      v_cs201, v_slides),
    format($q$select title || '/' || week_label || '/' || file_name || '/' ||
                  mime_type || '/' || size_bytes::text || '/' ||
                  (uploaded_by_id = %L)::text
       from public.course_materials where storage_path = %L$q$, v_carol, v_slides),
  'Week 1 slides/Week 1/slides-week1.pdf/application/pdf/512000/true');

  perform testhelp.sees('an enrolled student sees the handout', v_bob,
    format($q$select count(*) from public.course_materials where storage_path = %L$q$, v_slides), 1);
  perform testhelp.sees('the lecturer who posted it sees it', v_carol,
    format($q$select count(*) from public.course_materials where storage_path = %L$q$, v_slides), 1);
  perform testhelp.sees('another school''s administrator does not', v_dave,
    format($q$select count(*) from public.course_materials where storage_path = %L$q$, v_slides), 0);
  perform testhelp.sees('a lecturer who does not teach the course does not either', v_carol,
    format($q$select count(*) from public.course_materials where storage_path = %L$q$, v_os), 0);

  -- The object behind the row is reachable on the same terms as the row.
  perform testhelp.sees('the student can read the stored object', v_bob,
    format($q$select count(*) from storage.objects
            where bucket_id = 'course-materials' and name = %L$q$, v_slides), 1);
  perform testhelp.sees('and an administrator at another school cannot', v_dave,
    format($q$select count(*) from storage.objects
            where bucket_id = 'course-materials' and name = %L$q$, v_slides), 0);

  perform testhelp.blocked('a client cannot insert a material row by hand', v_carol,
    format($q$insert into public.course_materials (course_id, title, storage_path, file_name)
            values (%L, 'By hand', %L, 'slides-week1.pdf')$q$, v_cs201, v_slides));
  perform testhelp.blocked('nor delete one', v_admin,
    format($q$delete from public.course_materials where storage_path = %L$q$, v_slides));

  perform testhelp.allows('the lecturer can rename it', v_carol,
    format($q$update public.course_materials set title = 'Week 1: normal forms',
                             description = 'Slides plus the worked example'
            where storage_path = %L$q$, v_slides),
    format($q$select title from public.course_materials where storage_path = %L$q$, v_slides),
    'Week 1: normal forms');
  perform testhelp.blocked('but cannot move it onto another course', v_carol,
    format($q$update public.course_materials set course_id = %L where storage_path = %L$q$, v_cs202, v_slides));
  perform testhelp.blocked('nor repoint it at another file', v_carol,
    format($q$update public.course_materials set storage_path = %L where storage_path = %L$q$, v_os, v_slides));
  -- An RLS-filtered UPDATE raises nothing: it reports zero rows affected. So the
  -- student's rename is asserted by what the row still says afterwards, which is
  -- the only honest way to test a policy that hides rows rather than blocks them.
  perform testhelp.allows('a student who tries to rename a handout changes nothing', v_bob,
    format($q$update public.course_materials set title = 'Free for all' where storage_path = %L$q$, v_slides),
    format($q$select title from public.course_materials where storage_path = %L$q$, v_slides),
    'Week 1: normal forms');

  -- An administrator is not limited to the courses they teach, but is limited to
  -- their own school - which is what these two assertions are for.
  perform testhelp.allows('an administrator can upload to any course in their school', v_admin,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('course-materials', %L, %L)$q$, v_os, v_admin),
    format($q$select count(*)::text from storage.objects
            where bucket_id = 'course-materials' and name = %L$q$, v_os),
    '1');
  perform testhelp.allows('and attach the file they uploaded', v_admin,
    format($q$select public.attach_course_material(%L, 'OS revision notes', %L, 'os-notes.pdf',
                                                   '', 'All terms', 'application/pdf', 204800)$q$,
      v_cs202, v_os),
    format($q$select title || '/' || (uploaded_by_id = %L)::text
       from public.course_materials where storage_path = %L$q$, v_admin, v_os),
    'OS revision notes/true');
  perform testhelp.sees('a student on that course sees it', v_bob,
    format($q$select count(*) from public.course_materials where storage_path = %L$q$, v_os), 1);

  perform testhelp.blocked('a student cannot withdraw a handout', v_bob,
    format($q$select public.remove_course_material((select id from public.course_materials
                                                    where storage_path = %L))$q$, v_os));
  perform testhelp.blocked('nor can an administrator from another school', v_dave,
    format($q$select public.remove_course_material((select id from public.course_materials
                                                    where storage_path = %L))$q$, v_os));

  -- Removing takes the object with it; the count below runs as the superuser, so
  -- it is the definer's delete that emptied the bucket rather than a filter.
  perform testhelp.allows('the office withdraws it and the stored file goes too', v_admin,
    format($q$select public.remove_course_material((select id from public.course_materials
                                                    where storage_path = %L))$q$, v_os),
    format($q$select (select count(*) from public.course_materials where storage_path = %L)::text || '/' ||
                      (select count(*) from storage.objects
                        where bucket_id = 'course-materials' and name = %L)::text$q$, v_os, v_os),
    '0/0');
  perform testhelp.blocked('and a second withdrawal has nothing left to withdraw', v_admin,
    format($q$select public.remove_course_material(%L)$q$, v_cs202));

  perform testhelp.allows('the lecturer withdraws their own handout', v_carol,
    format($q$select public.remove_course_material((select id from public.course_materials
                                                    where storage_path = %L))$q$, v_slides),
    format($q$select count(*)::text from public.course_materials where storage_path = %L$q$, v_slides),
    '0');
end
$body$;

-- ---------------------------------------------------------------------------
-- 18. Student ID cards (0017)
-- ---------------------------------------------------------------------------
-- A card is the one document in this portal a stranger may end up reading off a
-- lanyard, so the record has to be more than the picture: a code, a session and a
-- revocation. Everything below is written from the office side and read from the
-- student side, and nothing at all is writable by a client.
do $body$
declare
  v_admin   uuid := '00000000-0000-0000-0000-0000000000a1';
  v_carol   uuid := '00000000-0000-0000-0000-0000000000b0';
  v_bob     uuid := '00000000-0000-0000-0000-0000000000c0';
  v_dave    uuid := '00000000-0000-0000-0000-0000000000d0';
  v_session uuid := '00000000-0000-0000-0000-0000000000a6';
  v_photo   text;
  v_shop    text;
  v_code1   text;
  v_code2   text;
begin
  v_photo := v_bob::text || '/photo.png';
  v_shop  := v_bob::text || '/print-shop.jpg';

  perform testhelp.sees('a student with no card is shown an empty page', v_bob,
    format($q$select count(*) from public.student_id_cards where student_id = %L$q$, v_bob), 0);

  perform testhelp.blocked('a lecturer cannot issue a card', v_carol,
    format($q$select public.issue_student_id_card(%L)$q$, v_bob));
  perform testhelp.blocked('a student cannot issue themselves one', v_bob,
    format($q$select public.issue_student_id_card(%L)$q$, v_bob));
  perform testhelp.blocked('no client may write a card row by hand', v_admin,
    format($q$insert into public.student_id_cards (student_id, verification_code, valid_until)
            values (%L, 'DEADBEEF', current_date + 30)$q$, v_bob));
  perform testhelp.blocked('a card is not issued to a lecturer', v_admin,
    format($q$select public.issue_student_id_card(%L)$q$, v_carol));

  perform testhelp.truth('the active session is what the card will claim', v_admin,
    $q$select public.current_academic_session() ->> 'label' = '2025/2026'$q$);
  perform testhelp.truth('and a school with no active session gets nothing to claim', v_dave,
    $q$select public.current_academic_session() is null$q$);

  perform testhelp.allows('the office issues a card', v_admin,
    format($q$select public.issue_student_id_card(%L)$q$, v_bob),
    format($q$select status || '/' || (verification_code ~ '^[0-9A-F]{8}$')::text || '/' ||
                  (valid_until = (select end_date from public.academic_sessions where id = %L))::text || '/' ||
                  session_label
       from public.student_id_cards where student_id = %L and status = 'ISSUED'$q$, v_session, v_bob),
    'ISSUED/true/true/2025/2026');

  select verification_code into v_code1
    from public.student_id_cards where student_id = v_bob and status = 'ISSUED';

  perform testhelp.sees('the student sees their own card', v_bob,
    format($q$select count(*) from public.student_id_cards where student_id = %L$q$, v_bob), 1);
  perform testhelp.sees('their office sees it', v_admin,
    format($q$select count(*) from public.student_id_cards where student_id = %L$q$, v_bob), 1);
  -- A teaching role is not a reason to browse the class's identity documents.
  perform testhelp.sees('their lecturer does not', v_carol,
    format($q$select count(*) from public.student_id_cards where student_id = %L$q$, v_bob), 0);
  perform testhelp.sees('and neither does another school''s administrator', v_dave,
    format($q$select count(*) from public.student_id_cards where student_id = %L$q$, v_bob), 0);

  perform testhelp.truth('the card verifies at the gate', v_admin,
    format($q$select public.verify_id_card(%L) -> 'holder' ->> 'lastName' = 'Bo'
             and public.verify_id_card(%L) -> 'holder' ->> 'role' = 'STUDENT'
             and (public.verify_id_card(%L) ->> 'status') = 'ISSUED'
             and (public.verify_id_card(%L) ->> 'isExpired')::boolean is false$q$,
           v_code1, v_code1, v_code1, v_code1));
  perform testhelp.blocked('a student cannot check cards', v_bob,
    format($q$select public.verify_id_card(%L)$q$, v_code1));
  perform testhelp.blocked('nor can an administrator at another school', v_dave,
    format($q$select public.verify_id_card(%L)$q$, v_code1));
  perform testhelp.blocked('an unknown number has no holder', v_admin,
    $q$select public.verify_id_card('DEADBEEF')$q$);

  -- The picture follows the person, not the badge.
  perform testhelp.allows('the student uploads their own picture', v_bob,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('id-card-photos', %L, %L)$q$, v_photo, v_bob),
    format($q$select count(*)::text from storage.objects
            where bucket_id = 'id-card-photos' and name = %L$q$, v_photo),
    '1');
  perform testhelp.blocked('but not into another student''s folder', v_bob,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('id-card-photos', %L, %L)$q$, (v_carol::text || '/someone.png'), v_bob));
  perform testhelp.blocked('nor may an administrator from another school plant one', v_dave,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('id-card-photos', %L, %L)$q$, (v_bob::text || '/planted.png'), v_dave));
  perform testhelp.sees('the student reads back their own picture', v_bob,
    format($q$select count(*) from storage.objects
            where bucket_id = 'id-card-photos' and name = %L$q$, v_photo), 1);
  perform testhelp.sees('their lecturer cannot read it', v_carol,
    format($q$select count(*) from storage.objects
            where bucket_id = 'id-card-photos' and name = %L$q$, v_photo), 0);

  perform testhelp.blocked('a card cannot be issued with someone else''s photo', v_admin,
    format($q$select public.issue_student_id_card(%L, %L)$q$, v_bob, (v_carol::text || '/someone.png')));
  perform testhelp.blocked('nor with a photo that was never uploaded', v_admin,
    format($q$select public.issue_student_id_card(%L, %L)$q$, v_bob, (v_bob::text || '/missing.png')));

  perform testhelp.allows('the office can file a print-shop photo for a student', v_admin,
    format($q$insert into storage.objects (bucket_id, name, owner)
            values ('id-card-photos', %L, %L)$q$, v_shop, v_admin),
    format($q$select count(*)::text from storage.objects
            where bucket_id = 'id-card-photos' and name = %L$q$, v_shop),
    '1');

  -- Replacing a damaged card retires the old one in the same call: two live cards
  -- for one person is how a gate stops meaning anything.
  perform testhelp.allows('a replacement card retires the one it replaces', v_admin,
    format($q$select public.issue_student_id_card(%L, %L)$q$, v_bob, v_shop),
    format($q$select (select count(*) from public.student_id_cards where student_id = %L)::text || '/' ||
                      (select count(*) from public.student_id_cards
                        where student_id = %L and status = 'ISSUED')::text || '/' ||
                      (select photo_path from public.student_id_cards
                        where student_id = %L and status = 'ISSUED')$q$, v_bob, v_bob, v_bob),
    '2/1/' || v_shop);

  select verification_code into v_code2
    from public.student_id_cards where student_id = v_bob and status = 'ISSUED';

  perform testhelp.truth('the retired number verifies as revoked', v_admin,
    format($q$select (public.verify_id_card(%L) ->> 'status') = 'REVOKED'
             and public.verify_id_card(%L) ->> 'revokedAt' is not null$q$, v_code1, v_code1));
  perform testhelp.truth('the new number verifies as live', v_admin,
    format($q$select (public.verify_id_card(%L) ->> 'status') = 'ISSUED'$q$, v_code2));

  perform testhelp.allows('the office withdraws the live card', v_admin,
    format($q$select public.revoke_student_id_card(id, %L)
             from public.student_id_cards where student_id = %L and status = 'ISSUED'$q$,
      'Left on a bus', v_bob),
    format($q$select status || '/' || (revoked_at is not null)::text
       from public.student_id_cards where verification_code = %L$q$, v_code2),
    'REVOKED/true');
  perform testhelp.blocked('withdrawing it twice is not a thing that happened', v_admin,
    format($q$select public.revoke_student_id_card(id, null)
             from public.student_id_cards where verification_code = %L$q$, v_code2));
  perform testhelp.blocked('a student cannot withdraw their own card', v_bob,
    format($q$select public.revoke_student_id_card(id, null)
             from public.student_id_cards where verification_code = %L$q$, v_code2));
  perform testhelp.blocked('a withdrawn card cannot be reinstated by hand', v_admin,
    format($q$update public.student_id_cards set status = 'ISSUED' where verification_code = %L$q$, v_code2));

  perform testhelp.truth('no live card is left for the withdrawn number', v_admin,
    format($q$select (public.verify_id_card(%L) ->> 'status') = 'REVOKED'$q$, v_code2));
  perform testhelp.truth('the student is told the card is ready, then told it is gone', v_bob,
    format($q$select (select count(*) from public.notifications
                       where recipient_id = %L and title = 'Your student ID card is ready') = 2
             and (select count(*) from public.notifications
                       where recipient_id = %L
                         and title = 'Your student ID card has been withdrawn') = 1$q$,
           v_bob, v_bob));
end
$body$;

-- ---------------------------------------------------------------------------
-- 19. The audit trail an administrator now reads page by page (0003, 0018, 0019)
-- ---------------------------------------------------------------------------
-- Until Phase 5 the trail had one reader: a dashboard tab that fetched 25 rows
-- and searched them in the browser. It is now a filtered, paged page, which puts
-- three things under test that the old shape never exercised - tenancy under a
-- filter, the newest-first ordering the cursor pages backwards through, and the
-- actor name the page embeds beside each row. The index migration must not move
-- any of those boundaries, so every read below is the query the page sends.
do $body$
declare
  v_admin uuid := '00000000-0000-0000-0000-0000000000a1';
  v_carol uuid := '00000000-0000-0000-0000-0000000000b0';
  v_bob   uuid := '00000000-0000-0000-0000-0000000000c0';
  v_dave  uuid := '00000000-0000-0000-0000-0000000000d0';
  v_pin   uuid;
  v_riv   uuid;
  v_mine  bigint;
  v_riverside bigint;
begin
  select tenant_id into v_pin from public.profiles where id = v_admin;
  select tenant_id into v_riv from public.profiles where id = v_dave;

  -- Write something as the other school's office, so a cross-tenant assertion
  -- below cannot pass simply because riverside has no history at all.
  perform testhelp.allows('a write by the other school''s office leaves a row in its own trail', v_dave,
    format($q$update public.profiles set phone = %L where id = %L$q$, '+234799900001', v_dave),
    format($q$select ((select count(*) from public.audit_logs where tenant_id = %L) > 0)::text$q$, v_riv),
    'true');

  select count(*) into v_mine from public.audit_logs where tenant_id = v_pin;
  select count(*) into v_riverside from public.audit_logs where tenant_id = v_riv;

  perform testhelp.sees('the office reads its school''s whole trail', v_admin,
    format($q$select count(*) from public.audit_logs where tenant_id = %L$q$, v_pin), v_mine);
  perform testhelp.sees('a teacher who opens the audit page is shown nothing', v_carol,
    $q$select count(*) from public.audit_logs$q$, 0);
  perform testhelp.sees('a student is shown nothing', v_bob,
    $q$select count(*) from public.audit_logs$q$, 0);
  perform testhelp.sees('and neither is the anonymous key', null,
    $q$select count(*) from public.audit_logs$q$, 0);

  -- The two schools now both have rows, so the next pair measures the policy
  -- rather than the fixtures.
  perform testhelp.sees('the other school''s office sees only its own rows', v_dave,
    $q$select count(*) from public.audit_logs$q$, v_riverside);
  perform testhelp.sees('no filter opens the other school''s history to it', v_dave,
    format($q$select count(*) from public.audit_logs where tenant_id = %L$q$, v_pin), 0);

  -- What the page actually sends: newest first, then a page of 25, then a table
  -- filter on top. Each is counted against the same school, so a widening policy
  -- would show up as a number that does not match.
  perform testhelp.sees('the first page is the newest rows, capped at the page size', v_admin,
    $q$select count(*) from (select 1 from public.audit_logs order by created_at desc limit 25) q$q$,
    least(v_mine, 25));
  perform testhelp.sees('filtering that page by table keeps it inside the school', v_admin,
    format($q$select count(*) from public.audit_logs where entity = 'profiles' and tenant_id = %L$q$, v_pin),
    (select count(*) from public.audit_logs where entity = 'profiles' and tenant_id = v_pin));

  -- Every row the office can read has to name the person who made it, or the
  -- trail is a list of anonymous changes. This is the assertion that found
  -- 0019: two rows recorded the creation of riverside accounts under pinnacle's
  -- tenant, where pinnacle's own RLS cannot join the actor profile - so the row
  -- was unreadable by the school that owns it and unnamed for the school that
  -- could see it.
  perform testhelp.sees('the office can name the actor behind every row it reads', v_admin,
    $q$select count(*) from public.audit_logs a
       left join public.profiles p on p.id = a.actor_id
      where a.actor_id is not null and p.id is null$q$, 0);

  -- 0018 is an index migration, so the assertion that matters is that the page's
  -- ordering got an index to walk and the tenancy boundary is untouched. The
  -- comparison is case-insensitive because the catalog prints the direction
  -- upper-case, whatever the creating statement said.
  perform testhelp.truth('and the two indexes the page orders by are the ones that landed', v_admin,
    $q$select (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'audit_logs_tenant_recent_idx')
               ilike '%(tenant_id, created_at desc)%'
        and (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'audit_logs_tenant_entity_idx')
               ilike '%(tenant_id, entity, created_at desc)%'$q$);

  -- 0019, the half that matters going forward: handle_new_auth_user() used to
  -- resolve the tenant from a hardcoded slug, so the INSERT record of a second
  -- school's student was filed in the first school's trail and only the
  -- following UPDATE was correct. The founding record of an account riverside
  -- owns must be born in riverside's history.
  perform testhelp.allows('a second school''s student is filed in its own trail from the first record', v_dave,
    $q$select public.create_school_user('Nina','Cross','nina@riverside.test','STUDENT')$q$,
    $q$select (a.tenant_id = (select id from public.tenants where slug = 'riverside-college'))::text
       from public.audit_logs a
      where a.entity = 'profiles' and a.action = 'insert'
        and a.entity_id = (select id::text from public.profiles where email = 'nina@riverside.test')$q$,
    'true');

  -- A fresh database can no longer produce the row the repair looks for, which
  -- would leave that statement untested and free to rot. So break a creation
  -- record the way the old function did, run the update 0019 runs, read it back.
  perform testhelp.direct('a creation record pushed out of its school reads back out of it',
    format($q$update public.audit_logs set tenant_id = %L
              where entity = 'profiles' and action = 'insert'
                and entity_id = (select id::text from public.profiles where email = 'nina@riverside.test')$q$, v_pin),
    format($q$select (a.tenant_id = %L)::text from public.audit_logs a
              where a.entity = 'profiles' and a.action = 'insert'
                and a.entity_id = (select id::text from public.profiles where email = 'nina@riverside.test')$q$, v_pin),
    'true');

  perform testhelp.direct('and the repair statement moves it home',
    $q$update public.audit_logs a set tenant_id = creator.tenant_id
        from public.profiles row_profile, public.profiles creator
       where a.entity = 'profiles' and a.action = 'insert'
         and creator.id = a.actor_id
         and row_profile.id::text = a.entity_id
         and row_profile.tenant_id = creator.tenant_id
         and a.tenant_id is distinct from creator.tenant_id$q$,
    format($q$select (a.tenant_id = %L)::text from public.audit_logs a
              where a.entity = 'profiles' and a.action = 'insert'
                and a.entity_id = (select id::text from public.profiles where email = 'nina@riverside.test')$q$, v_riv),
    'true');

  -- And the invariant the repair enforces, stated precisely. "An audit row
  -- disagrees with its profile today" is NOT the defect: the trail logs what the
  -- row said when it was written, so a record of an account that later moved
  -- schools belongs where it was born. The signature is narrower - a creation
  -- record filed in a third school while both its creator and its account sit in
  -- one school. A fresh database cannot produce it once the function is fixed,
  -- which is why this checks the shape rather than counting repaired rows.
  perform testhelp.direct('no creation record is filed outside the school that made the account',
    $q$select 1$q$,
    $q$select ((select count(*) from public.audit_logs a
                  join public.profiles made on made.id::text = a.entity_id
                  join public.profiles maker on maker.id = a.actor_id
                 where a.entity = 'profiles' and a.action = 'insert'
                   and made.tenant_id = maker.tenant_id
                   and a.tenant_id is distinct from maker.tenant_id) = 0)::text$q$,
    'true');

  -- The coalesce has a second branch. GoTrue's own sign-up carries no claim, so
  -- auth_tenant_id() is null there and the account must still land in the school
  -- the deployment boots with - not in nothing.
  perform testhelp.direct('a claim-less sign-up still lands in the default school',
    $q$insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values ('00000000-0000-0000-0000-0000000000e9','authenticated','authenticated','walk-in@example.com','x',now(),
               '{"firstName":"Walk","lastName":"In"}')$q$,
    $q$select (p.tenant_id = (select id from public.tenants where slug = 'pinnacle-school')
              and p.role = 'STUDENT')::text
       from public.profiles p where p.email = 'walk-in@example.com'$q$,
    'true');
end
$body$;

-- ---------------------------------------------------------------------------
-- 20. TRUNCATE belongs to nobody at the edge (0014)
-- ---------------------------------------------------------------------------
-- Every section above tests a policy, and a policy is a filter on
-- SELECT/INSERT/UPDATE/DELETE. TRUNCATE is not filtered: Postgres checks the
-- table privilege and then clears the table, tenant and all. Supabase's default
-- privileges hand that privilege to `authenticated` when a migration creates a
-- table, so this is the one hole the rest of the suite is structurally blind
-- to. Section 15 proves a student cannot write to another school's rows; this
-- proves a student cannot erase every school's rows in one statement.
do $body$
declare
  v_bob   uuid := '00000000-0000-0000-0000-0000000000c0';
  v_admin uuid := '00000000-0000-0000-0000-0000000000a1';
  v_riv   uuid := '00000000-0000-0000-0000-0000000000d0';
begin
  -- The catalog check is only worth having if it had tables to look at; an
  -- empty loop over a schema that moved would pass just as happily.
  perform testhelp.truth('and there is a real set of tables to check', v_bob,
    $q$select (select count(*) from pg_class c
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r','p')) > 20$q$);

  perform testhelp.truth('no public table is truncatable by a caller with a session', v_bob,
    $q$select not exists (select 1 from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind in ('r','p')
                             and has_table_privilege('authenticated', c.oid, 'TRUNCATE'))$q$);

  perform testhelp.truth('nor by one with none at all', v_bob,
    $q$select not exists (select 1 from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind in ('r','p')
                             and has_table_privilege('anon', c.oid, 'TRUNCATE'))$q$);

  -- Privileges that let a client build around the tables rather than read them.
  perform testhelp.truth('and a client cannot declare a foreign key or a trigger on them', v_bob,
    $q$select not exists (select 1 from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind in ('r','p')
                             and (has_table_privilege('authenticated', c.oid, 'REFERENCES')
                               or has_table_privilege('authenticated', c.oid, 'TRIGGER')))$q$);

  -- Then the same thing attempted, because a privilege the catalog denies is
  -- only proof if the statement actually fails. Leaf tables on purpose:
  -- truncating one that another table points at fails on the dependency, not
  -- the privilege, which would make all three of these pass for the wrong
  -- reason.
  perform testhelp.blocked('a student who tries to clear the audit trail is refused',
    v_bob, $q$truncate public.audit_logs$q$);
  perform testhelp.blocked('an admin cannot do it either - the right was never in a policy',
    v_admin, $q$truncate public.email_deliveries$q$);
  perform testhelp.blocked('and a second school''s admin gets the same answer',
    v_riv, $q$truncate public.announcement_reads$q$);

  -- The revoke took the destructive rights, not the ones the write policies
  -- deliberately hand out: 0013's compose screen inserts from the browser.
  perform testhelp.truth('the client keeps the rights its policies intend, insert included', v_bob,
    $q$select has_table_privilege('authenticated', 'public.announcements', 'INSERT')
            and has_table_privilege('authenticated', 'public.profiles', 'SELECT')$q$);

  -- A truncate that got through would have left the table empty behind it.
  perform testhelp.direct('and nothing was actually cleared on the way',
    $q$select 1$q$,
    $q$select coalesce(((select count(*) from public.audit_logs) > 0
                      and (select count(*) from public.email_deliveries) > 0
                      and (select count(*) from public.announcement_reads) > 0)::text, '?')$q$,
    'true');
end
$body$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
do $$
declare v_total int; v_failed int; r record;
begin
  select count(*) into v_total from testhelp.results;
  select count(*) into v_failed from testhelp.results where not passed;
  raise notice 'assertions: %   failed: %', v_total, v_failed;
  for r in select label, detail from testhelp.results where not passed order by label loop
    raise notice 'FAILED  %  ->  %', r.label, r.detail;
  end loop;
  if v_failed > 0 then
    raise exception '% of % assertions failed', v_failed, v_total using errcode = 'P0001';
  end if;
end
$$;
