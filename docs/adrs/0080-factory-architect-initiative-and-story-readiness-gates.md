# ADR-0080: Factory architect enforces initiative and story readiness gates

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot PR handler
- **Supersedes / Superseded by:** —

## Context

The `factory-architect` agent decides whether work should be framed as an
Initiative, Epic, or Story and is responsible for decomposing architecture
work into implementation-ready tickets.

Before this PR, the agent prompt required decomposition and parent/child issue
linking, but it did not define a concrete quality bar for a valid Initiative,
when a Story is truly `ready-for-dev`, how to stop on vague scope, or how to
handle multiple plausible designs without hedging. That gap lets under-scoped
planning artifacts reach the board and creates orphaned or ambiguous stories in
the factory control plane.

Because this behavior lives in `.github/agents/factory-architect.agent.md`, the
change alters a control-plane agent contract and needs an explicit architectural
record.

## Decision

We require the `factory-architect` agent to enforce explicit Initiative quality
criteria, Story readiness criteria, a vague-scope stop rule, and a bounded
design-option selection rule in its prompt contract.

The agent must only mark Stories `ready-for-dev` when they have specific scope,
testable acceptance criteria, no blocking review labels, and a clear parent
link, and it must route ambiguous requests back for clarification instead of
decomposing them.

## Consequences

- Initiative creation and Epic placement now have a concrete outcome-oriented
  quality bar rather than relying on reviewer interpretation.
- Story creation becomes stricter, which should reduce orphaned or
  under-specified tickets reaching `queue:development`.
- The architect agent now makes a firm design recommendation in normal cases,
  reducing indecisive specs, while still escalating irreversible
  infra/security/data-boundary choices.
- Future changes to these planning gates must update both the prompt contract
  and this ADR lineage.

## Alternatives considered

- Keep the prompt prose-only and rely on reviewers to catch weak Initiatives or
  vague Stories: rejected because the failure mode already occurs upstream in
  automated decomposition.
- Enforce readiness only through downstream labels or board automation:
  rejected because the architect agent is the earliest reliable point to stop
  vague scope before child issues are created.
- Split the policy across multiple agent prompts: rejected because the
  Initiative/Epic/Story boundary is owned by the `factory-architect` contract.

## Evidence

- `.github/agents/factory-architect.agent.md` — prompt contract adding
  Initiative quality criteria, story readiness gates, vague-scope handling, and
  design approach rules
- `docs/adrs/0080-factory-architect-initiative-and-story-readiness-gates.md` —
  architectural record for the control-plane contract change
- PR #478 — "chore(factory): refine factory-architect agent — Initiative
  quality bar + story readiness criteria"
