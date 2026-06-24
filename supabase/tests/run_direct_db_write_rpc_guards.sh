#!/usr/bin/env bash
# CI runner for direct-DB write-RPC guard contracts.
#
# Starts a throwaway Postgres container, applies migrations, then verifies that
# direct writes to guarded tables fail for anon/authenticated roles, and that
# SECURITY DEFINER RPCs enforce their intended access control.
#
# Usage:
#   bash supabase/tests/run_direct_db_write_rpc_guards.sh
#
# Requires: docker, psql

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTAINER=rpc-guard-test-$$
DB_PORT=54397
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

echo "==> Applying migrations..."
for f in supabase/migrations/*.sql; do
  echo "    $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo ""
echo "==> Running create_entity_with_version RPC guard tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rpc_create_entity_with_version.sql

echo ""
echo "==> Running workflow_execution_steps access-surface tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_execution_steps_surface.sql

echo ""
echo "==> Running workflow execution query surface tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_execution_query_surface.sql

echo ""
echo "==> Running workflow_document_extractions access tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_document_extractions_access.sql

echo ""
echo "==> Running documents direct-write guard tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/documents_write_guard_surface.sql

echo ""
echo "==> Running documents full access-control guard tests (read/write/execute)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/documents_access_guard.sql

echo ""
echo "==> Running workflow definition review surface tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_definition_review_surface.sql

echo ""
echo "==> Direct-DB write-RPC + workflow query + documents guard contracts: PASSED"
