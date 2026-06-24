#!/usr/bin/env bash
# CI runner for the auth integration test suite (TypeScript / Vitest).
#
# Requires a running Supabase instance plus the Supabase CLI. In CI the
# supabase-auth-integration job starts Supabase first; locally run `supabase start`
# (or `make up`) first.
#
# Usage:
#   SUPABASE_URL=http://127.0.0.1:54321 \
#   SUPABASE_ANON_KEY=... \
#   SUPABASE_SERVICE_ROLE_KEY=... \
#   bash supabase/tests/run_auth_integration.sh
#
# Without env vars the script falls back to the local dev defaults hard-coded
# in vitest.config.ts (safe for `make up` / `supabase start`).

set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

status="$(supabase status -o env)"
get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\\(.*\\)\"\$/\\1/p"; }

db_url="$(get DB_URL)"
if [ -z "$db_url" ]; then
  echo "Failed to read DB_URL from 'supabase status -o env'" >&2
  exit 1
fi

echo "==> Resetting Supabase DB from migrations + seed..."
supabase db reset

echo "==> Running workflow_classifications reset-path SQL contracts..."
psql "$db_url" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_classifications_reset.sql

cd "${repo_root}/supabase/tests/integration"

echo "==> Installing dependencies..."
npm ci --silent

echo "==> Running auth integration tests..."
npm test

echo ""
echo "==> Auth integration tests: ALL PASSED"
