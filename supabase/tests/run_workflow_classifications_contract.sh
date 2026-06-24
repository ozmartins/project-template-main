#!/usr/bin/env bash
# CI runner for workflow_classifications schema contract tests.
#
# Starts a throwaway Postgres container, applies all migrations from scratch
# (mirroring a `supabase db reset`), then runs the contract assertions in
# supabase/tests/workflow_classifications_contract.sql.
#
# Validates:
#   - migration 20260620000300_workflow_classifications.sql produces the
#     expected table shape (columns, NOT NULL constraints)
#   - the domain UNIQUE constraint is enforced
#   - the updated_at trigger fires correctly on UPDATE
#   - the INSERT ... ON CONFLICT (domain) DO UPDATE upsert path works,
#     mirroring the supabase_mutate write path used by the vertical-
#     classification workflow
#
# Usage:
#   bash supabase/tests/run_workflow_classifications_contract.sh
#
# Requires: docker, psql

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTAINER=wfclass-contract-test-$$
DB_PORT=54395
POSTGRES_PASSWORD=testpassword
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${DB_PORT}/postgres"

echo "==> Starting throwaway Postgres container..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB=postgres \
  -p "${DB_PORT}:5432" \
  postgres:15-alpine \
  -c "shared_preload_libraries=" \
  > /dev/null

cleanup() {
  echo "==> Cleaning up container $CONTAINER..."
  docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Waiting for Postgres to be ready..."
for _ in $(seq 1 30); do
  if psql "$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> Creating PostgREST roles..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q << 'SQL'
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create role authenticator noinherit login password 'authenticator';
  grant anon, authenticated, service_role to authenticator;
SQL

echo "==> Applying migrations (full reset path)..."
for f in supabase/migrations/*.sql; do
  echo "    $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo ""
echo "==> Running workflow_classifications contract tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_classifications_contract.sql

echo ""
echo "==> workflow_classifications contract tests: PASSED"
