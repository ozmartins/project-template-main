# ADR-0007: Signal-Driven Human-in-the-Loop Approval Gates

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Some workflow actions are irreversible or consequential enough that autonomous execution is unacceptable: triggering external payments, deploying to production, publishing data externally, or executing destructive operations. The system needs durable, auditable gates that block workflow progress until a human explicitly approves or rejects — and these gates must survive server restarts.

The same pattern applies to the agentic operations layer: factory agents (ADR-0002) propose actions but must not auto-apply changes without human sign-off.

## Decision

Human approval is implemented as **Temporal signals**. A workflow blocks on `workflow.wait_condition(lambda: self._approved is not None)` until a named signal (`approve` or `reject`) is dispatched. The signal payload records who approved and when. `workflow.query` handlers expose current gate state to the UI.

For the agentic layer, `auto_apply` is **hard-locked `False` in code** regardless of any stored configuration — agents produce proposals; humans approve them via the same signal mechanism. This is defense-in-depth: even if configuration is corrupted, autonomous execution cannot occur.

The reference implementation is `temporal/src/workflows/example/approval_workflow.py`.

## Consequences

**Positive:**
- Gates are durable: a server restart does not lose approval state or reopen a closed gate.
- Every approval is an auditable Temporal event with approver identity and timestamp.
- The gate works for both user-facing flows (UI dispatches signal) and agent-proposed operations (agent submits signal after human confirmation).
- No `auto_apply` bypass path exists in code — the lock cannot be overridden by config drift.

**Negative:**
- Workflows can hold open indefinitely waiting for a signal. Monitoring must alert on gates stuck past an SLA (the operations monitor watches for this).
- Requires a signal-dispatch endpoint (REST or GraphQL) wired to the approval UI. This must be built per-project; the template provides the workflow skeleton only.
- No bulk "approve all" in the default implementation — each gate is dispatched individually.

## Alternatives considered

**Auto-apply with after-the-fact audit:** Rejected for any irreversible action. Audit trails do not undo mistakes.

**Out-of-band email approval:** No durable state binding — the workflow cannot wait on an email reply without polling. Latency is unpredictable.

**Optimistic execution with compensating transactions:** Valid for reversible operations; not applicable to external side effects (payments, publishes, destructions).

## Evidence

- `temporal/src/workflows/example/approval_workflow.py` — reference signal-gate implementation
- ADR-0006 — Temporal orchestration foundation
