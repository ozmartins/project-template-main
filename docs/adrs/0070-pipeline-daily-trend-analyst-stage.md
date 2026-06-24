# ADR-0070: Add trend-analyst stage to pipeline-daily

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The repository includes a fully authored `trend-analyst` agent
(`.github/agents/trend-analyst.agent.md`) intended to identify cross-ticket root
causes and open deduplicated `auto:trend` roll-up issues. The daily factory
workflow (`.github/workflows/pipeline-daily.yml`) previously ran only
`docs-improver` and `user-docs-manager`, so trend analysis never executed in
automation.

Adding an agent stage in `.github/workflows/**` is a control-plane workflow
change and requires an ADR in the same PR.

## Decision

We add `trend-analyst` as the final stage in `pipeline-daily.yml`, after
`docs-improver` and `user-docs-manager`, using the same isolated
`continue-on-error`, timeout, and step-summary pattern as existing daily stages.

## Consequences

- The daily pipeline now executes trend roll-up analysis once per run after other
  daily issue/doc sweeps have completed.
- Stage outcomes are visible in `GITHUB_STEP_SUMMARY` alongside existing stages.
- Trend roll-ups become part of the scheduled factory cadence without changing
  existing stage failure isolation behavior.

## Alternatives considered

- Keep `trend-analyst` uninvoked: rejected because it leaves cross-ticket root
  cause aggregation manual and inconsistent.
- Add `trend-analyst` to a faster cadence workflow: rejected because the issue
  requirement is daily roll-up after the full day’s issue/doc activity.

## Evidence

- `.github/workflows/pipeline-daily.yml` — added `Stage — Trend Analyst` and
  summary step as stage 3 (last stage).
- `.github/agents/trend-analyst.agent.md` — existing agent definition and
  `auto:trend` roll-up behavior.
- Issue: `#406`
