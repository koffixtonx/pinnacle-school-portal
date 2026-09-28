-- Fixtures for the local RLS test suite. Runs as the superuser, i.e. with no
-- request.jwt.claims set, which is the same trusted path as the SQL editor.

insert into public.tenants (name, slug, status)
values ('Riverside College', 'riverside-college', 'ACTIVE')
on conflict (slug) do nothing;

-- GoTrue inserts, so the on_auth_user_created trigger builds each profile.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'alice@example.com',  'x', now(), '{"firstName":"Alice","lastName":"An"}'),
  ('00000000-0000-0000-0000-0000000000b0', 'authenticated', 'authenticated', 'carol@example.com',  'x', now(), '{"firstName":"Carol","lastName":"Ca"}'),
  ('00000000-0000-0000-0000-0000000000c0', 'authenticated', 'authenticated', 'bob@example.com',    'x', now(), '{"firstName":"Bob","lastName":"Bo"}'),
  ('00000000-0000-0000-0000-0000000000d0', 'authenticated', 'authenticated', 'dave@example.com',   'x', now(), '{"firstName":"Dave","lastName":"Da"}');

update public.profiles set role = 'SUPER_ADMIN'       where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'TEACHER'           where id = '00000000-0000-0000-0000-0000000000b0';
update public.profiles set role = 'STUDENT'           where id = '00000000-0000-0000-0000-0000000000c0';
update public.profiles
   set role = 'SCHOOL_ADMIN',
       tenant_id = (select id from public.tenants where slug = 'riverside-college')
 where id = '00000000-0000-0000-0000-0000000000d0';

-- Academic structure for the Pinnacle tenant.
insert into public.faculties (id, tenant_id, name)
values ('00000000-0000-0000-0000-0000000000f1',
        (select id from public.tenants where slug = 'pinnacle-school'), 'Engineering')
on conflict do nothing;

insert into public.departments (id, tenant_id, faculty_id, name, code, confidence, source)
values ('00000000-0000-0000-0000-0000000000e1',
        (select id from public.tenants where slug = 'pinnacle-school'),
        '00000000-0000-0000-0000-0000000000f1', 'Computer Science', 'CS', 1.0, 'manual')
on conflict do nothing;

insert into public.courses (id, tenant_id, department_id, title, code, description, level, credit_units, elective)
values
  ('00000000-0000-0000-0000-0000000000c1',
   (select id from public.tenants where slug = 'pinnacle-school'),
   '00000000-0000-0000-0000-0000000000e1',
   'Databases', 'CS201', 'Relational systems', '200', 6, false),
  ('00000000-0000-0000-0000-0000000000c2',
   (select id from public.tenants where slug = 'pinnacle-school'),
   '00000000-0000-0000-0000-0000000000e1',
   'Operating Systems', 'CS202', 'Processes and memory', '200', 6, true)
on conflict do nothing;

insert into public.course_teachers (course_id, teacher_id)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b0')
on conflict do nothing;

insert into public.class_sections (id, tenant_id, name, grade, homeroom_teacher_id)
values ('00000000-0000-0000-0000-00000000002a',
        (select id from public.tenants where slug = 'pinnacle-school'),
        'Section A', 'Year 2', '00000000-0000-0000-0000-0000000000b0')
on conflict do nothing;

insert into public.class_section_students (section_id, student_id)
values ('00000000-0000-0000-0000-00000000002a', '00000000-0000-0000-0000-0000000000c0')
on conflict do nothing;

insert into public.enrollments (id, tenant_id, student_id, course_id, status)
values ('00000000-0000-0000-0000-000000000031',
        (select id from public.tenants where slug = 'pinnacle-school'),
        '00000000-0000-0000-0000-0000000000c0',
        '00000000-0000-0000-0000-0000000000c1', 'ACTIVE')
on conflict do nothing;

-- Bob is also enrolled in CS202, which Carol does not teach.
insert into public.enrollments (id, tenant_id, student_id, course_id, status)
values ('00000000-0000-0000-0000-000000000032',
        (select id from public.tenants where slug = 'pinnacle-school'),
        '00000000-0000-0000-0000-0000000000c0',
        '00000000-0000-0000-0000-0000000000c2', 'ACTIVE')
on conflict do nothing;

insert into public.grade_periods (id, tenant_id, course_id, name, starts_at, ends_at)
values ('00000000-0000-0000-0000-000000000041',
        (select id from public.tenants where slug = 'pinnacle-school'),
        '00000000-0000-0000-0000-0000000000c1', 'Midterm', now(), now() + interval '30 days'),
       ('00000000-0000-0000-0000-000000000042',
        (select id from public.tenants where slug = 'pinnacle-school'),
        '00000000-0000-0000-0000-0000000000c2', 'Midterm', now(), now() + interval '30 days')
on conflict do nothing;

-- No grade_entries fixture: guard_grade_entry_write() rejects any caller who is
-- neither an admin nor a teacher of the course, so the suite inserts them as Carol.

insert into public.fee_structures (id, tenant_id, name, amount, frequency, active)
values ('00000000-0000-0000-0000-00000000006a',
        (select id from public.tenants where slug = 'pinnacle-school'),
        'Tuition', 4200.00, 'TERM', true)
on conflict do nothing;

insert into public.invoices (id, tenant_id, student_id, issued_by_id, status, due_date, total_amount, paid_amount, reference)
values ('00000000-0000-0000-0000-00000000007a',
        (select id from public.tenants where slug = 'pinnacle-school'),
        '00000000-0000-0000-0000-0000000000c0',
        '00000000-0000-0000-0000-0000000000a1', 'ISSUED', now() + interval '14 days',
        4200.00, 0, 'FIXTURE-1')
on conflict do nothing;

insert into public.invoice_lines (id, invoice_id, description, amount)
values ('00000000-0000-0000-0000-00000000008a', '00000000-0000-0000-0000-00000000007a', 'Tuition', 4200.00)
on conflict do nothing;

insert into public.notifications (id, tenant_id, level, category, title, message, sender_id)
values ('00000000-0000-0000-0000-00000000009a',
        (select id from public.tenants where slug = 'pinnacle-school'),
        'info', 'system', 'Welcome', 'Fixture notification',
        '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

-- Branding objects already in the public bucket.
insert into storage.objects (bucket_id, name, owner)
values ('branding', 'logo.png', '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

-- Riverside gets its own branding row so cross-tenant visibility is measurable.
insert into public.site_settings (tenant_id, primary_color, secondary_color, welcome_message_color)
select id, '#1976D2', '#E91E63', '#FFFFFF'
  from public.tenants where slug = 'riverside-college'
on conflict (tenant_id) do nothing;
