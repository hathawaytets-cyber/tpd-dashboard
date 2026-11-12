#!/usr/bin/env bash
# Applies the migrations to a throwaway local PostgreSQL (with a stub of the
# Supabase auth schema) and runs the RLS tests. Needs PostgreSQL 15+ binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
data="$(mktemp -d)"; sock="$(mktemp -d)"
trap '"$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data" "$sock"' EXIT
"$bin/initdb" -D "$data" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$data" -o "-k $sock -c listen_addresses=''" -w start >/dev/null
psql=(psql -X -q -h "$sock" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$here/auth-stub.sql"
for f in "$here"/../migrations/*.sql; do "${psql[@]}" -f "$f"; done
for t in "$here"/rls.test.sql "$here"/dpe.test.sql; do "${psql[@]}" -At -f "$t"; done
