#!/usr/bin/env bash
# Applies the migrations to a throwaway local PostgreSQL (with a stub of the
# Supabase auth schema) and runs every *.test.sql file, each in a fresh copy of
# the migrated database. Needs PostgreSQL 15+ binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
data="$(mktemp -d)"; sock="$(mktemp -d)"
trap '"$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data" "$sock"' EXIT
"$bin/initdb" -D "$data" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$data" -o "-k $sock -c listen_addresses=''" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
psql=(psql -X -q -h "$sock" -U postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -d postgres -c "create database tpd_template"
"${psql[@]}" -d tpd_template -f "$here/auth-stub.sql"
for f in "$here"/../migrations/*.sql; do "${psql[@]}" -d tpd_template -f "$f"; done
for t in "$here"/*.test.sql; do
  name="t_$(basename "$t" .test.sql | tr -c 'a-z0-9\n' '_')"
  "${psql[@]}" -d postgres -c "create database $name template tpd_template"
  echo "== $(basename "$t")"
  "${psql[@]}" -d "$name" -At -f "$t"
done
