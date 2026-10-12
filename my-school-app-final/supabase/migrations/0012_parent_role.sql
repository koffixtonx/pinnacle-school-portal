-- Parents as a persona of their own.
--
-- A school tells a parent things in one place, so the portal needs somebody for
-- "things a parent should see" to be addressed to. PARENT is a fifth value of the
-- role the whole schema already filters on; `student_guardians` is the link that
-- says whose parent, and it is the only thing a parent may act through: a guardian
-- sees a child's invoices and results, never another family's.
--
-- Nothing here lets a stranger claim a child. Only an administrator writes the
-- link, and only after GoTrue already holds an account for the address.

---------------------------------------------------------------------------
-- The role
---------------------------------------------------------------------------
-- 0001 declared this CHECK inline, so it has a name to drop by. Replacing it is
-- the only way to widen a constraint; Postgres has no ALTER CONSTRAINT.
do $$
begin
  alter table public.profiles drop constraint profile_role_check;
  alter table public.profiles
    add constraint profile_role_check
    check (role in ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'NON_ACADEMIC_STAFF', 'PARENT'));
end
$$;

-- A parent is not a student: the two status columns 0001 defaults for everybody
-- else describe an enrolment that does not exist.
do $$
begin
  alter table public.profiles drop constraint student_status_check;
  alter table public.profiles
    add constraint student_status_check
    check (student_status in ('ACTIVE', 'INACTIVE', 'ON_PROBATION', 'NONE'));

  alter table public.profiles drop constraint student_level_check;
  alter table public.profiles
    add constraint student_level_check
    check (student_level in ('100', '200', '300', '400', '500', 'N/A'));
end
$$;

---------------------------------------------------------------------------
-- Which child
---------------------------------------------------------------------------
create table if not exists public.student_guardians (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  guardian_id  uuid not null references public.profiles (id) on delete cascade,
  relationship text not null default 'Guardian',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One parent linked twice would show the same child twice on their page.
  constraint student_guardians_pair_unique unique (student_id, guardian_id),
  -- Both halves are checked against the caller's tenant by the policies below,
  -- so the only shape left to rule out here is a link that points at itself.
  constraint student_guardians_not_self check (student_id <> guardian_id)
);

-- The page a parent opens is "my children", which is this index read backwards.
create index if not exists student_guardians_guardian_idx
  on public.student_guardians (tenant_id, guardian_id);
create index if not exists student_guardians_student_idx
  on public.student_guardians (tenant_id, student_id);

drop trigger if exists touch_updated_at on public.student_guardians;
create trigger touch_updated_at
  before update on public.student_guardians
  for each row execute function public.touch_updated_at();

---------------------------------------------------------------------------
-- Provisioning and self-service lookups
---------------------------------------------------------------------------
-- Parents are not on the register, so the admin form gives them a role of their
-- own. Every other rule in 0002's version still applies.
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
  if p_role not in ('TEACHER', 'STUDENT', 'NON_ACADEMIC_STAFF', 'PARENT') then
    raise exception 'Provisioned accounts must be TEACHER, STUDENT, NON_ACADEMIC_STAFF or PARENT';
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
    is_sso_user, deleted_at, instance_id
  ) values (
    v_user_id, 'authenticated', 'authenticated', v_email, crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('firstName', p_first_name, 'lastName', p_last_name, 'role', p_role),
    now(), now(), '', '', '', '', '', null, '', '', false, null,
    -- GoTrue scopes every credential lookup to an instance and leaves the column
    -- NULL for a hand-written insert, so a NULL here makes password sign-in fail
    -- with invalid_credentials even though the bcrypt hash itself verifies.
    '00000000-0000-0000-0000-000000000000'::uuid
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
     set role = p_role,
         tenant_id = public.auth_tenant_id(),
         -- A parent has no enrolment, and leaving the student defaults in place
         -- would put them on the student roster and the class lists.
         student_status = case when p_role = 'PARENT' then 'NONE' else student_status end,
         student_level  = case when p_role = 'PARENT' then 'N/A'  else student_level  end
   where id = v_user_id;

  return v_user_id;
end;
$$;

-- A parent is not on the register, so the address is the only handle the form
-- has. The account has to exist first: this links, it does not invent.
create or replace function public.link_guardian(
  p_student_id   uuid,
  p_guardian_email text,
  p_relationship   text default 'Guardian'
)
returns public.student_guardians
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student   public.profiles;
  v_guardian  public.profiles;
  v_email     text := lower(btrim(coalesce(p_guardian_email, '')));
  v_relation  text := initcap(btrim(coalesce(nullif(p_relationship, ''), 'Guardian')));
  v_row       public.student_guardians;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can link a parent to a student'
      using hint = 'A guardian sees the child''s invoices and results.';
  end if;

  select * into v_student from public.profiles where id = p_student_id;
  if not found or v_student.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Student not found';
  end if;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter the parent''s email address properly, for example ada@example.com';
  end if;

  select * into v_guardian from public.profiles where lower(email) = v_email;
  if not found then
    raise exception 'There is no account for % yet', v_email
      using hint = 'Create the parent account first, then link it to the student.';
  end if;

  if v_guardian.tenant_id is distinct from v_student.tenant_id then
    raise exception '% belongs to another school', v_email;
  end if;

  if v_guardian.role <> 'PARENT' then
    raise exception '% is registered as a %, not a parent', v_guardian.first_name, v_guardian.role;
  end if;

  if v_guardian.id = v_student.id then
    raise exception 'A student cannot be their own guardian';
  end if;

  if exists (
    select 1 from public.student_guardians
     where student_id = p_student_id and guardian_id = v_guardian.id
  ) then
    raise exception '% is already linked to %', v_guardian.first_name, v_student.first_name
      using hint = 'One link per parent and child is enough.';
  end if;

  insert into public.student_guardians (tenant_id, student_id, guardian_id, relationship)
  values (v_student.tenant_id, p_student_id, v_guardian.id, v_relation)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.unlink_guardian(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can remove a parent link';
  end if;

  select tenant_id into v_tenant from public.student_guardians where id = p_link_id;
  if not found then
    return false;
  end if;
  if v_tenant is distinct from public.auth_tenant_id() then
    raise exception 'Link not found';
  end if;

  delete from public.student_guardians where id = p_link_id;
  return true;
end;
$$;

---------------------------------------------------------------------------
-- Row level security
---------------------------------------------------------------------------
alter table public.student_guardians enable row level security;

-- The link itself is school business: the parents on it can read their own row,
-- and an administrator reads the whole book.
drop policy if exists guardian_links_read on public.student_guardians;
create policy guardian_links_read on public.student_guardians
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and (public.is_admin() or guardian_id = auth.uid()));

drop policy if exists guardian_links_write on public.student_guardians;
create policy guardian_links_write on public.student_guardians
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists guardian_links_update on public.student_guardians;
create policy guardian_links_update on public.student_guardians
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists guardian_links_delete on public.student_guardians;
create policy guardian_links_delete on public.student_guardians
  for delete to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin());

-- A parent is the one persona the tenant-wide read was never meant to cover:
-- they are outside the school but hold an account in it. Every other role keeps
-- the read 0003 gave it, so only the last branch is new behaviour.
drop policy if exists profiles_read_same_tenant on public.profiles;
create policy profiles_read_same_tenant on public.profiles
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.auth_role() <> 'PARENT'
      or id = auth.uid()
      or exists (
        select 1 from public.student_guardians sg
         where sg.student_id = profiles.id and sg.guardian_id = auth.uid()
      )
    )
  );

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
grant select on public.student_guardians to authenticated;
-- 0003 hands select on every table in the schema to `anon`, and re-applying it
-- after this file would do so again. Which family a child belongs to is not
-- public data, and the write policies below are for administrators only.
revoke all on public.student_guardians from anon;
-- On hosted Supabase a new table reaches `authenticated` with every table right,
-- not just SELECT. The policies already refuse a client write, but the only
-- honest door to this table is link_guardian()/unlink_guardian(), which run as
-- their owner - so the client is left to read.
revoke insert, update, delete, truncate, references, trigger
  on public.student_guardians from authenticated;
grant execute on function public.link_guardian(uuid, text, text) to authenticated;
grant execute on function public.unlink_guardian(uuid) to authenticated;
-- Supabase's default privileges hand EXECUTE on a new function to the PUBLIC
-- pseudo-role, which anon inherits, so the revoke has to name public.
revoke all on function public.link_guardian(uuid, text, text) from public, anon;
revoke all on function public.unlink_guardian(uuid) from public, anon;
