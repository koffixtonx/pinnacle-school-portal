-- A provisioned account used to arrive in the wrong school.

-- Phase 5 gave administrators a page that reads the audit trail and embeds the
-- actor beside each row. Writing the assertion for that embed - "every row the
-- office can read names a person it can see" - found two rows it could not: the
-- trail had recorded a profile the office holds, under a tenant that office
-- cannot read.
--
-- The cause is in `handle_new_auth_user()` (0002:133). It resolved the new
-- profile's tenant from a hardcoded slug:
--
--   select id into v_tenant from public.tenants where slug = 'pinnacle-school';
--
-- That was written when the deployment had one school. With riverside seeded in
-- 0001 an admin of the second school provisioning a student gets: the trigger
-- inserts the profile stamped **pinnacle**, then `create_school_user()` follows
-- with `update profiles set tenant_id = public.auth_tenant_id()` and moves it to
-- riverside. Two audit rows are written for the same account - the `insert`
-- stamped pinnacle, the `update` stamped riverside, because `write_audit_log()`
-- (0002:348) takes the tenant from the row it just recorded.
--
-- So the account briefly belonged to the wrong school, and the trail still says
-- so. Two consequences, both real:
--
--   * riverside's office cannot see the creation of its own students - the
--     founding record of an account it owns is filed in another school's
--     history, where only that school can read it;
--   * the mis-stamped actor is a profile pinnacle's RLS cannot join, so the
--     audit page renders a row with no name against it.
--
-- It is not a policy hole - no one can read a row they should not - it is the
-- opposite: a write lands in the wrong partition. RLS and the guard triggers
-- cannot fix it because `handle_new_auth_user()` is SECURITY DEFINER and runs
-- before any policy is consulted.
--
-- The fix is at the source: take the tenant from the caller when there is one.
-- GoTrue's own sign-up path carries no claim, so `auth_tenant_id()` is null
-- there and a public signup still lands in the default school, exactly as
-- before. An administrator calling through `create_school_user()` has a profile,
-- so the row is stamped correctly the first time and the following update is a
-- no-op on `tenant_id`.
--
-- The repair moves the creation records that were filed in the wrong school. It
-- has to be narrow, because "the audit row disagrees with the profile today" is
-- not the defect. The trail is an immutable log of what the row said when it was
-- written: if an account legitimately moves between schools later, the record of
-- its birth belongs in the school that created it, and rewriting that would
-- falsify history to make a query return zero. So the predicate is the defect's
-- actual signature - a creation record whose creator and whose account both
-- belong to one school, while the record itself sits in another.
--
-- Written as `is distinct from`, so re-running it changes nothing. A freshly
-- built database cannot exhibit it at all once the function above is fixed,
-- which is why the suite asserts the invariant rather than a row count: the
-- repair is for the databases that already have the rows.

---------------------------------------------------------------------------
-- Resolve the tenant from whoever is signing up
---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant    uuid;
  v_default   uuid;
begin
  -- The caller's own school, when the insert is being made on someone's behalf
  -- by an authenticated administrator.
  v_tenant := public.auth_tenant_id();

  if v_tenant is null then
    -- GoTrue's own sign-up (public registration) carries no user claim at all.
    -- Fall back to the school the deployment boots with.
    select id into v_default from public.tenants where slug = 'pinnacle-school' limit 1;
    if v_default is null then
      raise exception 'No default tenant configured';
    end if;
    v_tenant := v_default;
  end if;

  -- The role is deliberately NOT read from raw_user_meta_data: anyone holding
  -- the anon key can pass arbitrary metadata to signUp(). Public sign-ups are
  -- students, and create_school_user() promotes the profile it provisions.
  insert into public.profiles (id, tenant_id, email, role, first_name, last_name, department_id)
  values (
    new.id,
    v_tenant,
    new.email,
    'STUDENT',
    coalesce(nullif(new.raw_user_meta_data ->> 'firstName', ''), 'New'),
    coalesce(nullif(new.raw_user_meta_data ->> 'lastName', ''), 'User'),
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

---------------------------------------------------------------------------
-- Move the creation records the old body mis-stamped
---------------------------------------------------------------------------
update public.audit_logs a
   set tenant_id = creator.tenant_id
  from public.profiles row_profile,
       public.profiles creator
 where a.entity = 'profiles'
   and a.action = 'insert'
   and creator.id = a.actor_id
   and row_profile.id::text = a.entity_id
   and row_profile.tenant_id = creator.tenant_id
   and a.tenant_id is distinct from creator.tenant_id;
