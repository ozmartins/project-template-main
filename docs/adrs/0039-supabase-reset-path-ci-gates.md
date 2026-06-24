# ADR-0039: Supabase Reset-Path CI Gates

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Schema migrations applied against an evolved development database (one that has been migrated incrementally over many months) can behave differently than the same migrations applied to a fresh schema from scratch. Common failure modes:

- A migration uses `CREATE TABLE` without `IF NOT EXISTS` and succeeds in dev (table already exists from a previous migration) but fails on a clean apply (duplicate table error).
- A FK constraint added in migration N depends on a column added in migration M, but M was merged after N's development started — the dev DB has both, but a fresh apply of N before M fails.
- A seed script inserts rows referencing a `source_record_id` that changed format in a later migration.
- GoTrue's internal FK enforcement (triggered on `supabase db reset`) catches auth-domain constraint violations that bare-Postgres `psql` would not.

These bugs only surface on a full schema reset — the kind of apply that happens when onboarding a new team member, deploying to a fresh environment, or running CI.

## Decision

Every feature migration that adds schema structure (tables, columns, FK constraints, functions, RLS policies, SECURITY DEFINER RPCs, seed rows) must have a matching **reset-path CI gate**: a job in `pr-validation.yml` that:

1. Runs `supabase db reset` (full clean apply of all migrations from scratch, using the Supabase CLI's Docker-managed Postgres + GoTrue stack)
2. Executes SQL contract tests from `supabase/tests/<feature>.sql` against the reset database
3. Exits 0 on pass, non-zero on failure — the job is gating

**The gate runs the full reset** — not just the new migration — because ordering and dependency bugs require the full sequence to manifest.

**Path-scoping:** Reset-path jobs are expensive (each `supabase db reset` takes ~90 seconds). They are skipped on PRs that touch neither `supabase/` nor the reset-path job definitions themselves, using three-dot git diff path-scoping:

```bash
base=$(git merge-base HEAD origin/main)
changed=$(git diff --name-only "$base...HEAD")
if ! echo "$changed" | grep -qE '^(supabase/|temporal/)'; then
  echo "Skipping reset-path: no DB or Temporal changes"
  exit 0
fi
```

This keeps frontend-only PRs at sub-5-minute feedback; DB PRs run the full suite.

**SQL test pattern** (`supabase/tests/<feature>.sql`):
```sql
-- Setup test context
SET LOCAL role TO 'service_role';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Assert: table exists with expected columns
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entity_versions' AND column_name = 'data'
  ), 'entity_versions.data column missing';
END $$;

-- Assert: RLS policy fires correctly
-- ... (set anon role, attempt write, expect failure)

-- Teardown (if test created any rows)
```

**Required reset-path gates (minimum for any project using this template):**
- `supabase/tests/run_demo_baseline_seed.sh` — validates `supabase/seed.sql` applies cleanly after a full reset
- `supabase/tests/run_direct_db_write_rpc_guards.sh` — validates SECURITY DEFINER RPC write guards enforce expected access control
- `supabase/tests/run_seed_demo_users.sh` — validates demo user and role seeding via GoTrue

Each project adds additional gates as features are added. Name them `run_<feature>_reset.sh`.

**Timeout guard:** Every reset-path CI job must set `timeout-minutes: 20`. The Supabase CLI installation can stall if the GitHub API rate limit is hit; without a timeout a stuck job holds a runner slot for 6 hours.

## Consequences

**Positive:**
- Fresh-apply correctness is tested on every DB PR. Bugs that only manifest on clean schema apply are caught before they block a new environment or a new team member.
- GoTrue's FK enforcement is exercised. Bare-psql reset would miss auth-domain constraint violations.
- The path-scoping keeps the CI fast path fast. Frontend engineers never pay the 45-minute suite cost.
- New feature migrations ship with their own test suite baked in — the test pattern is the documentation for what the migration is supposed to do.

**Negative:**
- Each `supabase db reset` in CI requires the full Docker stack (Supabase CLI manages this). Adding a new reset-path gate adds ~2 minutes of parallelised CI cost to any PR touching `supabase/`.
- SQL assertion tests require knowing the schema well enough to write `information_schema` and `pg_catalog` queries. This is a modest skill threshold compared to application test writing.
- The gate only validates the migration sequence from scratch. Behaviour of in-place schema changes on a live database (e.g., adding a non-null column to a large table) is not covered — that requires manual validation in UAT against real data volumes.

## Alternatives considered

**Test migrations only against the evolved dev database:** Misses the class of ordering/dependency bugs that are the primary source of production deploy failures on fresh environments.

**Integration tests against a live Supabase instance:** Requires a persistent Supabase project with credentials, adds external state risk, and is slower than a CLI-managed ephemeral reset.

**Skip migration tests entirely, catch failures in UAT:** UAT deploy failures are expensive (blocked pipeline, manual investigation). CI gates cost seconds to minutes and run automatically.

## Evidence

- `.github/workflows/pr-validation.yml` — `supabase-seed`, `supabase-rpc-guards`, `supabase-seed-demo-users` jobs
- `supabase/tests/run_demo_baseline_seed.sh` — baseline seed validation script
- `supabase/tests/run_direct_db_write_rpc_guards.sh` — write-guard contract tests
- `supabase/tests/run_seed_demo_users.sh` — user seeding validation
- ADR-0024 — additive-only migrations (companion decision)
- ADR-0036 — layer 3 of the testing pyramid
