# ADR-0084: Diary-agent prompt contract guardrails and canonical date path

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The diary-agent prompt under `.github/agents/diary-agent.agent.md` is part of the factory
control plane. Prompt edits change the execution contract for weekly diary generation.

The refactor in PR #514 reduced duplicated instruction text and standardized date handling.
Because this modifies control-plane behavior, we need an explicit ADR that captures the
contract and preserves intent for future edits.

## Decision

We accept the diary-agent prompt contract update with three constraints:

1. Guardrails are deduplicated into one canonical `## Guardrails` section, with exactly one
   `Evidence-first` rule and one `Degrade gracefully` rule.
2. Date calculation uses `python3` as the canonical path for ISO week and 7-day lookback,
   with explicit shell fallbacks for environments without Python and non-empty value checks.
3. Diary-agent remains write-scoped to `docs/diary/` only.

## Consequences

- The prompt is shorter and less repetitive while preserving behavior.
- Date computation behavior is easier to reason about across Linux and macOS runners.
- The write boundary stays narrow (`docs/diary/`), reducing risk of accidental control-plane
  or source changes.
- Future diary-agent prompt edits can be reviewed against this ADR as the canonical contract.

## Alternatives considered

- **Keep repeated guardrails and mixed date patterns:** rejected because repetition increases
  drift risk and makes prompt intent harder to audit.
- **Use shell date logic as the canonical path:** rejected in favor of `python3` for more
  consistent cross-platform formatting semantics.
- **Broaden write scope beyond `docs/diary/`:** rejected because the diary-agent is defined as
  an output-only synthesis agent.

## Evidence

- `.github/agents/diary-agent.agent.md` — deduped guardrails and canonicalized date path.
- `docs/adrs/0076-pipeline-weekly-diary-agent.md` — prior weekly diary-agent control-plane
  decision retaining output-only behavior.
- PR: #514
