# Workflow JSON Schema Contract

**Status:** Draft  
**Last updated:** 2026-06-23

---

## Goal

Define one workflow-launch contract that can be reused across:

- DSL authoring in `temporal/definitions/*.json`
- trigger UI rendering in the frontend
- PR-time contract validation
- launch-time API validation
- database-side validation backstops

The design must preserve the existing JSON-driven UI architecture, avoid hidden launch fields, and stay compatible with the current Temporal DSL runtime.

---

## Scope

This spec covers the contract for workflows that are launched through the generic trigger path.

In scope:

- top-level `definition.input_schema`
- optional per-definition UI sidecars
- launch-path validation boundaries
- `pg_jsonschema` usage at the controlled write boundary
- rollout constraints for existing definitions and validators

Out of scope:

- redesigning the Temporal DSL step model
- replacing the existing UI engine
- arbitrary JSON Schema draft support beyond the subset the runtime can execute safely

---

## Recommended approach

Use the workflow definition as the single source of truth for launch payload shape:

1. `temporal/definitions/<name>.json` holds the canonical `input_schema`.
2. `temporal/definitions/<name>.ui.json` is optional layout metadata for JSON Forms.
3. The frontend trigger page renders from the schema instead of per-workflow handwritten inputs.
4. The workflow API validates the payload before it starts Temporal work.
5. The database re-validates at the controlled persistence boundary using `pg_jsonschema`.

This keeps the data contract portable and reusable while preserving presentation flexibility.

---

## Definition contract

Triggerable workflow definitions must expose:

```json
{
  "name": "smoke-classification",
  "version": "1.0.0",
  "input_schema": {
    "type": "object",
    "required": ["company_name", "domain"],
    "properties": {
      "company_name": { "type": "string", "title": "Company name", "minLength": 1 },
      "domain": { "type": "string", "title": "Domain", "minLength": 1 }
    },
    "additionalProperties": false
  }
}
```

### Contract rules

1. `input_schema` is the canonical launch contract for user-supplied payload data.
2. Hidden runtime-only fields are not allowed inside `$input.*`.
3. Runtime metadata moves to a reserved `$workflow.*` namespace, for example:
   - `$workflow.workflow_id`
   - `$workflow.started_at`
   - `$workflow.definition_name`
   - `$workflow.definition_version`
4. `*.ui.json` sidecars may change layout, grouping, help text, and ordering, but they must not override validation semantics from `input_schema`.

---

## Frontend contract

The trigger UI consumes `definition.input_schema` directly and renders through JSON Forms inside the existing frontend stack.

### Why JSON Forms

| Approach | Trade-off |
|---|---|
| Reuse existing hand-built input primitives only | Lowest short-term change, but each new workflow still requires bespoke form code. |
| Add JSON Forms with optional UI sidecars | **Recommended.** Uses the schema directly while preserving layout overrides for complex forms. |
| Build a custom schema renderer from scratch | Higher long-term maintenance burden for a template repository. |

### Frontend requirements

- Fetch or import the workflow definition from the same source already used by workflow detail views.
- Render launch forms from `input_schema`.
- If `temporal/definitions/<name>.ui.json` exists, pass it as layout metadata; otherwise use generated layout.
- Submit only the validated user payload under `input`.
- Keep the schema-driven form inside the existing route and component structure; do not introduce a second application shell.

Bounded implementation surfaces:

- `frontend/src/data/workflowDefinitions.ts`
- workflow trigger route/components under `frontend/src/routes/workflows/`
- frontend workflow-trigger tests

---

## Launch validation flow

```text
Frontend trigger form
  -> Supabase edge function `trigger-workflow`
  -> workflow API `temporal/src/server.ts`
  -> Temporal start
  -> controlled persistence boundary for `workflow_executions`
```

### Validation responsibilities

| Layer | Responsibility |
|---|---|
| Frontend | Present the schema-driven form and block obviously invalid submissions. |
| Edge function | Authenticate the caller and forward the request unchanged; do not invent hidden payload fields. |
| Workflow API | Validate `input` against `definition.input_schema` before `WorkflowClient.start(...)`. |
| DB write boundary | Re-validate with `pg_jsonschema` before persistence. |
| Temporal runtime | Re-validate at workflow start as defense in depth. |

### Explicitly rejected design

Do **not** add a cross-table `CHECK` constraint from `workflow_executions` to `workflow_definitions`. The launch payload depends on a dynamic definition lookup and must be validated at a controlled write boundary instead.

---

## Database boundary

Use `pg_jsonschema` in a trusted write boundary such as an RPC or trigger-backed insert function.

Required behavior:

- load the active definition for `definition_name`
- extract `definition.input_schema`
- validate `input_payload`
- reject invalid launches before the row is committed

The API server remains the primary trusted boundary. The SQL layer is a backstop, not the first validator.

Bounded implementation surfaces:

- Supabase migration enabling `pg_jsonschema`
- launch RPC or equivalent write function
- `workflow_executions` write path used by `temporal/src/server.ts`

---

## CI and authoring rules

The existing DSL validation workflow must promote `input_schema` from optional to required for triggerable definitions.

Required checks:

1. schema file contains a top-level `input_schema`
2. `input_schema` is valid JSON Schema for the supported subset
3. synthetic-valid payload generation does not inject undocumented fields
4. `*.ui.json` files are validated separately as UI metadata, not as executable definitions

Bounded implementation surfaces:

- `validate-dsl-definitions` workflow/script
- `temporal/definitions/*.json`
- authoring guidance in the DSL documentation issue stream

---

## Rollout constraints

Before making this contract mandatory:

1. remove any remaining hidden launch fields under `$input.*`
2. move runtime metadata to `$workflow.*`
3. ensure the trigger path no longer relies on hard-coded field assumptions
4. ensure the edge-function and API path preserve the launch payload exactly

Current repo-specific constraints observed in this run:

- `supabase/functions/trigger-workflow/index.ts` uses a hard-coded allowlist of triggerable definitions
- `temporal/src/server.ts` currently validates only that `input` is an object, not that it matches the definition schema
- `frontend/src/data/workflowDefinitions.ts` currently exposes a small hand-maintained definition registry

---

## Story split

- **#74**: consume `definition.input_schema` in the workflow trigger UI
- **#77**: enforce and meta-validate `input_schema` in PR validation
- **#87**: document authoring rules for `input_schema` and optional `*.ui.json`
- **Follow-on story required**: add the controlled DB launch write boundary with `pg_jsonschema` and move runtime metadata to `$workflow.*`

---

## Test strategy

Minimum acceptance coverage:

1. frontend tests prove a triggerable definition renders a schema-driven form and blocks invalid required fields
2. edge/API tests prove invalid payloads are rejected before Temporal start
3. DB tests prove `pg_jsonschema` rejects payloads that fail the active definition contract
4. DSL validation tests prove `input_schema` is required and checked for the supported subset

---

## Risks

- JSON Schema features supported by general validators may exceed the current Temporal runtime subset.
- Launch-path drift can reappear if the API and DB boundaries validate different schema snapshots.
- Optional UI sidecars can become a second contract if implementation lets them affect validation semantics.
