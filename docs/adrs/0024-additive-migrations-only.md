# ADR-0024: Additive-Only Database Migrations

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Database migrations are the highest-risk operation in the deploy pipeline. A destructive migration (DROP TABLE, DROP COLUMN, data transformation in-place) that runs in production cannot be trivially undone. Rolling back requires either a restore from backup (data loss risk) or a second migration to undo the first (which may itself fail). CI tests can pass on a fresh schema reset while a migration that has never been rolled back would fail on the real production database state.

## Decision

All database schema changes must be **additive and non-destructive** as the default:

- **Add** columns, tables, indexes, functions, triggers: always safe.
- **Rename** a column or table: use a two-migration pattern — add the new name + deprecation period + drop old name in a later migration.
- **Change a column type**: use add + backfill + swap + drop pattern across multiple migrations.
- **Drop** a table or column: only after a deprecation period confirmed by a human (requires explicit `-- DROP APPROVED:` comment in the migration and tech-reviewer sign-off).
- **Data migrations** (backfills): must be idempotent, use `ON CONFLICT DO NOTHING` or equivalent, and be tested on a representative data set before production.

Migrations are **timestamped SQL files** (`YYYYMMDDHHMMSS_description.sql`) applied in lexicographic order by the Supabase CLI. Shipped migrations are immutable: once applied to any environment, they are never edited. New changes always create new files.

The tech-reviewer agent owns migration review. Any PR touching `supabase/migrations/` that includes a DROP, RENAME, or destructive data change must be flagged with `needs-database-review`.

## Consequences

**Positive:**
- Additive migrations are safe to apply to a live production database without a maintenance window.
- Rollback of an additive migration is always possible by deploying the previous version of application code — the new column or table is simply ignored.
- The migration history is an append-only audit log of schema evolution. Any state of the schema can be reconstructed by replaying the sequence.
- CI can test migrations against a fresh Supabase reset on every PR, since all migrations are idempotent from a clean state.

**Negative:**
- Two-phase renames and drops require coordination across multiple PRs and deployment windows. Schema cleanup accumulates if the deprecation discipline is not followed.
- Large additive backfills on production tables can lock rows for extended periods. These must be written as low-watermark batch operations, not single-statement updates.
- The "timestamped file per change" pattern creates many small migration files over time. This is a cosmetic concern; Supabase applies them all on reset regardless.

## Alternatives considered

**Destructive migrations with a maintenance window:** Acceptable for off-peak deploys but requires downtime coordination. Adds operational complexity that the factory's continuous-delivery model is designed to avoid.

**ORM migrations (Alembic, Django ORM):** Auto-generate migrations from model diffs. Convenient but often generates destructive operations without warning. Raw SQL gives full control and reviewability.

**Schema-per-tenant isolation:** Allows per-tenant schema evolution but is significantly more complex to manage. Out of scope for the template.

## Evidence

- `supabase/migrations/` — timestamped SQL migration files
- `supabase/tests/run_demo_baseline_seed.sh` — CI gate that validates migrations apply cleanly
- `.github/copilot-instructions.md` — migration review rules
