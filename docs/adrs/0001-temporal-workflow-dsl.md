# ADR-0001: JSON-Native Workflow Engine on Temporal — Flowable Expressiveness, Temporal Durability

- **Status:** Proposed
- **Date:** 2026-06-20
- **Deciders:** Ian Reay
- **Supersedes / Superseded by:** —
- **Extends:** ADR-0003 (Temporal orchestration), ADR-0016 (JSON-driven UI engine) — see reference project `wynne-lvl-3`

## Context

Temporal workflows in this template are coded TypeScript functions (or Python classes in the existing worker). Every process change — adding an approval gate, reordering steps, changing routing logic — requires editing source code, rebuilding the worker Docker image, and managing Temporal's determinism constraints across the rollout. Business-process iteration is blocked behind engineering deployment cycles.

The project already applies a configuration-driven pattern to the frontend: all screens are JSON definitions interpreted at runtime by a React engine (ADR-0016). The same principle should govern backend orchestration. The goal is a system with **Flowable's expressiveness** — complex processes as configuration, not code — running on **Temporal's durability** — event-sourced, replay-safe, horizontally scalable, language-native.

### Why Flowable is the right reference point

Flowable (and its Activiti/Camunda lineage) has proven at enterprise scale for twenty years that genuinely complex business processes can be managed as configuration. The BPMN+DMN model handles:
- Multi-step processes with human approval gates, timers, error events
- Decision logic as configuration (Decision Model and Notation tables), not code
- Process versioning: running instances are pinned to the definition they started on; migration is explicit and operator-driven
- Reusable service task library: most integration steps are configurable HTTP calls, not custom Java

What Flowable lacks is Temporal's execution model: it stores state in a relational database rather than an event-sourced history, struggles with horizontal scale under high concurrency, and has no native support for language-first activity implementations. Temporal solves those gaps precisely.

### The two objections that looked true but aren't

**Objection: "New activity types always require TypeScript code."** This is correct but not the constraint it appears to be. The vast majority of real workflow integration steps are REST API calls — calling Stripe, calling Salesforce, calling internal microservices. A single generic `http_request` activity with configurable URL, method, headers, auth, body, and result-mapping covers this entire class without any custom TypeScript. For the small fraction that genuinely need bespoke logic, an embedded code-generation agent (consistent with this project's Software Factory model) generates a tested activity function from a specification, commits it to git, and makes it available after the next worker deploy. Activity code becomes another artifact the agent produces on demand — it is configuration-driven development, not manual coding.

**Objection: "Mid-execution versioning is unsolvable."** Flowable solved this decades ago. The correct model is: a workflow execution is pinned to the exact definition it started with — that definition is embedded in the Temporal event history as workflow input, making it immutable by the platform. Running executions continue on their definition until they complete, are explicitly restarted on a new version, or are cancelled. New executions pick up the current definition. Because the interpreter itself never changes (only definitions do), the `workflow.GetVersion` / patching complexity that plagues coded workflow migrations is entirely absent. This is a cleaner versioning story than coded Temporal workflows, not a harder one.

### What this means architecturally

The system has three layers, each independently evolvable:

1. **Activity library** — generic, reusable building blocks registered with the worker: `http_request`, `supabase_query`, `supabase_rpc`, `send_notification`, `evaluate_decision`, `transform_data`. These cover the vast majority of real workflow steps with no custom code.

2. **Workflow engine** — a single `DSLWorkflow` interpreter function that executes any conforming JSON definition. Control flow (sequence, parallel, condition, loop, signal, timer, child workflow, error handling) is entirely in the definition. No TypeScript changes required to add or modify a process.

3. **Activity generation agent** — for steps the library doesn't cover, the Software Factory's coding agent generates a new activity function from a specification, tests it, and commits it to the worker codebase. This is the long-tail extension mechanism, not the primary path.

Research (adversarially verified, June 2026) confirms the interpreter pattern is officially endorsed by Temporal across Python, TypeScript, and Go. Two open-source projects (Zigflow in Go; Orchestra in Python) have extended it to the full Temporal surface, proving feasibility. Neither is adoptable directly (language boundary, governance). See §2 of `docs/specs/temporal-dsl-spec.md` for the full prior art analysis.

## Decision

We build a JSON-native workflow engine on top of the **TypeScript Temporal SDK** (`@temporalio/*`). TypeScript is chosen over Python for this specific component: JSON is a native TypeScript type (no deserialisation overhead); the Node.js worker image is ~50 MB vs ~200 MB for Python slim; `proxyActivities` enables cleaner dynamic activity dispatch than Python's string-based call; and the frontend is TypeScript, meaning DSL schema types can be a shared package across worker and workflow designer UI without a language boundary. See §0 of the spec for the full library selections.

The engine consists of:

1. A **generic activity library** (`temporal/src/activities/`) of reusable building blocks, led by a first-class `http_request` activity that covers the majority of integration steps without custom code.

2. A **`DSLWorkflow` interpreter** (`temporal/src/workflows/dsl/`) that executes JSON workflow definitions covering the full Temporal surface: activity invocation, sequential and parallel execution, signal waiting with timeouts, conditional branching, sleep/timer, child workflows, dynamic fan-out, query handlers, and structured error handling.

3. A **definition registry** in Supabase (`workflow_definitions` table) and git (`temporal/definitions/`). Definitions are version-controlled files; Supabase is the runtime store. Each execution receives its full definition as workflow input — embedded permanently in Temporal's event history.

4. A **versioning contract**: executions are pinned to their definition for their full lifetime. New executions use the current definition. Explicit operator-driven restart migrates a running execution to a new version. No `workflow.GetVersion` complexity.

See `docs/specs/temporal-dsl-spec.md` for the complete schema, step type reference, activity library, versioning contract, and implementation guide.

## Consequences

**Easier:**
- Add or reconfigure a business process by updating a JSON definition file — no TypeScript code, no worker rebuild, no redeploy for structural changes.
- New integration targets (new REST APIs) are covered by the generic `http_request` activity — add them as new definitions, not new code.
- Process definitions are auditable, diffable, and reviewable in git — the same PR workflow applies to processes as to code.
- A visual workflow designer UI (natural extension of the frontend's `UIEngine`) can read and write definition files directly, sharing DSL schema types from a shared TypeScript package.
- Multiple process versions can coexist in production simultaneously — each running execution carries its definition.
- The interpreter is registered once; all workflow definitions share a single code path with uniform observability.

**Harder:**
- The generic activity library must be designed carefully upfront — the contract between activity inputs/outputs and the DSL's variable binding model is a fixed interface. Changing it later is a breaking migration.
- Debugging runs through the generic interpreter rather than domain-specific code. Step labels in definitions must be descriptive; the visual designer tool is the primary debugging surface, not stack traces.
- Definitions stored in git + Supabase require a deploy pipeline for synchronisation. The definition is the source of truth in git; Supabase is populated on deploy. Any out-of-sync state is an operational risk.
- Expressions in conditions (`$result.approved == true`) require a sandboxed evaluator. Security review is required before definitions become writable from the frontend by non-engineers.

**New obligations:**
- `DSLWorkflow` must be determinism-safe: no wall-clock reads or random values inside the interpreter.
- JSON Schema validation runs at definition load time before any execution begins.
- Every definition execution embeds the full definition JSON in workflow input — definitions are never fetched from Supabase during a running execution.
- Memo carries only `definition_name` + `definition_version` for Temporal visibility queries.
- The activity library follows the single-object-input convention so any activity can be called by string name from the DSL without positional argument ordering risk.
- A code-generation agent integration path must be defined so new activity types can be added without requiring manual TypeScript authorship.

## Alternatives considered

### Flowable / Camunda (BPMN engine)

The strongest alternative and the clearest reference point. Proven at enterprise scale, full BPMN+DMN expressiveness, visual designer, process versioning, decision tables.

Rejected as a replacement: Flowable stores state in a relational database, not an event-sourced history — it has no equivalent to Temporal's replay guarantee or durable timers. Its concurrency model is thread-pool based, not worker-task-queue based. It does not support language-native activity implementations in Python. The right relationship to Flowable is not adoption but inspiration: borrow its process versioning model, its service task library concept, and its decision logic separation.

### Temporal official DSL samples

Proven working pattern, officially endorsed. The TypeScript sample (`samples-typescript/dsl-interpreter`) is the closest starting point for this implementation.

Too limited: cover only `activity | sequence | parallel`. No signals, queries, timers, retry policies, child workflows, or error handling. Correct foundation; insufficient scope.

### Zigflow (Go, CNCF Serverless Workflow)

Most feature-complete open-source Temporal DSL (signals, queries, timers, child workflows, try-catch, for-loops). Rejected: Go runtime with its own worker — Python activities cannot register with it. External dependency with no LTS. CNCF spec adds cross-engine portability abstractions this project does not need.

### Orchestra (Python, YAML DSL)

Python-native, verified signal/query/update/loop support. Rejected: six weeks old, Chinese-language documentation, unclear governance.

### Parameterised coded workflows

Config rows drive branching, not structure. Solves parameter changes only; structural changes still require code. Addresses ~20% of the problem.

### Summary

| Approach | TypeScript-native | Full Temporal surface | Process versioning | No external dep | Generic HTTP activity |
|---|---|---|---|---|---|
| Flowable/BPMN | no (Java) | no (different model) | **yes — proven** | no | yes |
| Temporal official samples | yes | no — 3 primitives | n/a | yes | no |
| Zigflow | no (Go) | yes | partial | no | yes |
| Orchestra | no (Python) | yes | none | no | no |
| **This spec** | **yes** | **yes** | **yes — Flowable model** | **yes** | **yes** |

## Evidence

- Official Temporal TypeScript DSL sample: https://github.com/temporalio/samples-typescript/tree/main/dsl-interpreter
- Official Temporal Python DSL sample (reference for interpreter pattern): https://github.com/temporalio/samples-python/tree/main/dsl
- Zigflow: https://github.com/zigflow/zigflow
- Orchestra: https://github.com/StewartXiang/orchestra
- Worker entry point: `temporal/src/worker.ts`
- DSL interpreter: `temporal/src/workflows/dsl/interpreter.ts`
- Activity stubs: `temporal/src/activities/` (supabase_core, notifications, http_request, evaluate_decision, transform_data)
- Reference approval workflow (signal-gate pattern): `temporal/src/workflows/example/approval_workflow.ts`
- DSL storage migration: `supabase/migrations/20260620000200_workflow_dsl_schema.sql`
- Frontend JSON engine (mirror pattern): `frontend/src/engine/`
- Full spec: `docs/specs/temporal-dsl-spec.md`
