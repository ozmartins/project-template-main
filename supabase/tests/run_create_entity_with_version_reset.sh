#!/usr/bin/env bash
# Reset-path runner for create_entity_with_version RPC contract tests.
#
# Rebuilds the local Supabase database from scratch via the CLI, then runs the
# existing SQL assertions for the RPC grant/guard semantics against that fresh
# reset state.
#
# Usage:
#   bash supabase/tests/run_create_entity_with_version_reset.sh
#
# Requires: supabase CLI, docker, psql

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

cleanup() {
  supabase stop --workdir . --no-backup > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Ensuring no existing Supabase stack is running..."
supabase stop --workdir . --no-backup > /dev/null 2>&1 || true

echo "==> Starting Supabase..."
supabase start --exclude studio --workdir .

echo "==> Resetting Supabase from scratch..."
supabase db reset --yes --local --workdir .

echo "==> Reading DB connection info from Supabase status..."
status="$(supabase status -o env --workdir .)"
db_url="$(printf '%s\n' "$status" | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"

if [ -z "$db_url" ]; then
  echo "ERROR: could not read DB_URL from 'supabase status -o env'" >&2
  exit 1
fi

echo ""
echo "==> Running create_entity_with_version RPC reset-path contract tests..."
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/rpc_create_entity_with_version.sql

echo ""
echo "==> create_entity_with_version reset-path validation: PASSED"
