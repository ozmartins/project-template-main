# ADR-0074: Factory Process Reviewer may directly maintain Copilot instructions

- **Status:** Superseded by ADR-0075
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** Superseded by ADR-0075

## Context

The factory already has agents that review individual pull requests, cluster issue
trends, and file documentation follow-ups. It did not have a nightly process that
looks across recent PR review history to find repeated Copilot/factory mistakes
and immediately tighten `.github/copilot-instructions.md` when the gap is concrete.

PR review on `#361` exposed a specific control-plane gap: multiple avoidable round-
trips were required to correct ADR numbering, merge-conflict scope preservation,
`action_required` handling, and pre-existing CI failure attribution. Those were
process-instruction failures rather than product-code failures.

## Decision

We add a nightly `factory-process-reviewer` stage to `pipeline-daily.yml` and give
that workflow `contents: write` so the agent may directly update
`.github/copilot-instructions.md` on `main` when real PR incidents justify a
concrete instruction improvement.

The agent is constrained to pattern analysis, may add at most two instruction
rules per run, must tie each edit to evidence from the last 24 hours, and files
only deduplicated `auto:process` roll-up issues for repeated systemic patterns.

## Consequences

- The factory gains a closed loop for improving Copilot operating instructions from
  observed PR friction without waiting for a separate manual docs PR.
- `pipeline-daily.yml` becomes a write-capable control-plane workflow, so reviews
  must continue treating it as a protected boundary.
- The new agent must stay tightly scoped: no per-PR issue filing, no speculative
  rule growth, and no deep code review outside pattern analysis.

## Alternatives considered

- File only `queue:docs` issues and never edit instructions directly: rejected
  because clear instruction gaps can cost another full PR review cycle before they
  are fixed.
- Extend `docs-improver` or `trend-analyst`: rejected because neither owns PR
  review-round-trip analysis plus direct control-plane instruction maintenance.
- Create a separate scheduled workflow: rejected because `pipeline-daily.yml`
  already has the right cadence and token setup for this nightly review.

## Evidence

- `.github/agents/factory-process-reviewer.agent.md` — nightly reviewer charter and guardrails
- `.github/workflows/pipeline-daily.yml` — new stage and `contents: write` permission
- `scripts/bootstrap-labels.sh` — `auto:process` label bootstrap definition
- `docs/adrs/README.md` — ADR index entry for this decision
- Issue: `#423`
- PR review evidence: `#361`
