-- Course materials: the files a lecturer puts in front of a class.
--
-- Assignments (0015) collect work; this is the other direction of the same
-- course page - slides, readings, a data set. It is its own table rather than a
-- flag on assignments because a course posts files all semester and sets tasks
-- occasionally, and a learner who drops a task should never lose the readings.
--
-- The same split 0015 uses for submissions applies here: the browser uploads to
-- Storage first, then attach_course_material() writes the row only once the
-- object really exists and really sits under that course's prefix. So the table
-- cannot fill with links to files nobody uploaded, and a lecturer cannot write a
-- row pointing at another school's folder.

---------------------------------------------------------------------------
-- The catalogue
---------------------------------------------------------------------------
create table if not exists public.course_materials (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  course_id     uuid not null references public.courses (id) on delete cascade,
  uploaded_by_id uuid references public.profiles (id) on delete set null,
  title         text not null check (btrim(title) <> ''),
  description   text not null default '',
  -- Free text: one school runs by weeks, another by units, a third by chapter.
  -- A real calendar belongs to 0006, and tying a file to it would make every
  -- upload fail for the schools that do not use that rhythm.
  week_label    text not null default '',
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The materials list is always "this course, newest first".
create index if not exists course_materials_course_idx
  on public.course_materials (course_id, created_at desc);
create index if not exists course_materials_tenant_idx
  on public.course_materials (tenant_id);

drop trigger if exists touch_updated_at on public.course_materials;
create trigger touch_updated_at
  before update on public.course_materials
  for each row execute function public.touch_updated_at();

alter table public.course_materials alter column tenant_id set default public.auth_tenant_id();

---------------------------------------------------------------------------
-- Publishing a file
---------------------------------------------------------------------------
create or replace function public.attach_course_material(
  p_course_id    uuid,
  p_title        text,
  p_storage_path text,
  p_file_name    text,
  p_description  text default null,
  p_week_label   text default null,
  p_mime_type    text default null,
  p_size_bytes   bigint default null
)
returns public.course_materials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses;
  v_row    public.course_materials;
  v_title  text := btrim(coalesce(p_title, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found or v_course.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Course not found';
  end if;

  if not public.is_admin() and not public.teaches_course(p_course_id) then
    raise exception 'Only the teacher of % can put materials on it',
      coalesce(v_course.code, 'that course')
      using hint = 'Ask a school administrator, or the lecturer who runs the course.';
  end if;

  if v_title = '' then
    raise exception 'Give the file a title so the class knows what it is';
  end if;

  -- The first path segment is the course this row belongs to. Anything else -
  -- another course's folder, a bare filename - is refused before it can become a
  -- row, which is what keeps the Storage policies in this file meaningful.
  if p_storage_path is null
     or split_part(coalesce(p_storage_path, ''), '/', 1) <> p_course_id::text then
    raise exception 'That file was not uploaded to this course';
  end if;

  if not exists (
    select 1 from storage.objects
     where bucket_id = 'course-materials' and name = p_storage_path
  ) then
    raise exception 'The file did not finish uploading. Attach it again.';
  end if;

  insert into public.course_materials (
    tenant_id, course_id, uploaded_by_id, title, description, week_label,
    storage_path, file_name, mime_type, size_bytes
  )
  values (
    v_course.tenant_id, p_course_id, auth.uid(), v_title,
    btrim(coalesce(p_description, '')), btrim(coalesce(p_week_label, '')),
    p_storage_path,
    -- Tail of the key when the client did not name it: the display name comes
    -- from the path so a client cannot label a file something it is not.
    coalesce(
      nullif(btrim(coalesce(p_file_name, '')), ''),
      split_part(p_storage_path, '/', array_length(string_to_array(p_storage_path, '/'), 1))
    ),
    nullif(btrim(coalesce(p_mime_type, '')), ''),
    case when p_size_bytes is null then null else greatest(p_size_bytes, 0) end
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Withdrawning a file takes the object with it, so "removed" does not leave a
-- readable blob sitting in the bucket under a name the portal no longer shows.
-- A definer function is also the only place that can delete from storage.objects
-- on a student's behalf without handing out bucket-wide delete rights.
create or replace function public.remove_course_material(p_material_id uuid)
returns public.course_materials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.course_materials;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select * into v_row from public.course_materials where id = p_material_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Material not found';
  end if;

  if not public.is_admin() and not public.teaches_course(v_row.course_id) then
    raise exception 'Only the teacher of a course or an administrator can remove its materials';
  end if;

  delete from storage.objects
   where bucket_id = 'course-materials' and name = v_row.storage_path;

  delete from public.course_materials where id = p_material_id;

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Row level security
---------------------------------------------------------------------------
alter table public.course_materials enable row level security;

-- Everything on a course page is readable by everyone on that course, drafts
-- included - there are no drafts here. A learner on the roll, the lecturer, and
-- the office are the three audiences; a parallel class in another school never
-- sees a row.
drop policy if exists course_materials_read on public.course_materials;
create policy course_materials_read on public.course_materials
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(course_id)
      or public.enrolled_in_course(course_id)
    )
  );

-- The descriptive columns only: a rename or a new week label is a plain write,
-- but moving a file onto another course is not something a client gets to do.
drop policy if exists course_materials_update on public.course_materials;
create policy course_materials_update on public.course_materials
  for update to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(course_id))
  );

-- No insert and no delete policy on purpose: attach_course_material() and
-- remove_course_material() are the only doors, which is what keeps the object
-- and the row from drifting apart.

---------------------------------------------------------------------------
-- Where the files live
---------------------------------------------------------------------------
-- Private: a course reading list is not public interest, and the school pays for
-- the bytes. Downloads go through a signed URL minted for someone who has just
-- passed the policy below.
insert into storage.buckets (id, name, public, file_size_limit)
values ('course-materials', 'course-materials', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- No allowed_mime_types, for the same reason as 0015: slides, scans, zips and
-- spreadsheets are all ordinary, and the size ceiling is the guard that counts.

-- <course_id>/<file>
-- Each policy pairs the role test with 0015's tenant gate, so an administrator
-- from another school cannot browse this bucket for files their school has no
-- claim on.
drop policy if exists course_materials_read_object on storage.objects;
create policy course_materials_read_object on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-materials'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(public.path_uuid(name, 1))
      or public.enrolled_in_course(public.path_uuid(name, 1))
    )
  );

drop policy if exists course_materials_insert_object on storage.objects;
create policy course_materials_insert_object on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (
      public.is_admin()
      or public.teaches_course(public.path_uuid(name, 1))
    )
  );

-- Re-uploading a corrected handout over the same key is a teacher's normal move.
drop policy if exists course_materials_modify_object on storage.objects;
create policy course_materials_modify_object on storage.objects
  for update to authenticated
  using (
    bucket_id = 'course-materials'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(public.path_uuid(name, 1)))
  )
  with check (
    bucket_id = 'course-materials'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
  );

drop policy if exists course_materials_delete_object on storage.objects;
create policy course_materials_delete_object on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and public.course_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (public.is_admin() or public.teaches_course(public.path_uuid(name, 1)))
  );

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, update on public.course_materials to authenticated;

revoke all on public.course_materials from anon;

-- Supabase's default privileges hand `authenticated` every table right on a new
-- table. Insert and delete belong to the two RPCs above; the update a client may
-- issue directly is restricted to the columns named here, which is what makes the
-- course_id and storage_path unmovable without a policy that says so.
revoke insert, delete, truncate, references, trigger on public.course_materials from authenticated;
revoke update on public.course_materials from authenticated;
grant update (title, description, week_label) on public.course_materials to authenticated;

grant execute on function public.attach_course_material(
  uuid, text, text, text, text, text, text, bigint
), public.remove_course_material(uuid) to authenticated;

revoke all on function public.attach_course_material(uuid, text, text, text, text, text, text, bigint) from public, anon;
revoke all on function public.remove_course_material(uuid) from public, anon;
