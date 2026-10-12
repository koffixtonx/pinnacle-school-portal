-- Result workflow and degree statistics. A teacher records grades and submits
-- the book; an administrator approves and publishes it; a student only ever
-- reads a PUBLISHED result, and the GPA and CGPA below are computed from
-- published work alone.

---------------------------------------------------------------------------
-- Grade entry status
---------------------------------------------------------------------------
alter table public.grade_entries add column if not exists status          text    not null default 'DRAFT';
alter table public.grade_entries add column if not exists submitted_at    timestamptz;
alter table public.grade_entries add column if not exists submitted_by_id uuid    references public.profiles (id) on delete set null;
alter table public.grade_entries add column if not exists approved_at     timestamptz;
alter table public.grade_entries add column if not exists approved_by_id  uuid    references public.profiles (id) on delete set null;
alter table public.grade_entries add column if not exists published_at    timestamptz;
alter table public.grade_entries add column if not exists published_by_id uuid    references public.profiles (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where connamespace = 'public'::regnamespace
       and conrelid = 'public.grade_entries'::regclass
       and conname = 'grade_entries_status_check'
  ) then
    alter table public.grade_entries
      add constraint grade_entries_status_check
      check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED'));
  end if;
end;
$$;

create index if not exists grade_entries_tenant_status_idx
  on public.grade_entries (tenant_id, status);
create index if not exists grade_entries_period_status_idx
  on public.grade_entries (grade_period_id, status);

---------------------------------------------------------------------------
-- Workflow transitions
--
-- A grade period is one course's grade book, so the whole book moves together:
-- partial publication would show a student half a semester.
---------------------------------------------------------------------------
create or replace function public.submit_grade_period(p_grade_period_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.grade_periods;
  v_count  integer;
begin
  select * into v_period from public.grade_periods where id = p_grade_period_id;
  if not found or v_period.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Grade period not found';
  end if;

  if not public.is_admin() and not public.teaches_course(v_period.course_id) then
    raise exception 'Only the teacher of % can submit its results', v_period.name
      using hint = 'Ask a school administrator to submit the grade book instead.';
  end if;

  select count(*) into v_count
    from public.grade_entries
   where grade_period_id = v_period.id and status = 'DRAFT';

  if v_count = 0 then
    raise exception 'There are no draft grades to submit for %', v_period.name;
  end if;

  update public.grade_entries
     set status = 'SUBMITTED', submitted_at = now(), submitted_by_id = auth.uid()
   where grade_period_id = v_period.id and status = 'DRAFT';

  return v_count;
end;
$$;

-- Rejecting sends the book back to DRAFT so the teacher can correct it.
create or replace function public.review_grade_period(
  p_grade_period_id uuid,
  p_approve         boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.grade_periods;
  v_count  integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can approve submitted results'
      using hint = 'A teacher submits a grade book; an administrator approves it.';
  end if;

  select * into v_period from public.grade_periods where id = p_grade_period_id;
  if not found or v_period.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Grade period not found';
  end if;

  select count(*) into v_count
    from public.grade_entries
   where grade_period_id = v_period.id and status = 'SUBMITTED';

  if v_count = 0 then
    raise exception 'Nothing has been submitted for % yet', v_period.name;
  end if;

  if p_approve then
    update public.grade_entries
       set status = 'APPROVED', approved_at = now(), approved_by_id = auth.uid()
     where grade_period_id = v_period.id and status = 'SUBMITTED';
  else
    update public.grade_entries
       set status = 'DRAFT', approved_at = null, approved_by_id = null
     where grade_period_id = v_period.id and status = 'SUBMITTED';
  end if;

  return v_count;
end;
$$;

create or replace function public.publish_grade_period(p_grade_period_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.grade_periods;
  v_count  integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can publish results'
      using hint = 'Approved grade books can be published to students.';
  end if;

  select * into v_period from public.grade_periods where id = p_grade_period_id;
  if not found or v_period.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Grade period not found';
  end if;

  select count(*) into v_count
    from public.grade_entries
   where grade_period_id = v_period.id and status = 'APPROVED';

  if v_count = 0 then
    raise exception 'No approved results to publish for %', v_period.name
      using hint = 'Approve the submitted grade book before publishing it.';
  end if;

  update public.grade_entries
     set status = 'PUBLISHED', published_at = now(), published_by_id = auth.uid()
   where grade_period_id = v_period.id and status = 'APPROVED';

  insert into public.notifications (tenant_id, level, category, title, message, sender_id)
  values (
    v_period.tenant_id, 'info', 'system',
    'New results published',
    'Your ' || v_period.name || ' results for ' ||
      (select code || ' - ' || title from public.courses where id = v_period.course_id) ||
      ' are now available.',
    auth.uid()
  );

  return v_count;
end;
$$;

-- A published book is a legal record: it is un-published by an administrator
-- rather than edited underneath the students who already read it.
create or replace function public.guard_grade_entry_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A null auth.uid() is the SQL-editor / service-role path, which seeds and
  -- repairs data; an authenticated caller is bound by the rules below.
  if new.status is distinct from old.status then
    if new.status = 'SUBMITTED' and old.status <> 'DRAFT' then
      raise exception 'This grade book has already been %', lower(old.status)
        using hint = 'Ask an administrator to return it to draft.';
    end if;

    if new.status in ('APPROVED', 'PUBLISHED', 'DRAFT')
       and auth.uid() is not null and not public.is_admin() then
      raise exception 'Only an administrator can approve, publish or reopen a grade book';
    end if;
  end if;

  if old.status in ('SUBMITTED', 'APPROVED', 'PUBLISHED')
     and auth.uid() is not null and not public.is_admin() then
    if new.score is distinct from old.score
       or new.letter_grade is distinct from old.letter_grade
       or new.comments is distinct from old.comments then
      raise exception 'Submitted results cannot be edited'
        using hint = 'Ask an administrator to return the grade book to draft.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_grade_entry_status on public.grade_entries;
create trigger guard_grade_entry_status
  before update on public.grade_entries
  for each row execute function public.guard_grade_entry_status();

---------------------------------------------------------------------------
-- Students read only published results. Teachers and administrators keep the
-- visibility they had in 0003 so a grade book can still be filled in.
---------------------------------------------------------------------------
drop policy if exists grade_entries_read on public.grade_entries;
create policy grade_entries_read on public.grade_entries
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or exists (
        select 1 from public.grade_periods gp
        where gp.id = grade_entries.grade_period_id and public.teaches_course(gp.course_id)
      )
      or (
        grade_entries.status = 'PUBLISHED'
        and exists (
          select 1 from public.enrollments e
          join public.grade_periods gp on gp.id = grade_entries.grade_period_id
          where e.id = grade_entries.enrollment_id
            and e.student_id = auth.uid()
            and gp.course_id = e.course_id
        )
      )
    )
  );

---------------------------------------------------------------------------
-- GPA and CGPA
--
-- A grade period is dated, so the semester it belongs to is the semester whose
-- window contains it. That works for courses an administrator enrolled directly
-- as well as for approved registrations, which is why the calendar - not the
-- registration row - is the join key here.
--
-- These aggregate functions are SECURITY DEFINER, so RLS cannot protect them:
-- each one refuses a caller who is neither the student nor an administrator.
---------------------------------------------------------------------------
create or replace function public.may_read_results(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- A null auth.uid() (the SQL-editor path) has no business reading results
  -- either, which keeps these definer aggregates from leaking across schools.
  select p_student_id is not null
     and (
       p_student_id = auth.uid()
       or (public.is_admin() and exists (
            select 1 from public.profiles p
             where p.id = p_student_id
               and p.tenant_id = public.auth_tenant_id()))
     );
$$;

create or replace function public.published_grades(p_student_id uuid, p_semester_id uuid)
returns table (
  grade_entry_id uuid,
  course_id      uuid,
  course_code    text,
  course_title   text,
  credit_units   integer,
  grade_period   text,
  score          double precision,
  letter_grade   text,
  points         numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select ge.id, c.id, c.code, c.title, c.credit_units, gp.name, ge.score, ge.letter_grade,
         public.grade_points(ge.letter_grade)
    from public.grade_entries ge
    join public.grade_periods gp on gp.id = ge.grade_period_id
    join public.enrollments e    on e.id = ge.enrollment_id and e.student_id = p_student_id
    join public.courses c        on c.id = gp.course_id
    join public.semesters s      on s.id = p_semester_id
   where ge.status = 'PUBLISHED'
     and public.may_read_results(p_student_id)
     and gp.starts_at::date between s.start_date and s.end_date
   order by c.code, gp.name;
$$;

-- Unmatched letters (an imported grade outside the scale) are excluded from
-- both the credit total and the average rather than counted as zero.
create or replace function public.semester_gpa(p_student_id uuid, p_semester_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(sum(public.grade_points(ge.letter_grade) * c.credit_units)
               / nullif(sum(c.credit_units), 0), 2)
    from public.grade_entries ge
    join public.grade_periods gp on gp.id = ge.grade_period_id
    join public.enrollments e    on e.id = ge.enrollment_id and e.student_id = p_student_id
    join public.courses c        on c.id = gp.course_id
    join public.semesters s      on s.id = p_semester_id
   where ge.status = 'PUBLISHED'
     and public.may_read_results(p_student_id)
     and gp.starts_at::date between s.start_date and s.end_date
     and public.grade_points(ge.letter_grade) is not null;
$$;

create or replace function public.semester_credit_units(p_student_id uuid, p_semester_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.credit_units), 0)::integer
    from public.grade_entries ge
    join public.grade_periods gp on gp.id = ge.grade_period_id
    join public.enrollments e    on e.id = ge.enrollment_id and e.student_id = p_student_id
    join public.courses c        on c.id = gp.course_id
    join public.semesters s      on s.id = p_semester_id
   where ge.status = 'PUBLISHED'
     and public.may_read_results(p_student_id)
     and gp.starts_at::date between s.start_date and s.end_date
     and public.grade_points(ge.letter_grade) is not null;
$$;

-- CGPA weights every published semester by its credits, so a light semester
-- cannot distort the cumulative figure.
create or replace function public.student_cgpa(p_student_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(sum(public.grade_points(ge.letter_grade) * c.credit_units)
               / nullif(sum(c.credit_units), 0), 2)
    from public.grade_entries ge
    join public.grade_periods gp on gp.id = ge.grade_period_id
    join public.enrollments e    on e.id = ge.enrollment_id and e.student_id = p_student_id
    join public.courses c        on c.id = gp.course_id
   where ge.status = 'PUBLISHED'
     and public.may_read_results(p_student_id)
     and public.grade_points(ge.letter_grade) is not null;
$$;

create or replace function public.class_of_degree(p_cgpa numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_cgpa is null then null
    when p_cgpa >= 4.50 then 'First Class Honours'
    when p_cgpa >= 3.50 then 'Second Class Upper Division'
    when p_cgpa >= 2.40 then 'Second Class Lower Division'
    when p_cgpa >= 1.50 then 'Third Class'
    when p_cgpa >= 1.20 then 'Pass'
    else 'No Degree Awarded'
  end;
$$;

-- The two calls the Results page and the printable documents make. Both refuse
-- a caller who may not read the student's own record, so the aggregation cannot
-- be used to read another learner's results.
create or replace function public.student_results(p_student_id uuid, p_semester_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.may_read_results(p_student_id) then
    raise exception 'You may only view your own results';
  end if;

  select to_jsonb(o) into v_result
    from (
      select
        (select to_jsonb(s) from public.semesters s where s.id = p_semester_id)          as semester,
        (select to_jsonb(a) from public.academic_sessions a
           where a.id = (select academic_session_id from public.semesters where id = p_semester_id)) as session,
        (select count(*) from public.published_grades(p_student_id, p_semester_id))      as grade_count,
        coalesce(public.semester_gpa(p_student_id, p_semester_id), 0)                     as gpa,
        public.semester_credit_units(p_student_id, p_semester_id)                         as credit_units,
        coalesce(
          jsonb_agg(jsonb_build_object(
            'courseId', g.course_id, 'code', g.course_code, 'title', g.course_title,
            'creditUnits', g.credit_units, 'period', g.grade_period, 'score', g.score,
            'letterGrade', g.letter_grade, 'gradePoints', g.points
          ) order by g.course_code),
          '[]'::jsonb
        ) as courses
        from public.published_grades(p_student_id, p_semester_id) g
    ) o;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.student_transcript(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student public.profiles;
  v_cgpa    numeric;
  v_json    jsonb;
begin
  if not public.may_read_results(p_student_id) then
    raise exception 'You may only view your own results';
  end if;

  select * into v_student from public.profiles where id = p_student_id;
  if not found then
    raise exception 'Student not found';
  end if;

  v_cgpa := public.student_cgpa(p_student_id);

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id, 'firstName', v_student.first_name, 'lastName', v_student.last_name,
      'email', v_student.email, 'level', v_student.student_level,
      'admittedYear', v_student.admitted_year,
      'department', (select d.name from public.departments d where d.id = v_student.department_id),
      'faculty', (select f.name from public.departments d
                    join public.faculties f on f.id = d.faculty_id
                   where d.id = v_student.department_id)
    ),
    'cgpa', coalesce(v_cgpa, 0),
    'classOfDegree', public.class_of_degree(v_cgpa),
    'totalCreditUnits', (
      select coalesce(sum(c.credit_units), 0)::integer
        from public.grade_entries ge
        join public.grade_periods gp on gp.id = ge.grade_period_id
        join public.enrollments e    on e.id = ge.enrollment_id and e.student_id = p_student_id
        join public.courses c        on c.id = gp.course_id
       where ge.status = 'PUBLISHED' and public.grade_points(ge.letter_grade) is not null
    ),
    'semesters', coalesce((
      -- ORDER BY belongs inside jsonb_agg; a query-level sort here would collide
      -- with the aggregate.
      select jsonb_agg(jsonb_build_object(
               'semesterId', s.id,
               'semester', s.name,
               'session', a.name,
               'startDate', s.start_date,
               'endDate', s.end_date,
               'gpa', coalesce(public.semester_gpa(p_student_id, s.id), 0),
               'creditUnits', public.semester_credit_units(p_student_id, s.id),
               'courses', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'code', g.course_code, 'title', g.course_title,
                          'creditUnits', g.credit_units, 'period', g.grade_period,
                          'score', g.score, 'letterGrade', g.letter_grade,
                          'gradePoints', g.points) order by g.course_code)
                   from public.published_grades(p_student_id, s.id) g), '[]'::jsonb)
             ) order by a.start_date, s.number)
        from public.semesters s
        join public.academic_sessions a on a.id = s.academic_session_id
       where s.tenant_id = public.auth_tenant_id()
         and exists (select 1 from public.published_grades(p_student_id, s.id))
    ), '[]'::jsonb)
  ) into v_json;

  return v_json;
end;
$$;

grant execute on function public.set_active_academic_session(uuid),
  public.set_active_semester(uuid), public.register_for_course(uuid),
  public.drop_course_registration(uuid), public.review_course_registration(uuid, boolean, text),
  public.submit_grade_period(uuid), public.review_grade_period(uuid, boolean),
  public.publish_grade_period(uuid), public.student_results(uuid, uuid),
  public.student_transcript(uuid) to authenticated;
