-- Row Level Security. Every policy encodes the same rules the Express
-- middleware (authenticate / authorize / verifyTenantAccess) and the
-- per-controller role checks enforced before this migration.

alter table public.tenants                 enable row level security;
alter table public.profiles                enable row level security;
alter table public.faculties               enable row level security;
alter table public.departments             enable row level security;
alter table public.class_sections          enable row level security;
alter table public.class_section_students  enable row level security;
alter table public.course_teachers         enable row level security;
alter table public.courses                 enable row level security;
alter table public.enrollments             enable row level security;
alter table public.timetable_slots         enable row level security;
alter table public.department_timetable_slots enable row level security;
alter table public.attendance_records      enable row level security;
alter table public.grade_periods           enable row level security;
alter table public.grade_entries           enable row level security;
alter table public.fee_structures          enable row level security;
alter table public.invoices                enable row level security;
alter table public.invoice_lines           enable row level security;
alter table public.payments                enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.bulk_import_jobs        enable row level security;
alter table public.notifications           enable row level security;
alter table public.notification_reads      enable row level security;
alter table public.site_settings           enable row level security;

-- Grants: Supabase roles get no table privileges by default on public schema
-- beyond what the dashboard grants, so state them explicitly.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.profiles, public.faculties, public.departments,
  public.class_sections, public.class_section_students, public.course_teachers, public.courses,
  public.enrollments, public.timetable_slots, public.department_timetable_slots,
  public.attendance_records, public.grade_periods, public.grade_entries, public.fee_structures,
  public.invoices, public.invoice_lines, public.payments, public.bulk_import_jobs,
  public.notifications, public.notification_reads, public.site_settings to authenticated;

---------------------------------------------------------------------------
-- Tenants: the public branding endpoint read the active tenant unauthenticated.
---------------------------------------------------------------------------
drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants
  for select to anon, authenticated
  using (status = 'ACTIVE');

---------------------------------------------------------------------------
-- Profiles
---------------------------------------------------------------------------
drop policy if exists profiles_read_same_tenant on public.profiles;
create policy profiles_read_same_tenant on public.profiles
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

-- Users edit their own name and phone; privileged columns are fenced off by
-- guard_profile_update below. Admins may edit anything in their tenant.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin());

-- No insert policy: profiles rows are created only by handle_new_auth_user()
-- and create_school_user(), both SECURITY DEFINER.

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A request from PostgREST always carries a `sub` claim, so a null auth.uid()
  -- means this is a privileged path (SQL editor, service_role, a GoTrue
  -- trigger). Both UPDATE policies are `to authenticated`, so no client can
  -- reach this branch — and without it the documented first-admin bootstrap
  -- would be silently reverted to STUDENT.
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;

  -- A non-admin editing their own record may only change display fields.
  new.tenant_id      := old.tenant_id;
  new.role           := old.role;
  new.email          := old.email;
  new.active         := old.active;
  new.student_status := old.student_status;
  new.student_level  := old.student_level;
  new.admitted_year  := old.admitted_year;
  new.department_id  := old.department_id;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

---------------------------------------------------------------------------
-- Academic structure: readable by anyone in the tenant, writable by admins.
---------------------------------------------------------------------------
drop policy if exists faculties_read on public.faculties;
create policy faculties_read on public.faculties
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists faculties_write on public.faculties;
create policy faculties_write on public.faculties
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists faculties_update on public.faculties;
create policy faculties_update on public.faculties
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists faculties_delete on public.faculties;
create policy faculties_delete on public.faculties
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists departments_delete on public.departments;
create policy departments_delete on public.departments
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists courses_update on public.courses;
create policy courses_update on public.courses
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists courses_delete on public.courses;
create policy courses_delete on public.courses
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists course_teachers_read on public.course_teachers;
create policy course_teachers_read on public.course_teachers
  for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.tenant_id = public.auth_tenant_id()));
drop policy if exists course_teachers_write on public.course_teachers;
create policy course_teachers_write on public.course_teachers
  for all to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.tenant_id = public.auth_tenant_id()
    )
    and exists (
      select 1 from public.profiles t
      where t.id = teacher_id and t.tenant_id = public.auth_tenant_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.tenant_id = public.auth_tenant_id()
    )
    and exists (
      select 1 from public.profiles t
      where t.id = teacher_id and t.tenant_id = public.auth_tenant_id()
    )
  );

---------------------------------------------------------------------------
-- Enrollments
---------------------------------------------------------------------------
drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or student_id = auth.uid()
      or public.teaches_course(course_id)
    )
  );

-- A student may request their own enrolment; only admins enrol directly.
drop policy if exists enrollments_insert_self on public.enrollments;
create policy enrollments_insert_self on public.enrollments
  for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and student_id = auth.uid()
    and status = 'PENDING'
  );

drop policy if exists enrollments_insert_admin on public.enrollments;
create policy enrollments_insert_admin on public.enrollments
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists enrollments_update on public.enrollments;
create policy enrollments_update on public.enrollments
  for update to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or student_id = auth.uid() or public.teaches_course(course_id))
  )
  with check (tenant_id = public.auth_tenant_id());

-- Students must not be able to approve themselves, and admins must not be able
-- to enrol someone into another tenant's course.
create or replace function public.guard_enrollment_write()
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
    raise exception 'Course does not belong to this tenant';
  end if;

  if not public.is_admin() and new.student_id = auth.uid()
     and new.status not in ('PENDING', 'DROPPED') then
    raise exception 'Students may only request or drop an enrolment';
  end if;

  if tg_op = 'UPDATE' and not public.is_admin()
     and not public.teaches_course(old.course_id)
     and old.student_id = auth.uid()
     and new.status <> old.status
     and new.status not in ('PENDING', 'DROPPED') then
    raise exception 'Students may only request or drop an enrolment';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_enrollment_write on public.enrollments;
create trigger guard_enrollment_write
  before insert or update on public.enrollments
  for each row execute function public.guard_enrollment_write();

drop policy if exists enrollments_delete on public.enrollments;
create policy enrollments_delete on public.enrollments
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

---------------------------------------------------------------------------
-- Class sections
---------------------------------------------------------------------------
drop policy if exists sections_read on public.class_sections;
create policy sections_read on public.class_sections
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists sections_write on public.class_sections;
create policy sections_write on public.class_sections
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists sections_update on public.class_sections;
create policy sections_update on public.class_sections
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists sections_delete on public.class_sections;
create policy sections_delete on public.class_sections
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists section_students_read on public.class_section_students;
create policy section_students_read on public.class_section_students
  for select to authenticated
  using (exists (
    select 1 from public.class_sections s
    where s.id = section_id and s.tenant_id = public.auth_tenant_id()
  ));
drop policy if exists section_students_write on public.class_section_students;
create policy section_students_write on public.class_section_students
  for all to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.class_sections s
      where s.id = section_id and s.tenant_id = public.auth_tenant_id()
    )
    and exists (
      select 1 from public.profiles st
      where st.id = student_id and st.tenant_id = public.auth_tenant_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.class_sections s
      where s.id = section_id and s.tenant_id = public.auth_tenant_id()
    )
    and exists (
      select 1 from public.profiles st
      where st.id = student_id and st.tenant_id = public.auth_tenant_id()
    )
  );

---------------------------------------------------------------------------
-- Timetable
---------------------------------------------------------------------------
drop policy if exists timetable_read on public.timetable_slots;
create policy timetable_read on public.timetable_slots
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists timetable_write on public.timetable_slots;
create policy timetable_write on public.timetable_slots
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists timetable_update on public.timetable_slots;
create policy timetable_update on public.timetable_slots
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists timetable_delete on public.timetable_slots;
create policy timetable_delete on public.timetable_slots
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists dept_timetable_read on public.department_timetable_slots;
create policy dept_timetable_read on public.department_timetable_slots
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists dept_timetable_write on public.department_timetable_slots;
create policy dept_timetable_write on public.department_timetable_slots
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists dept_timetable_delete on public.department_timetable_slots;
create policy dept_timetable_delete on public.department_timetable_slots
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

---------------------------------------------------------------------------
-- Attendance: students see only their own, homeroom teachers only their class.
---------------------------------------------------------------------------
drop policy if exists attendance_read on public.attendance_records;
create policy attendance_read on public.attendance_records
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or student_id = auth.uid() or public.owns_class_section(class_section_id))
  );

drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.owns_class_section(class_section_id))
  );

create or replace function public.guard_attendance_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.class_section_students
    where section_id = new.class_section_id and student_id = new.student_id
  ) then
    raise exception 'Student is not enrolled in this class section';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_attendance_write on public.attendance_records;
create trigger guard_attendance_write
  before insert on public.attendance_records
  for each row execute function public.guard_attendance_write();

drop policy if exists attendance_update on public.attendance_records;
create policy attendance_update on public.attendance_records
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and (public.is_admin() or public.owns_class_section(class_section_id)))
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists attendance_delete on public.attendance_records;
create policy attendance_delete on public.attendance_records
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

---------------------------------------------------------------------------
-- Grades
---------------------------------------------------------------------------
drop policy if exists grade_periods_read on public.grade_periods;
create policy grade_periods_read on public.grade_periods
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(course_id)
      or exists (
        select 1 from public.enrollments e
        where e.course_id = course_id and e.student_id = auth.uid() and e.status = 'ACTIVE'
      )
    )
  );

drop policy if exists grade_periods_insert on public.grade_periods;
create policy grade_periods_insert on public.grade_periods
  for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  );

drop policy if exists grade_periods_delete on public.grade_periods;
create policy grade_periods_delete on public.grade_periods
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists grade_entries_read on public.grade_entries;
create policy grade_entries_read on public.grade_entries
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or exists (
        select 1 from public.enrollments e
        join public.grade_periods gp on gp.id = grade_entries.grade_period_id
        where e.id = grade_entries.enrollment_id
          and e.student_id = auth.uid()
          and gp.course_id = e.course_id
      )
      or exists (
        select 1 from public.grade_periods gp
        where gp.id = grade_entries.grade_period_id and public.teaches_course(gp.course_id)
      )
    )
  );

-- Only the teacher of the course (or an admin) may record a grade, and the
-- grade period must belong to the same course as the enrolment.
create or replace function public.guard_grade_entry_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_course uuid;
  v_enroll_course uuid;
begin
  select course_id into v_period_course from public.grade_periods where id = new.grade_period_id;
  select course_id into v_enroll_course from public.enrollments where id = new.enrollment_id;

  if v_period_course is null then raise exception 'Grade period not found'; end if;
  if v_enroll_course is null then raise exception 'Enrollment not found'; end if;
  if v_period_course <> v_enroll_course then
    raise exception 'Enrollment does not belong to the selected grade period course';
  end if;

  new.entered_by_id := coalesce(auth.uid(), new.entered_by_id);

  if not public.is_admin() and not public.teaches_course(v_period_course) then
    raise exception 'Only teachers or admins can enter grades';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_grade_entry_write on public.grade_entries;
create trigger guard_grade_entry_write
  before insert or update on public.grade_entries
  for each row execute function public.guard_grade_entry_write();

drop policy if exists grade_entries_write on public.grade_entries;
create policy grade_entries_write on public.grade_entries
  for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(
      (select course_id from public.grade_periods gp where gp.id = grade_entries.grade_period_id)
    ))
  );

drop policy if exists grade_entries_update on public.grade_entries;
create policy grade_entries_update on public.grade_entries
  for update to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(
      (select course_id from public.grade_periods gp where gp.id = grade_entries.grade_period_id)
    ))
  )
  with check (tenant_id = public.auth_tenant_id());

---------------------------------------------------------------------------
-- Fees
---------------------------------------------------------------------------
drop policy if exists fee_structures_read on public.fee_structures;
create policy fee_structures_read on public.fee_structures
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists fee_structures_write on public.fee_structures;
create policy fee_structures_write on public.fee_structures
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists fee_structures_update on public.fee_structures;
create policy fee_structures_update on public.fee_structures
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and (public.is_admin() or student_id = auth.uid()));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists invoice_lines_read on public.invoice_lines;
create policy invoice_lines_read on public.invoice_lines
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and (
    (i.tenant_id = public.auth_tenant_id() and public.is_admin()) or i.student_id = auth.uid())));
drop policy if exists invoice_lines_insert on public.invoice_lines;
create policy invoice_lines_insert on public.invoice_lines
  for insert to authenticated
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.tenant_id = public.auth_tenant_id() and public.is_admin()));

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and (public.is_admin() or student_id = auth.uid()));
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

---------------------------------------------------------------------------
-- Audit log, bulk jobs, notifications, settings
---------------------------------------------------------------------------
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs
  for select to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());
-- Writes happen only from the SECURITY DEFINER audit trigger.

drop policy if exists bulk_jobs_read on public.bulk_import_jobs;
create policy bulk_jobs_read on public.bulk_import_jobs
  for select to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists bulk_jobs_write on public.bulk_import_jobs;
create policy bulk_jobs_write on public.bulk_import_jobs
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists bulk_jobs_update on public.bulk_import_jobs;
create policy bulk_jobs_update on public.bulk_import_jobs
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated using (tenant_id = public.auth_tenant_id());
drop policy if exists notifications_write on public.notifications;
create policy notifications_write on public.notifications
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads
  for insert to authenticated with check (user_id = auth.uid());

-- Read unauthenticated: the public welcome page shows branding before login.
drop policy if exists site_settings_read_public on public.site_settings;
create policy site_settings_read_public on public.site_settings
  for select to anon, authenticated using (true);
drop policy if exists site_settings_update_admin on public.site_settings;
create policy site_settings_update_admin on public.site_settings
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());
drop policy if exists site_settings_insert_admin on public.site_settings;
create policy site_settings_insert_admin on public.site_settings
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.is_admin());

-- The old PUT /site-settings/welcome-message was authorize('SUPER_ADMIN').
create or replace function public.guard_site_settings_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    new.welcome_message       := old.welcome_message;
    new.welcome_message_color := old.welcome_message_color;
    new.welcome_background_images := old.welcome_background_images;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_site_settings_update on public.site_settings;
create trigger guard_site_settings_update
  before update on public.site_settings
  for each row execute function public.guard_site_settings_update();
