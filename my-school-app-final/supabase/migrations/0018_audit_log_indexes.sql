-- Make the audit trail readable at the volume it reaches.
--
-- 0001 put one index on audit_logs - `(tenant_id)` - which was enough while the
-- only reader was a dashboard tab that fetched 25 rows and searched them in the
-- browser. Phase 5 gives administrators a real page: filter by table, by action,
-- by person, by date, then page backwards through time. Every one of those
-- queries ends in `order by created_at desc`, and with a tenant-only index
-- Postgres reads the school's whole history and sorts it each time. The audit
-- trail is the one table in this schema that only ever grows, so the cost moves
-- in the wrong direction: the longer the school runs, the slower the page that
-- exists to catch misuse.
--
-- Two indexes, in the order the page actually asks for rows. `(tenant_id, action
-- …)` is deliberately not added: an audit write fires on every guarded table, and
-- a third index taxes the insert path of thirteen tables to speed a filter nobody
-- has asked for yet.
--
-- Idempotent and policy-free on purpose. Nothing here changes who can read a row -
-- `audit_logs_read` (0003) keeps that to a school's own administrators - so the
-- suite re-runs the same persona assertions against a faster plan and must still
-- find zero rows for a student, a teacher and a parent.

---------------------------------------------------------------------------
-- Where the reads land
---------------------------------------------------------------------------
create index if not exists audit_logs_tenant_recent_idx
  on public.audit_logs (tenant_id, created_at desc);

create index if not exists audit_logs_tenant_entity_idx
  on public.audit_logs (tenant_id, entity, created_at desc);

-- The planner only uses an index it believes in. On a table whose statistics are
-- stale - or absent, as they are the first hour after a migration - it will keep
-- seq-scanning an audit trail that has grown to a hundred thousand rows.
analyze public.audit_logs;
