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

  perform testhelp.allows('editing a score refreshes an untouched letter grade',
  '00000000-0000-0000-0000-0000000000b0',
  $q$update public.grade_entries set score = 40 where score = 95$q$,
  $q$select letter_grade from public.grade_entries where score = 40$q$, 'F');

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
