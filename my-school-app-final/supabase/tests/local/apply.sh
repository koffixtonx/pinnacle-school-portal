#!/bin/sh
# Recreate the throwaway test database and apply every migration to it.
# Requires a Postgres server already listening; see README.md.
set -e
export PATH="/usr/lib/postgresql/18/bin:$PATH"

TESTDIR=$(cd "$(dirname "$0")" && pwd)
MIG="$TESTDIR/../../migrations"
PSQL="psql -h ${PGHOST:-/tmp/sbsock} -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"
# One transaction per file, so a failure part-way through leaves the database
# exactly as it was instead of half-migrated — the state that makes the app
# deny every read without any policy to grant them back.
APPLY="$PSQL --single-transaction"

run() {
  label=$1; shift
  out=$("$@" 2>&1) || { printf '%s FAILED\n%s\n' "$label" "$out"; exit 1; }
  # Keep the run quiet unless it said something worth reading — the assertion
  # summary from the test file is the reason this script exists.
  printf '%s ok\n' "$label"
  [ -n "$out" ] && printf '%s\n' "$out"
  return 0
}

$PSQL -c 'drop database if exists sbcheck' -c 'create database sbcheck'
run shim sh -c "$PSQL -d sbcheck -f '$TESTDIR/00_supabase_shim.sql'"
for f in 0001_schema 0002_functions 0003_rls 0004_storage 0005_seed; do
  run "$f" sh -c "$APPLY -d sbcheck -f '$MIG/$f.sql'"
done
# Applied a second time on purpose: re-pasting must be a no-op, because a
# half-pasted migration in the dashboard has to be recoverable by pasting the
# whole file again. 0001 is excluded — `create table` on an existing table must
# fail loudly rather than be papered over with IF NOT EXISTS, and it carries no
# security state, so failing there leaves the database consistent.
for f in 0002_functions 0003_rls 0004_storage 0005_seed; do
  run "re-$f" sh -c "$APPLY -d sbcheck -f '$MIG/$f.sql'"
done
run fixtures sh -c "$PSQL -d sbcheck -f '$TESTDIR/10_fixtures.sql'"
run tests sh -c "$PSQL -d sbcheck -f '$TESTDIR/20_rls_tests.sql'"
