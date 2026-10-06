#!/bin/sh
# Apply the migrations to a real Supabase project over its direct Postgres
# connection. Run it yourself: it writes to the live database.
#
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres'
#   sh supabase/scripts/apply-live.sh
#
# 6543 is the transaction pooler, 5432 the session pooler; either works here.
# The URL goes in the environment, never in a file that gets committed.
set -e
export PATH="/usr/lib/postgresql/18/bin:$PATH"

if [ -z "$SUPABASE_DB_URL" ]; then
  echo 'Set SUPABASE_DB_URL to the direct connection string (Dashboard > Project Settings > Database > Connection string > Database connection string).'
  exit 1
fi
command -v psql >/dev/null || { echo 'psql is not on PATH (postgres client).'; exit 1; }

MIG=$(cd "$(dirname "$0")" && pwd)/../migrations

# Quoted, so an & or a ? in the connection string stays part of the argument
# instead of being read as shell syntax.
ps() {
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q "$@"
}

run() {
  label=$1; shift
  out=$("$@" 2>&1) || { printf '%s FAILED\n%s\n' "$label" "$out"; exit 1; }
  printf '%s ok\n' "$label"
}

# 0001 is plain `create table`: it cannot be re-run, so detect the applied case
# and step over it instead of failing out before 0002 gets a chance.
applied=$(ps -tAc "select coalesce(to_regclass('public.tenants')::text, '')")
if [ -n "$applied" ]; then
  printf '0001_schema already applied, skipping\n'
else
  # One transaction per file: a failure leaves the database exactly as it was,
  # rather than half-migrated with RLS enabled and no policies to read through.
  run 0001_schema ps --single-transaction -f "$MIG/0001_schema.sql"
fi

for f in 0002_functions 0003_rls 0004_storage 0005_seed; do
  run "$f" ps --single-transaction -f "$MIG/$f.sql"
done

ps -c "notify pgrst, 'reload schema'"

echo
echo 'Live counts (verified locally against the same files: 23 tables, 69 RLS policies, 4 storage policies, 27 functions, 38 triggers):'
ps -P pager=off -c "
  select
    (select count(*) from pg_tables where schemaname = 'public')                as tables,
    (select count(*) from pg_policies where schemaname = 'public')              as rls_policies,
    (select count(*) from pg_policies where schemaname = 'storage')             as storage_policies,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public')                                              as functions,
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal)                        as triggers
"
