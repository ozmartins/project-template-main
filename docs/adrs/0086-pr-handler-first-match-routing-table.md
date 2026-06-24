# ADR-0086: PR Handler uses a first-match routing table

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

The PR Handler prompt is a control-plane contract under `.github/**`: it determines how the factory routes pull requests based on state, CI status, mergeability, and review outcomes. That routing logic was expressed as a longer prose decision tree, which made the branch order harder to scan and repeated the “do not re-kick without evidence” guardrail in multiple places.

This PR refactors that contract without changing routing outcomes. Because the change affects factory behavior documentation in `.github/**`, the repository requires an in-PR ADR that records the resulting contract clearly for future reviewers.

## Decision

We express the PR Handler routing contract as a first-match decision table with `State | Condition | Action` columns. We keep the re-kick guardrail centralized once in the preamble instead of repeating it inside multiple branches.

## Consequences

- Reviewers can verify routing order quickly because the branch contract is now explicit and scan-friendly.
- Future prompt edits must preserve first-match semantics and keep the centralized re-kick guardrail singular unless a later ADR changes that contract.
- The refactor stays behavior-preserving: branch outcomes do not change, only their representation does.

## Alternatives considered

- **Keep the prose decision tree.** Rejected because it obscures branch ordering and duplicates guardrails that should stay single-sourced.
- **Split guardrails into each branch row.** Rejected because repeating the re-kick rule increases drift risk when one copy changes and another does not.
- **Delay ADR coverage because the change is “just documentation.”** Rejected because `.github/**` prompt contracts are treated as control-plane decisions in this repository and must be recorded in the same PR.

## Evidence

- `.github/agents/pr-handler.agent.md` — routing contract rewritten as a first-match decision table
- `.github/tools/shared/src/__tests__/pr-handler-agent.test.ts` — test asserts the decision-table structure and exactly one `do not re-kick` guardrail instance
- `docs/adrs/README.md` — ADR index entry for ADR-0086
