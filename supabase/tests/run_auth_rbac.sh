#!/usr/bin/env bash
# CI runner for the auth RBAC contract tests.
#
# Starts a throwaway Supabase Postgres instance via Docker, applies migrations,
# then runs supabase/tests/auth_rbac.sql. Cleans up on exit.
#
# Usage:
#   bash supabase/tests/run_auth_rbac.sh
#
# Requires: docker, psql

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTAINER=auth-rbac-test-$$
DB_PORT=54399
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

echo "==> Creating PostgREST roles (anon, authenticated, service_role, authenticator)..."
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
echo "==> Running auth RBAC contract tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/auth_rbac.sql

echo ""
echo "==> Auth RBAC contract tests: ALL PASSED"
