# Local migration tests

The hosted product cannot be tested from a laptop without a live project, so these files
recreate enough of Supabase on a plain Postgres server to run the real migrations and
exercise Row Level Security, the guard triggers and the provisioning function.

`00_supabase_shim.sql` is a stand-in for the platform: it provides the `auth` and `storage`
schemas, the `anon` / `authenticated` roles, the `extensions` schema holding pgcrypto and
`auth.uid()` reading the `request.jwt.claims` GUC the way PostgREST sets it. Nothing in this
directory ships to Supabase - `supabase/migrations/` is the deployment artifact.

## Run it

```bash
# 1. throwaway cluster (any Postgres 15+ will do)
initdb -D ~/.local/share/pinnacle-sbcheck -U postgres --auth=trust
pg_ctl -D ~/.local/share/pinnacle-sbcheck \
       -o "-k /tmp/sbsock -p 55432 -c listen_addresses=''" -l ~/.local/share/pinnacle-sbcheck/server.log start

# 2. drop, migrate, seed fixtures, assert
sh supabase/tests/local/apply.sh
```

`apply.sh` exits non-zero on the first failed assertion and prints `FAILED <label> -> detail`
for each one. Re-running it recreates the `sbcheck` database from scratch, so fixtures stay
deterministic.

## What it covers

| File | Purpose |
| --- | --- |
| `00_supabase_shim.sql` | auth / storage / roles / `request.jwt.claims` |
| `10_fixtures.sql` | two schools, one admin, one teacher, one student per side, plus courses, sections, grades, an invoice and a stored object |
| `20_rls_tests.sql` | persona assertions: provisioning, first-admin bootstrap, tenant isolation, grading rights, fee rollups, branding storage, analytics |

Assertions run as `authenticated` or `anon` with a forged JWT claim, through
`SECURITY INVOKER` helpers - a definer helper would execute as its owner and every RLS check
would pass vacuously.
