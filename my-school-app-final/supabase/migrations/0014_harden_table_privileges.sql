-- Take TRUNCATE away from the people who are not supposed to have it.
--
-- A live probe of the hosted project (2026-10-12) found that `authenticated`
-- holds TRUNCATE on 29 public tables. That is not a policy being too generous -
-- it is a privilege that no policy can restrain. Row level security is a filter
-- on SELECT/INSERT/UPDATE/DELETE; TRUNCATE is checked against the table
-- privilege alone and then removes every row in one statement, ignoring the
-- policies entirely. Any signed-in student, on any tenant, could have emptied
-- profiles, course_registrations or grade_books with one call, and the RLS
-- suite would have stayed green the whole time because not one of its
-- assertions tries.
--
-- Supabase's default privileges are the source: a table created by a migration
-- is granted every table right to `authenticated`, not just SELECT. 0010, 0011,
-- 0012 and 0013 each revoked by hand on the tables they added, which is exactly
-- the kind of thing the next migration forgets. This file closes the whole set,
-- and pins the default so future tables arrive without the hole.
--
-- Nothing in the portal truncates a table - PostgREST has no such route and no
-- RPC issues one - so this revokes a right that only a mistake or an attacker
-- would use. service_role keeps everything: it is a server secret, it already
-- bypasses RLS by design, and the webhook and mail worker legitimately write in
-- bulk through it.

---------------------------------------------------------------------------
-- Every table that exists right now
---------------------------------------------------------------------------
-- Anonymously too: a table that grants SELECT to anon still must not be
-- truncatable by a caller with no session at all.
do $$
declare
  r record;
  v_anon int := 0;
  v_auth int := 0;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      r.tablename
    );

    if has_table_privilege('anon', format('public.%I', r.tablename), 'TRUNCATE') then
      v_anon := v_anon + 1;
    end if;
    if has_table_privilege('authenticated', format('public.%I', r.tablename), 'TRUNCATE') then
      v_auth := v_auth + 1;
    end if;
  end loop;

  -- A revoke silently missing its target is the failure mode worth dying on:
  -- a table owned by a role this database has never heard of, or a typo in a
  -- future rename, would leave the hole open and the migration green.
  if v_anon > 0 or v_auth > 0 then
    raise exception
      '% table(s) still truncatable by anon and % by authenticated - '
      'the revoke did not reach them', v_anon, v_auth
      using errcode = '42501';
  end if;
end
$$;

---------------------------------------------------------------------------
-- And every table the next migration creates
--
-- Default privileges are read at CREATE TABLE time, so the loop above cannot
-- cover a table that does not exist yet. Supabase runs migrations as `postgres`
-- and so does the local test harness (apply.sh connects as postgres), which is
-- the role whose defaults matter here.
---------------------------------------------------------------------------
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- The client still gets INSERT/UPDATE/DELETE by default, and this portal's
-- write policies genuinely rely on that: the compose screen inserts an
-- announcement row straight from the browser. Narrowing the default to SELECT
-- would break 0013 and every future screen that writes, so it is left alone -
-- the privilege that RLS cannot guard is the one that had to go.
