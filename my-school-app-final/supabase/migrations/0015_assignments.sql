-- Assignments: work a teacher sets for a course, and the submissions it collects.
--
-- The grade book (0001, 0008) records what a semester concluded. An assignment is
-- the other half of the term - something due on a Tuesday that a student hands in
-- and a teacher marks. Its score deliberately does not write into grade_entries:
-- a course has many assignments and one assessment weight, and folding one into
-- the other would move a GPA that nobody approved. A school that wants an
-- assignment in the book enters its own mark on the grades screen.
--
-- Files follow the split 0010 set up for payments. The browser puts the object in
-- Storage under a path that names its own course, assignment and student, and
-- submit_assignment() writes the row only once that object really exists - so a
-- half-uploaded file cannot become a submission, and the path cannot name a course
-- the uploader is not in.

---------------------------------------------------------------------------
-- Two small pieces of vocabulary
---------------------------------------------------------------------------
-- 0002 gave the portal is_admin(), auth_role() and teaches_course(); a student's
-- half of the same question was never asked, because nothing before this needed
-- "is this learner on this course's roll" as a single test.
create or replace function public.enrolled_in_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Only an ACTIVE enrolment counts: a PENDING request should not open the
  -- assignment before the office approves it, and a DROPPED one should not
  -- keep it open.
  select exists (
    select 1 from public.enrollments e
     where e.course_id = p_course_id
       and e.student_id = auth.uid()
       and e.status = 'ACTIVE'
  );
$$;

-- Storage policies need a segment of an object name as a uuid, and a name in any
-- other bucket - 'logo.png', a path an import wrote - would make a bare ::uuid
-- cast abort the whole statement. A policy cannot control the order Postgres
-- evaluates its clauses in, so the cast has to be safe on its own.
create or replace function public.path_uuid(p_name text, p_part integer)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return nullif(split_part(coalesce(p_name, ''), '/', greatest(coalesce(p_part, 1), 1)), '')::uuid;
exception when others then
  return null;
end;
$$;

-- Which school owns a course, from nothing but an object name. is_admin() is true
-- for every school's administrator, so a bucket policy that trusts it alone lets a
-- riverside admin read a pinnacle file out of the shared bucket by listing it.
-- Every storage policy below therefore pairs the role test with this.
create or replace function public.course_tenant_id(p_course_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.courses where id = p_course_id;
$$;

---------------------------------------------------------------------------
-- The task
---------------------------------------------------------------------------
create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  course_id    uuid not null references public.courses (id) on delete cascade,
  created_by_id uuid references public.profiles (id) on delete set null,
  title        text not null check (btrim(title) <> ''),
  instructions text not null default '',
  due_at       timestamptz not null,
  -- Marks are out of `points`, not out of 100, because a 5-point quiz and a
  -- 40% project are both ordinary. Two decimals so a half-mark is expressible.
  points       numeric(6, 2) not null default 10 check (points > 0 and points <= 100),
  status       text not null default 'DRAFT'
    check (status in ('DRAFT', 'PUBLISHED', 'CLOSED')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The screen a student opens is "what is due, soonest first" across their whole
-- roll, which is this index read through their enrolments.
create index if not exists assignments_course_due_idx
  on public.assignments (course_id, due_at);
create index if not exists assignments_tenant_status_idx
  on public.assignments (tenant_id, status);

drop trigger if exists touch_updated_at on public.assignments;
create trigger touch_updated_at
  before update on public.assignments
  for each row execute function public.touch_updated_at();

-- The composer writes a draft straight from the browser, so the row names its own
-- school the way 0013's announcements row does.
alter table public.assignments alter column tenant_id set default public.auth_tenant_id();

---------------------------------------------------------------------------
-- The work handed in
---------------------------------------------------------------------------
create table if not exists public.assignment_submissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  note           text not null default '',
  -- A submission may be a file, a note typed into the box, or both. A purely
  -- written answer is normal in a seminar, so neither column is required.
  file_path      text,
  file_name      text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  -- LATE is recorded rather than refused: a school would rather have the work and
  -- mark it down than lose it, and the rule for what lateness costs is a human's.
  status         text not null default 'SUBMITTED'
    check (status in ('SUBMITTED', 'LATE', 'GRADED')),
  score          numeric(6, 2) check (score is null or (score >= 0 and score <= 100)),
  feedback       text,
  submitted_at   timestamptz not null default now(),
  graded_at      timestamptz,
  graded_by_id   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One answer per person per task; a resubmission updates it.
  constraint assignment_submissions_pair_unique unique (assignment_id, student_id),
  constraint submission_needs_something check (btrim(note) <> '' or file_path is not null)
);

create index if not exists assignment_submissions_assignment_idx
  on public.assignment_submissions (assignment_id, status);
create index if not exists assignment_submissions_student_idx
  on public.assignment_submissions (student_id, submitted_at desc);

drop trigger if exists touch_updated_at on public.assignment_submissions;
create trigger touch_updated_at
  before update on public.assignment_submissions
  for each row execute function public.touch_updated_at();

alter table public.assignment_submissions
  alter column tenant_id set default public.auth_tenant_id();

-- A mark cannot exceed the task, and the task's points are one column away, which
-- is the one rule a check constraint cannot state. Both writers are definer RPCs,
-- so this is also the only thing standing between a hand-edited row and a
-- student with more marks than the course is worth.
create or replace function public.guard_submission_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points numeric;
begin
  if new.score is null then
    return new;
  end if;

  select points into v_points from public.assignments where id = new.assignment_id;
  if v_points is null then
    raise exception 'Submission does not belong to an assignment that exists';
  end if;

  if new.score > v_points then
    raise exception 'A submission cannot score more than the % points it is worth', v_points
      using hint = 'Give the rest of the class the same ceiling, or raise the task''s points.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_submission_score on public.assignment_submissions;
create trigger guard_submission_score
  before insert or update on public.assignment_submissions
  for each row execute function public.guard_submission_score();

---------------------------------------------------------------------------
-- Setting the task
---------------------------------------------------------------------------
-- Publishing is an RPC rather than a column write because the teacher is shown
-- how many students it will reach, and because a draft that "looks" published
-- without a release stamp is the kind of state that gets a class into trouble.
create or replace function public.publish_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        public.assignments;
  v_students   int;
begin
  select * into v_row from public.assignments where id = p_assignment_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Assignment not found';
  end if;

  if not public.is_admin() and not public.teaches_course(v_row.course_id) then
    raise exception 'Only the teacher of % can publish its assignments',
      coalesce((select code from public.courses where id = v_row.course_id), 'that course')
      using hint = 'Ask a school administrator, or the lecturer who runs the course.';
  end if;

  if v_row.status <> 'DRAFT' then
    raise exception 'That assignment has already been published'
      using hint = 'Close it if submissions should stop.';
  end if;

  update public.assignments
     set status = 'PUBLISHED', published_at = now()
   where id = p_assignment_id
  returning * into v_row;

  select count(*) into v_students
    from public.enrollments e
   where e.course_id = v_row.course_id and e.status = 'ACTIVE';

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'publishedAt', v_row.published_at,
    'students', v_students
  );
end;
$$;

-- Closing stops submissions without deleting the record of what was set.
create or replace function public.close_assignment(p_assignment_id uuid)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.assignments;
begin
  select * into v_row from public.assignments where id = p_assignment_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Assignment not found';
  end if;

  if not public.is_admin() and not public.teaches_course(v_row.course_id) then
    raise exception 'Only the teacher of a course can close its assignments';
  end if;

  if v_row.status = 'DRAFT' then
    raise exception 'A draft has not been set yet, so there is nothing to close';
  end if;

  update public.assignments set status = 'CLOSED' where id = p_assignment_id
  returning * into v_row;
  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Handing work in
---------------------------------------------------------------------------
create or replace function public.submit_assignment(
  p_assignment_id uuid,
  p_note          text          default null,
  p_file_path     text          default null,
  p_file_name     text          default null,
  p_file_size     bigint        default null
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments;
  v_row        public.assignment_submissions;
  v_note       text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;
  if not found or v_assignment.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Assignment not found';
  end if;

  if v_assignment.status = 'DRAFT' then
    raise exception 'That assignment has not been set yet';
  end if;
  if v_assignment.status = 'CLOSED' then
    raise exception 'That assignment is closed, so it no longer accepts work';
  end if;

  if not public.enrolled_in_course(v_assignment.course_id) then
    raise exception 'You are not on the roll for that course'
      using hint = 'Register for it, or ask the office about your enrolment.';
  end if;

  if v_note = '' and p_file_path is null then
    raise exception 'Write something or attach a file before handing it in';
  end if;

  -- The path is the student's own folder under the course and assignment this
  -- submission belongs to, and the object has to be there. Without the second
  -- half a client could claim a submission by naming a path it never uploaded.
  if p_file_path is not null then
    if split_part(p_file_path, '/', 1) <> v_assignment.course_id::text
       or split_part(p_file_path, '/', 2) <> v_assignment.id::text
       or split_part(p_file_path, '/', 3) <> auth.uid()::text then
      raise exception 'That file does not belong to this assignment'
        using hint = 'Re-attach it and try again.';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'assignment-submissions' and name = p_file_path) then
      raise exception 'The file did not finish uploading. Attach it again.';
    end if;
  end if;

  select * into v_row from public.assignment_submissions
   where assignment_id = p_assignment_id and student_id = auth.uid();

  if found and v_row.status = 'GRADED' then
    raise exception 'This work has already been marked'
      using hint = 'Speak to your lecturer if the mark is wrong.';
  end if;

  insert into public.assignment_submissions as s (
    tenant_id, assignment_id, student_id, note, file_path, file_name, file_size_bytes,
    status, submitted_at
  )
  values (
    v_assignment.tenant_id, p_assignment_id, auth.uid(), v_note, p_file_path,
    nullif(btrim(coalesce(p_file_name, '')), ''),
    case when p_file_path is null then null else greatest(coalesce(p_file_size, 0), 0) end,
    case when now() > v_assignment.due_at then 'LATE' else 'SUBMITTED' end,
    now()
  )
  on conflict (assignment_id, student_id) do update
     set note           = excluded.note,
         file_path      = coalesce(excluded.file_path, s.file_path),
         file_name      = coalesce(excluded.file_name, s.file_name),
         file_size_bytes = coalesce(excluded.file_size_bytes, s.file_size_bytes),
         status         = excluded.status,
         submitted_at   = excluded.submitted_at
  returning * into v_row;

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Marking
---------------------------------------------------------------------------
create or replace function public.grade_submission(
  p_submission_id uuid,
  p_score         numeric,
  p_feedback      text default null
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.assignment_submissions;
  v_assignment public.assignments;
  v_value      numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if p_score is null then
    raise exception 'Enter the mark to record';
  end if;

  select * into v_submission from public.assignment_submissions where id = p_submission_id;
  if not found or v_submission.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Submission not found';
  end if;

  select * into v_assignment from public.assignments where id = v_submission.assignment_id;

  if not public.is_admin() and not public.teaches_course(v_assignment.course_id) then
    raise exception 'Only the teacher of the course can mark its submissions';
  end if;

  v_value := round(p_score, 2);
  if v_value < 0 then
    raise exception 'A mark cannot be below zero';
  end if;
  -- Checked here as well as in the trigger so the message names the task rather
  -- than the row.
  if v_value > v_assignment.points then
    raise exception '% is more than this assignment is worth', v_value
      -- RAISE's USING options take no substitution, so the ceiling is concatenated.
      using hint = 'The ' || v_assignment.title || ' is out of ' ||
        trim(trailing '.' from trim(to_char(v_assignment.points, 'FM999999.99'))) || ' points.';
  end if;

  update public.assignment_submissions
     set score = v_value,
         feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
         status = 'GRADED',
         graded_at = now(),
         graded_by_id = auth.uid()
   where id = p_submission_id
  returning * into v_submission;

  -- The one bell row this whole flow writes: a mark appearing silently is the
  -- complaint every lecturer has heard.
  insert into public.notifications (tenant_id, level, category, title, message, sender_id, recipient_id)
  values (
    v_submission.tenant_id, 'info', 'academic',
    'Your ' || v_assignment.title || ' has been marked',
    v_assignment.title || ': ' || trim(trailing '.' from trim(to_char(v_value, 'FM999999.99'))) ||
      ' out of ' || trim(trailing '.' from trim(to_char(v_assignment.points, 'FM999999.99'))) || ' points.',
    auth.uid(),
    v_submission.student_id
  );

  return v_submission;
end;
$$;

---------------------------------------------------------------------------
-- The marking screen in one call
---------------------------------------------------------------------------
-- The roll, each person's submission state, and the tally the teacher reads
-- before marking anything. A page made of separate queries would show a roster
-- and a count that disagree while the second one was still in flight.
create or replace function public.assignment_roster(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments;
  v_result     jsonb;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;
  if not found or v_assignment.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Assignment not found';
  end if;

  if not public.is_admin() and not public.teaches_course(v_assignment.course_id) then
    raise exception 'Only the teacher of a course or an administrator can see its roster';
  end if;

  select jsonb_build_object(
    'assignmentId', v_assignment.id,
    'submitted', coalesce(sum(case when s.status in ('SUBMITTED', 'GRADED') then 1 else 0 end), 0),
    'late',      coalesce(sum(case when s.status = 'LATE' then 1 else 0 end), 0),
    'graded',    coalesce(sum(case when s.status = 'GRADED' then 1 else 0 end), 0),
    'missing',   coalesce(sum(case when s.id is null then 1 else 0 end), 0),
    'students', coalesce(jsonb_agg(jsonb_build_object(
      'studentId',  e.student_id,
      'firstName',  p.first_name,
      'lastName',   p.last_name,
      'matricNumber', p.matric_number,
      'submissionId', s.id,
      'status',     s.status,
      'note',       s.note,
      'filePath',   s.file_path,
      'fileName',   s.file_name,
      'fileSizeBytes', s.file_size_bytes,
      'submittedAt', s.submitted_at,
      'score',      s.score,
      'feedback',   s.feedback
    ) order by p.last_name, p.first_name), '[]'::jsonb)
  ) into v_result
    from public.enrollments e
    join public.profiles p on p.id = e.student_id
    left join public.assignment_submissions s
           on s.assignment_id = p_assignment_id and s.student_id = e.student_id
   where e.course_id = v_assignment.course_id and e.status = 'ACTIVE';

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

---------------------------------------------------------------------------
-- Row level security
---------------------------------------------------------------------------
alter table public.assignments            enable row level security;
alter table public.assignment_submissions enable row level security;

-- A learner sees a task once it is set - and keeps seeing it after it closes, so
-- the mark and the wording stay together.
drop policy if exists assignments_read on public.assignments;
create policy assignments_read on public.assignments
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(course_id)
      or (status <> 'DRAFT' and public.enrolled_in_course(course_id))
    )
  );

drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  );

-- The column list below is the whole point of this policy pair: a teacher may
-- reword a draft, and the privileges further down stop the same client from
-- moving a task between courses or publishing it by hand.
drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  );

drop policy if exists assignments_delete on public.assignments;
create policy assignments_delete on public.assignments
  for delete to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  );

-- A submission is readable by the person who wrote it, the teacher of the course
-- and the office - and nothing else. There is no insert, update or delete policy:
-- submit_assignment() and grade_submission() are the only doors, which is what
-- keeps LATE/GRADED state, the score ceiling and the notification from being
-- worked around by a crafted client.
drop policy if exists assignment_submissions_read on public.assignment_submissions;
create policy assignment_submissions_read on public.assignment_submissions
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      student_id = auth.uid()
      or public.is_admin()
      or public.teaches_course(
        (select a.course_id from public.assignments a where a.id = assignment_submissions.assignment_id)
      )
    )
  );

---------------------------------------------------------------------------
-- Where the files live
---------------------------------------------------------------------------
-- Private on purpose. Nothing here renders inline in a page: a download is a
-- signed URL minted for one person who has just passed the policy below, which is
-- the difference between "obscure name" and access control.
insert into storage.buckets (id, name, public, file_size_limit)
values ('assignment-submissions', 'assignment-submissions', false, 20971520)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- No allowed_mime_types: a course will ask for a format nobody predicted, and the
-- size ceiling is the limit that actually protects the school.

-- <course_id>/<assignment_id>/<student_id>/<file>
-- Each policy opens with the same tenant gate: the course named in the key has to
-- be this school's course before any role test is even asked.
drop policy if exists assignment_submissions_read_object on storage.objects;
create policy assignment_submissions_read_object on storage.objects
  for select to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(public.path_uuid(name, 1))
      or (
        public.enrolled_in_course(public.path_uuid(name, 1))
        and public.path_uuid(name, 3) = auth.uid()
      )
    )
  );

-- A student may only put a file in their own folder, and only against a task that
-- is actually open to them.
drop policy if exists assignment_submissions_insert_object on storage.objects;
create policy assignment_submissions_insert_object on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'assignment-submissions'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and public.path_uuid(name, 3) = auth.uid()
    and public.enrolled_in_course(public.path_uuid(name, 1))
    and exists (
      select 1 from public.assignments a
       where a.id = public.path_uuid(name, 2)
         and a.course_id = public.path_uuid(name, 1)
         and a.status = 'PUBLISHED'
    )
  );

-- Replacing an answer re-uploads under a new name; the old object goes with the
-- student's own delete, and the teacher may clear a file for the whole class.
drop policy if exists assignment_submissions_modify_object on storage.objects;
create policy assignment_submissions_modify_object on storage.objects
  for update to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(public.path_uuid(name, 1))
      or public.path_uuid(name, 3) = auth.uid()
    )
  )
  with check (
    bucket_id = 'assignment-submissions'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
  );

drop policy if exists assignment_submissions_delete_object on storage.objects;
create policy assignment_submissions_delete_object on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'assignment-submissions'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(public.path_uuid(name, 1))
      or public.path_uuid(name, 3) = auth.uid()
    )
  );

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select on public.assignment_submissions to authenticated;

revoke all on public.assignments, public.assignment_submissions from anon;

-- Supabase's default privileges hand `authenticated` every table right on a new
-- table. Take back everything the RLS policies above do not intend to allow: the
-- submissions table has no write policy at all, and the assignments table may be
-- edited in four columns only.
revoke insert, update, delete, truncate, references, trigger
  on public.assignment_submissions from authenticated;
revoke update on public.assignments from authenticated;
grant update (title, instructions, due_at, points) on public.assignments to authenticated;

grant execute on function public.enrolled_in_course(uuid),
  public.path_uuid(text, integer), public.course_tenant_id(uuid),
  public.publish_assignment(uuid),
  public.close_assignment(uuid), public.submit_assignment(uuid, text, text, text, bigint),
  public.grade_submission(uuid, numeric, text), public.assignment_roster(uuid) to authenticated;

revoke all on function public.enrolled_in_course(uuid) from public, anon;
revoke all on function public.path_uuid(text, integer) from public, anon;
revoke all on function public.course_tenant_id(uuid) from public, anon;
revoke all on function public.publish_assignment(uuid) from public, anon;
revoke all on function public.close_assignment(uuid) from public, anon;
revoke all on function public.submit_assignment(uuid, text, text, text, bigint) from public, anon;
revoke all on function public.grade_submission(uuid, numeric, text) from public, anon;
revoke all on function public.assignment_roster(uuid) from public, anon;
