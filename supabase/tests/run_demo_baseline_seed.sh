#!/usr/bin/env bash
# CI runner for the demo-baseline seed validation.
#
# Starts a throwaway Postgres container, applies all migrations, then runs the
# seed.sql to confirm it applies cleanly from scratch. Mirrors what happens on a
# fresh environment deploy or `supabase db reset`.
#
# Usage:
#   bash supabase/tests/run_demo_baseline_seed.sh
#
# Requires: docker, psql

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CONTAINER=demo-seed-test-$$
DB_PORT=54398
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
echo "==> Applying demo-baseline seed.sql..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql

echo ""
echo "==> Demo-baseline seed validation: PASSED"
