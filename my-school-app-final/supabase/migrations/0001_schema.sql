-- Pinnacle University portal — Supabase schema.
-- Mirrors the Prisma models that previously lived in backend/prisma/schema.prisma.
-- Column names are snake_case; the TypeScript layer maps rows to the camelCase
-- shape the React pages already expect.

-- Supabase ships pgcrypto inside the `extensions` schema. Pinning the install
-- there means the SECURITY DEFINER bodies that fix their own search_path can
-- find crypt()/gen_salt() regardless of who ran the migration.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  status     text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profiles extend auth.users. Credentials live in auth.users; everything the
-- portal shows or authorises with lives here.
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  email          text not null unique,
  role           text not null default 'STUDENT',
  first_name     text not null,
  last_name      text not null,
  phone          text,
  active         boolean not null default true,
  student_status text not null default 'ACTIVE',
  admitted_year  int,
  student_level  text not null default '100',
  department_id  uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint profile_role_check check (
    role in ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'NON_ACADEMIC_STAFF')
  ),
  constraint student_status_check check (student_status in ('ACTIVE', 'INACTIVE', 'ON_PROBATION')),
  constraint student_level_check check (student_level in ('100', '200', '300', '400', '500'))
);

create index profiles_tenant_idx on public.profiles (tenant_id);
create index profiles_role_idx on public.profiles (role);

create table public.faculties (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  faculty_id  uuid not null references public.faculties (id) on delete cascade,
  name        text not null,
  code        text not null,
  confidence  text not null default 'unresearched',
  source      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.profiles
  add constraint profiles_department_fk
  foreign key (department_id) references public.departments (id) on delete set null;

create index departments_faculty_idx on public.departments (faculty_id);

create table public.class_sections (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  name                text not null,
  grade               text not null,
  homeroom_teacher_id uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Prisma modelled course teachers as an implicit many-to-many; Postgres needs
-- the join table explicitly so PostgREST can embed it.
create table public.course_teachers (
  course_id  uuid not null,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  primary key (course_id, teacher_id)
);

create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  title         text not null,
  code          text not null,
  description   text not null default '',
  level         text not null default '100',
  credit_units  int,
  semester      int,
  elective      boolean not null default false,
  department_id uuid references public.departments (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, department_id, code)
);

create index courses_tenant_idx on public.courses (tenant_id);
create index courses_department_idx on public.courses (department_id);

alter table public.course_teachers
  add constraint course_teachers_course_fk
  foreign key (course_id) references public.courses (id) on delete cascade;

create table public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  course_id   uuid not null references public.courses (id) on delete cascade,
  status      text not null,
  enrolled_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint enrollment_status_check check (status in ('ACTIVE', 'PENDING', 'REJECTED', 'DROPPED')),
  unique (student_id, course_id)
);

create index enrollments_tenant_idx on public.enrollments (tenant_id);
create index enrollments_course_idx on public.enrollments (course_id);

-- A student's class membership was also an implicit Prisma relation.
create table public.class_section_students (
  section_id uuid not null references public.class_sections (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  primary key (section_id, student_id)
);

create table public.timetable_slots (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  course_id        uuid not null references public.courses (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete cascade,
  teacher_id       uuid not null references public.profiles (id) on delete cascade,
  day_of_week      int not null check (day_of_week between 0 and 6),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  room             text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index timetable_slots_section_idx on public.timetable_slots (class_section_id);
create index timetable_slots_teacher_idx on public.timetable_slots (teacher_id);

create table public.department_timetable_slots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  course_id     uuid not null references public.courses (id) on delete cascade,
  day_of_week   int not null check (day_of_week between 1 and 5),
  start_hour    int not null check (start_hour in (8, 10, 12, 14, 16)),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, day_of_week, start_hour)
);

create table public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  student_id       uuid not null references public.profiles (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete cascade,
  status           text not null,
  recorded_at      timestamptz not null default now(),
  recorded_by_id   uuid references public.profiles (id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  constraint attendance_status_check check (status in ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED'))
);

create index attendance_student_idx on public.attendance_records (student_id);
create index attendance_section_idx on public.attendance_records (class_section_id);

create table public.grade_periods (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, name)
);

create index grade_periods_course_idx on public.grade_periods (course_id);

create table public.grade_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  enrollment_id   uuid not null references public.enrollments (id) on delete cascade,
  grade_period_id uuid not null references public.grade_periods (id) on delete cascade,
  score           double precision not null check (score between 0 and 100),
  letter_grade    text not null,
  comments        text,
  entered_by_id   uuid references public.profiles (id) on delete set null,
  recorded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (enrollment_id, grade_period_id)
);

create table public.fee_structures (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  amount     numeric(14, 2) not null check (amount >= 0),
  frequency  text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  issued_by_id uuid references public.profiles (id) on delete set null,
  status       text not null default 'DRAFT',
  due_date     timestamptz not null,
  total_amount numeric(14, 2) not null check (total_amount >= 0),
  paid_amount  numeric(14, 2) not null default 0 check (paid_amount >= 0),
  reference    text not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint invoice_status_check check (status in ('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'VOID'))
);

create index invoices_student_idx on public.invoices (student_id);
create index invoices_tenant_idx on public.invoices (tenant_id);

create table public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  amount      numeric(14, 2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);

create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  invoice_id     uuid not null references public.invoices (id) on delete cascade,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  paid_at        timestamptz not null default now(),
  amount         numeric(14, 2) not null check (amount > 0),
  method         text not null,
  transaction_id text,
  created_at     timestamptz not null default now(),
  constraint payment_method_check check (method in ('CARD', 'BANK_TRANSFER', 'CASH'))
);

create index payments_invoice_idx on public.payments (invoice_id);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   text not null,
  changed_data text not null default '{}',
  summary     text not null default '',
  created_at  timestamptz not null default now()
);

create index audit_logs_tenant_idx on public.audit_logs (tenant_id);

create table public.bulk_import_jobs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  type            text not null,
  source_name     text not null,
  status          text not null default 'PENDING',
  requested_by_id uuid references public.profiles (id) on delete set null,
  summary         text,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- read_by used to be a single text column on the old Notification model, which
-- meant one user marking a notification read marked it read for everyone.
-- Per-user state now lives in notification_reads.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  level      text not null default 'INFO',
  category   text not null default 'ANNOUNCEMENT',
  title      text not null,
  message    text not null,
  payload    text,
  sender_id  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index notifications_tenant_idx on public.notifications (tenant_id, created_at);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table public.site_settings (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null unique references public.tenants (id) on delete cascade,
  logo_path                  text,
  hero_image_path            text,
  primary_color              text default '#1976D2',
  secondary_color            text,
  widget_config              jsonb not null default '{"announcements":true,"calendar":true,"quickLinks":true}',
  welcome_message            text,
  welcome_message_color      text not null default '#FFFFFF',
  welcome_background_images  jsonb not null default '[]',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
