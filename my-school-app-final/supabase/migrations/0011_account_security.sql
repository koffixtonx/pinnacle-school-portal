-- Account safety: matric-number login and two-factor support.
--
-- GoTrue signs people in by email, so a matric number is only a second
-- spelling of the same identity: `resolve_login_email` translates it and the
-- password challenge that follows is the ordinary one.
--
-- The TOTP factors themselves live in GoTrue and are read through
-- `supabase.auth.mfa`, which is the only authority on whether a factor is
-- verified — so nothing about them is duplicated in the database. What this
-- file does fence off is the matric number: only the registry issues one.

---------------------------------------------------------------------------
-- Column
---------------------------------------------------------------------------
alter table public.profiles add column if not exists matric_number text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profile_matric_number_format'
  ) then
    alter table public.profiles
      add constraint profile_matric_number_format
      check (matric_number is null or matric_number ~ '^[A-Z0-9][A-Z0-9/-]{2,31}$');
  end if;
end
$$;

-- Partial because most profiles have no number yet, and unique because two
-- students sharing one number would make matric login ambiguous. A tenant
-- shares its number space with nobody else.
create unique index if not exists profiles_tenant_matric_unique
  on public.profiles (tenant_id, matric_number)
  where matric_number is not null;

---------------------------------------------------------------------------
-- Matric numbers are issued by the school, never claimed by the student
---------------------------------------------------------------------------
create or replace function public.set_student_matric_number(
  p_profile_id    uuid,
  p_matric_number text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.profiles;
  v_duplicate uuid;
  v_matric    text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can issue a matric number'
      using hint = 'Matric numbers are assigned by the registry.';
  end if;

  select * into v_row from public.profiles where id = p_profile_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Profile not found';
  end if;

  v_matric := upper(btrim(coalesce(p_matric_number, '')));
  if v_matric = '' then
    -- Clearing a number is the same write as issuing one, so the checks below
    -- are the only path a matric number ever changes.
    update public.profiles set matric_number = null where id = p_profile_id
      returning * into v_row;
    return v_row;
  end if;

  if v_matric !~ '^[A-Z0-9][A-Z0-9/-]{2,31}$' then
    raise exception '% is not a usable matric number', v_matric
      using hint = 'Use 3 to 32 letters, digits, slashes or dashes, starting with a letter or digit.';
  end if;

  select id into v_duplicate
    from public.profiles
   where tenant_id = v_row.tenant_id and matric_number = v_matric and id <> p_profile_id;
  if v_duplicate is not null then
    raise exception '% has already been issued to another student', v_matric
      using hint = 'Check the register — two students cannot share one number.';
  end if;

  update public.profiles
     set matric_number = v_matric
   where id = p_profile_id
  returning * into v_row;

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Matric number -> login email, for the sign-in and reset forms
---------------------------------------------------------------------------
create or replace function public.resolve_login_email(
  p_matric_number text,
  p_last_name     text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_matric text := upper(btrim(coalesce(p_matric_number, '')));
  v_name   text := lower(btrim(coalesce(p_last_name, '')));
begin
  if v_matric = '' or v_name = '' then
    raise exception 'Enter both your matric number and your surname';
  end if;

  -- Both halves have to match before an address is given up, so a guessed
  -- number on its own does not reveal which account GoTrue would sign in.
  select email into v_email
    from public.profiles
   where matric_number = v_matric
     and lower(btrim(last_name)) = v_name
     and active
     and student_status <> 'INACTIVE'
   limit 1;

  if v_email is null then
    raise exception 'No student matches that matric number and surname'
      using hint = 'Check the number, or sign in with your email address instead.';
  end if;

  return v_email;
end;
$$;

---------------------------------------------------------------------------
-- Keep the self-service profile edit from handing itself a matric number.
-- Replaces the guard defined in 0003 with the same rules plus the new column.
---------------------------------------------------------------------------
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
  new.tenant_id       := old.tenant_id;
  new.role            := old.role;
  new.email           := old.email;
  new.active          := old.active;
  new.student_status  := old.student_status;
  new.student_level   := old.student_level;
  new.admitted_year   := old.admitted_year;
  new.department_id   := old.department_id;
  new.matric_number   := old.matric_number;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
-- resolve_login_email runs before anyone is signed in, so anon needs it; the
-- matric + surname pair is the only thing it will give up.
grant execute on function public.resolve_login_email(text, text) to anon, authenticated;
grant execute on function public.set_student_matric_number(uuid, text) to authenticated;
-- Default privileges reach the PUBLIC pseudo-role, which anon inherits, so the
-- revoke has to name public: only the sign-in lookup is a public path.
revoke all on function public.set_student_matric_number(uuid, text) from public, anon;
