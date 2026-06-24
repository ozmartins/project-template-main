# ADR-0006: Temporal for Workflow Orchestration

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The template includes a Python worker tier that executes multi-step, long-running business processes: sequences of activities, human approval gates, retries across failures, and operations that may span minutes to days. These cannot safely be implemented as plain async functions or background jobs — a process crash or redeploy would lose in-flight state, leaving partial transactions with no recovery path.

## Decision

Use [Temporal](https://temporal.io) as the durable execution engine for all multi-step background work. The Python Temporal SDK (`temporalio`) runs a single worker process connecting to a Temporal server (local via Docker Compose, or managed in production). Workflow code lives under `temporal/src/workflows/`; activities under `temporal/src/activities/`.

Key conventions:
- One task queue (`main`) shared across all workflows by default; add queues only when worker specialisation is genuinely needed.
- Configuration via Pydantic Settings from environment variables (`temporal/src/config.py`).
- Tests use `temporalio.testing.WorkflowEnvironment` — no live Temporal server required in CI.
- The DSL interpreter (ADR-0001) runs on top of this foundation; bespoke workflows are plain `@workflow.defn` classes.

## Consequences

**Positive:**
- Workflow state is durable across restarts and deploys. The Temporal server is the source of truth for in-flight state.
- Retries, timeouts, and heartbeats are first-class SDK concepts — no custom retry logic.
- The local dev stack (`make up`) starts a Temporal server and UI alongside the worker, providing full observability from day one.
- The test harness (`WorkflowEnvironment`) enables fast, hermetic unit tests without infrastructure.

**Negative:**
- The Temporal server is an additional stateful dependency. Production deployments need a managed Temporal cluster or self-hosted HA setup.
- Workflow code must be deterministic; non-deterministic operations must be wrapped in activities. This is a learning curve for new engineers.
- Temporal's versioning model (`workflow.patched`) must be followed when modifying in-flight workflow logic.

## Alternatives considered

**Celery + Redis:** Simpler to deploy, but no durable workflow state — a worker crash loses progress. No built-in signal/query protocol.

**Cloud-native orchestration (AWS Step Functions, Azure Durable Functions):** Cloud-provider lock-in; harder to run locally; Temporal is provider-agnostic.

**Plain async background jobs:** Fine for fire-and-forget tasks; insufficient for multi-step processes with human gates or long waits.

## Evidence

- `temporal/src/worker.py` — worker registration
- `temporal/src/config.py` — Pydantic settings
- `temporal/src/workflows/` — workflow definitions
- `temporal/tests/` — test suite using `WorkflowEnvironment`
- `docker-compose.yml` — Temporal server + UI service definitions
