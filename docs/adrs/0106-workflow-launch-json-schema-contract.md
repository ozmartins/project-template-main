# ADR-0106: Workflow Launch JSON Schema Contract

- **Status:** Proposed
- **Date:** 2026-06-23
- **Deciders:** Factory Architect
- **Supersedes / Superseded by:** None

## Context

This repository already uses JSON Schema in several places, but not as one governed contract. Workflow definitions under `temporal/definitions/*.json` carry executable DSL structure, the trigger path validates inputs ad hoc in `supabase/functions/trigger-workflow/index.ts` and `temporal/src/server.ts`, and the frontend workflow surfaces still rely on manually wired forms and allowlists.

That drift creates three problems:

1. A workflow launch payload can be accepted by one layer and rejected by another.
2. Adding a new triggerable workflow requires hand-editing frontend form code and validation logic instead of reusing the definition contract.
3. The proposed database enforcement in issue #146 cannot safely rely on a cross-table `CHECK` constraint against `workflow_definitions`, because the launch payload is written through a dynamic definition lookup boundary.

The template-first vision requires a single reusable contract that can drive UI rendering, request validation, CI validation, and database backstops without introducing environment-specific logic or per-workflow code paths.

## Decision

We use a top-level `definition.input_schema` JSON Schema document as the canonical launch contract for workflows exposed through the generic trigger path.

The contract is enforced as follows:

- Triggerable definitions declare `input_schema` in `temporal/definitions/*.json`.
- Optional form-layout metadata lives beside the definition as `temporal/definitions/<name>.ui.json`; it is not the data contract.
- The trigger UI renders from `input_schema` using a schema-driven renderer inside the existing frontend architecture.
- The workflow API validates launch payloads against `input_schema` before starting Temporal work.
- Database validation is a controlled write-boundary backstop using `pg_jsonschema` in an RPC or trigger-backed function, not a cross-table `CHECK` on `workflow_executions`.
- Runtime-only metadata must not be hidden in `$input.*`; it moves to a reserved `$workflow.*` namespace.

## Consequences

**Positive**

- One contract can drive frontend launch forms, PR-time validation, API validation, and DB backstops.
- New triggerable workflows become template-friendly: add a definition and optional UI sidecar instead of writing bespoke form code.
- The launch path stays explicit about what is user input versus runtime metadata.

**Negative**

- The trigger path must stop relying on hard-coded allowlists and ad hoc payload shapes.
- Existing definitions that still depend on hidden launch fields must be migrated before the contract can become mandatory.
- Database enforcement moves to a controlled launch boundary, so implementation must add or update an RPC/write function instead of using a simpler but unsafe table constraint.

## Alternatives considered

**Keep hand-wired frontend forms and validators.** Rejected because it preserves the current drift and makes reusable workflow definitions harder to add.

**Use a cross-table `CHECK` constraint on `workflow_executions`.** Rejected because it couples a row-level write to dynamic lookup logic in `workflow_definitions` and is a poor fit for controlled validation and rollout.

**Treat UI layout metadata as the primary contract.** Rejected because layout is presentation-only and must not replace the canonical data schema shared across runtime boundaries.

## Evidence

- Issue #146 — `Epic: JSON Schema as the single source of truth — DSL contracts, UI forms, and DB validation`
- `temporal/definitions/smoke-classification.json`
- `temporal/definitions/vertical-classification.json`
- `supabase/functions/trigger-workflow/index.ts`
- `temporal/src/server.ts`
- `docs/specs/workflow-json-schema-contract.md`
