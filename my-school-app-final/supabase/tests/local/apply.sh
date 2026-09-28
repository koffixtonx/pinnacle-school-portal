#!/bin/sh
# Recreate the throwaway test database and apply every migration to it.
# Requires a Postgres server already listening; see README.md.
set -e
export PATH="/usr/lib/postgresql/18/bin:$PATH"

TESTDIR=$(cd "$(dirname "$0")" && pwd)
MIG="$TESTDIR/../../migrations"
PSQL="psql -h ${PGHOST:-/tmp/sbsock} -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"

run() {
  label=$1; shift
  out=$("$@" 2>&1) || { printf '%s FAILED\n%s\n' "$label" "$out"; exit 1; }
  printf '%s ok\n' "$label"
}

$PSQL -c 'drop database if exists sbcheck' -c 'create database sbcheck'
run shim sh -c "$PSQL -d sbcheck -f '$TESTDIR/00_supabase_shim.sql'"
for f in 0001_schema 0002_functions 0003_rls 0004_storage 0005_seed; do
  run "$f" sh -c "$PSQL -d sbcheck -f '$MIG/$f.sql'"
done
run fixtures sh -c "$PSQL -d sbcheck -f '$TESTDIR/10_fixtures.sql'"
run tests sh -c "$PSQL -d sbcheck -f '$TESTDIR/20_rls_tests.sql'"
