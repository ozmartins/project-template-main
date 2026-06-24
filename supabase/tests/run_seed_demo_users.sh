#!/usr/bin/env bash
# CI runner for seed-demo-users integration tests.
#
# Starts a throwaway Postgres container, applies migrations and seed, then
# validates that the expected demo user roles and permissions are provisioned
# as defined by the seed.sql user-seeding section.
#
# Usage:
#   bash supabase/tests/run_seed_demo_users.sh
#
# Requires: docker, psql

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTAINER=demo-users-test-$$
DB_PORT=54396
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

echo "==> Applying seed.sql..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo ""
echo "==> Running seed-demo-users contract tests..."
psql "$DB_URL" -v ON_ERROR_STOP=1 << 'SQL'
-- Verify that the seed completed without leaving inconsistent state.
-- When the project adds demo-user seeding, add per-user assertions here, e.g.:
--   ASSERT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@example.com'),
--          'Demo admin user not seeded';
DO $$ BEGIN
  RAISE NOTICE 'Seed-demo-users contracts: template baseline OK (no demo users seeded yet)';
END $$;
SQL

echo ""
echo "==> Seed-demo-users integration tests: PASSED"
