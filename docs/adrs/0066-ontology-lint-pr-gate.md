# ADR-0066: Ontology lint as a PR gate for SQL migrations

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

The branch `feature/ontology-ci-lints` introduced a Python script and GitHub Actions workflow that enforced three semantic invariants on Supabase migration SQL:

1. `entity_facts.value` must use a numeric Postgres column type.
2. Every `fact_types.key` value referenced via `SELECT id FROM fact_types WHERE key = '...'` sub-selects must be inserted in the same file or an earlier migration (files sorted by name).
3. New top-level `CREATE TABLE` statements must match the ontology naming shape — one of the core table names (`entities`, `entity_versions`, `entity_facts`, `fact_types`, `relationships`, `relationships_v2`, `time_series_points`), an application-layer table added to the explicit allow-list, or a `dim_`/`fact_` prefixed name.

These checks are not style rules (covered by `sqlfluff` proposals in issue #37); they are semantic ontology invariants that `sqlfluff` cannot express. The Python script conflicts with the repository-wide decision to standardise scripts on TypeScript (ADR-0047 / issue #96), and the branch was never merged.

Changes to `.github/workflows/**` are a control-plane boundary and require an ADR in the same PR.

## Decision

We port the three ontology rules to TypeScript as `temporal/scripts/lint-ontology.ts`, expose its `lint()` function for unit testing, and add a path-scoped PR workflow `.github/workflows/validate-ontology.yml` named `Validate - Ontology` (per issue #143 naming standard). The Python branch is closed without merging.

## Consequences

- Migration and seed SQL are validated against the ontology shape on every PR that touches them.
- The three semantic rules have focused Jest fixtures and tests in `temporal/tests/lint-ontology.test.ts`.
- The script is TypeScript, consistent with ADR-0047 and the broader scripts standardisation.
- Contributors who need to add a new first-class application table must update `APPLICATION_NAMED_TABLES` in `temporal/scripts/lint-ontology.ts` — this is intentional friction that keeps the allow-list current.
- `sqlfluff` (if adopted) handles SQL style and syntax; ontology lint handles schema semantics. The two do not overlap.

## Alternatives considered

**Merge `feature/ontology-ci-lints` verbatim:** Rejected — the Python script conflicts with the TypeScript standardisation direction and required renaming per the workflow naming standard.

**Absorb into `validate-dsl-definitions.yml`:** Rejected — DSL validation targets Temporal workflow definitions; ontology lint targets Supabase SQL migrations. Merging them couples two unrelated concerns and increases noise.

**Rely on `sqlfluff` alone:** Rejected — `sqlfluff` covers SQL style and syntax, not ontology-specific semantic rules such as value-column type enforcement or fact-type key ordering across migration files.

## Evidence

- `temporal/scripts/lint-ontology.ts` — TypeScript implementation
- `temporal/tests/lint-ontology.test.ts` — focused Jest tests for all three rules
- `temporal/tests/fixtures/ontology/` — SQL fixtures proving each rule fails and passes
- `.github/workflows/validate-ontology.yml` — path-scoped PR gate
- `docs/adrs/0047-audit-scripts-typescript.md` — upstream TypeScript scripts decision
