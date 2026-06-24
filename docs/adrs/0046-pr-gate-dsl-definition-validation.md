# ADR-0046: PR gate for Temporal DSL definition validation

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

The repository stores executable Temporal DSL definitions in `temporal/definitions/`. Invalid JSON, schema drift, or interpreter-incompatible definitions can currently be merged and only fail later at runtime. This introduces avoidable deployment risk and slows feedback loops.

Changes to `.github/workflows/**` are control-plane changes and require an ADR in the same PR.

## Decision

We add a dedicated pull-request workflow that runs only when `temporal/definitions/**` changes and executes `temporal/scripts/validate-definitions.ts` to parse, schema-validate, and interpreter-execute all DSL definitions against stubbed activities.

## Consequences

Definition errors are caught before merge with a path-scoped, low-noise CI gate. Contributors get fast feedback for DSL regressions without running unrelated validations.

The repository now owns and maintains a script that provisions a Temporal test environment for definition checks.

## Alternatives considered

Rely only on runtime validation in workflows: rejected because failures are deferred until after merge.

Run the full Temporal test suite on any definitions change: rejected because it is broader than required and slower than a focused gate.

## Evidence

- `.github/workflows/validate-dsl-definitions.yml`
- `temporal/scripts/validate-definitions.ts`
- `temporal/tests/validate-definitions-script.test.ts`
