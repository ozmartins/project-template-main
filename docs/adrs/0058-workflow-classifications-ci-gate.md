# ADR-0058: workflow_classifications Reset-Path CI Gate

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

PR #106 added `supabase/migrations/20260620000300_workflow_classifications.sql` and the matching `supabase_mutate` write path in `temporal/src/activities/supabase_query.ts`, but shipped without the reset-path CI gate mandated by ADR-0039. Specifically:

- The `domain` UNIQUE constraint and the `updated_at` trigger wiring were not validated against a freshly applied schema.
- The upsert write path used by `temporal/scripts/test-vertical-classification.ts` was only covered by mocked fetch unit tests — never against a real migration-backed schema.

ADR-0039 ("Supabase Reset-Path CI Gates") explicitly requires that every feature migration adding schema structure ships with a matching gate. This ADR records the addition of that gate for `workflow_classifications`.

## Decision

We add a `supabase-workflow-classifications` job to `pr-validation.yml` that:

1. Runs all migrations from scratch in a throwaway Postgres container (`bash supabase/tests/run_workflow_classifications_contract.sh`)
2. Executes SQL contract assertions from `supabase/tests/workflow_classifications_contract.sql` covering:
   - Table shape and NOT NULL constraints
   - `domain` UNIQUE constraint enforcement
   - `updated_at` trigger wiring (`trg_workflow_classifications_updated_at`)
   - INSERT … ON CONFLICT upsert path (the write path exercised by `supabase_mutate`)

The job runs against any PR that touches `supabase/` and gates the build (no `continue-on-error`).

## Consequences

**Positive:**
- Regression-proof: future migrations that accidentally break the `domain` UNIQUE constraint or the trigger are caught in CI before merge.
- Validates the full migration sequence from scratch, not just the diff, consistent with ADR-0039 policy.
- Adds concrete CI evidence that the vertical-classification write path works against a real schema.

**Negative:**
- One additional CI job (~60–90 s) on any PR touching `supabase/`. Cost is acceptable per ADR-0039 policy.

## Alternatives considered

**Unit test only (mocked fetch):** The existing `temporal/tests/supabase_query.test.ts` tests cover the HTTP layer with mocked `fetch`. They cannot detect schema divergence, missing constraints, or trigger mis-wiring.

**Skip — rely on dev database:** The dev database has been migrated incrementally and would not surface ordering or dependency bugs. ADR-0039 explicitly rejects this approach.

## Evidence

- `supabase/migrations/20260620000300_workflow_classifications.sql` — the migration being validated
- `supabase/tests/workflow_classifications_contract.sql` — SQL contract assertions
- `supabase/tests/run_workflow_classifications_contract.sh` — bash runner
- `.github/workflows/pr-validation.yml` — `supabase-workflow-classifications` job
- ADR-0039 — policy mandate for reset-path CI gates
- Issue #181 — tracking issue for this gap
- PR #106 — original PR that introduced the migration without a gate
