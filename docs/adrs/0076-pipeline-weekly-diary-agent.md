# ADR-0076: Weekly diary-agent pipeline

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The factory has no regular reflection mechanism. Weekly output such as shipped PRs,
in-flight PR health, operational alerts, process observations, and market signals
accumulates across multiple sources but is never synthesised into a persistent record.

A `diary-agent` was specified in issue #428 to fill this gap. It is a read-only output
agent: it reads existing signals, writes a diary entry to `docs/diary/YYYY-WXX.md`,
updates a rolling index in `docs/diary/README.md`, and never files issues or modifies
code.

Because this introduces a new workflow under `.github/workflows/**`, the change is a
control-plane boundary and requires an in-PR ADR.

## Decision

We add a new `pipeline-weekly-diary.yml` workflow that runs the `diary-agent` every Friday
at 18:00 UTC (`0 18 * * 5`). It follows the same isolated `continue-on-error`,
timeout, and step-summary pattern as the existing daily pipeline. The workflow is
granted `contents: write` so the agent can commit diary files, and `issues: read` /
`pull-requests: read` for the read-only signal gathering.

The runtime credential is `github.token`, scoped to the explicit permission block above.
No PAT is required because the diary agent only reads existing repository data and
writes to `docs/diary/` within the same repository.

The diary agent never files issues or modifies production code — its only write
surface is `docs/diary/`.

## Consequences

- A weekly factory diary is generated automatically every Friday at 18:00 UTC.
- `docs/diary/` is a new directory committed to the repository by the workflow.
- The `contents: write` permission is necessary for the commit step and is scoped
  to the weekly pipeline only; it is not added to other pipelines.
- If `COPILOT_TOKEN` is unavailable, the stage fails with
  `continue-on-error: true` and the pipeline reports `⚠️ failure` in the summary
  without blocking any other work.
- The rolling index keeps the last 12 weeks; older entries remain as files but are
  dropped from `docs/diary/README.md`.

## Alternatives considered

- **Run diary-agent in the daily pipeline:** rejected because a daily cadence would
  produce redundant entries; a weekly end-of-week summary is the intended grain.
- **Manual diary entries only:** rejected because the whole point is automated,
  consistent synthesis — manual entries would be skipped or inconsistent.
- **Separate commit step outside the agent:** the agent already handles the commit
  internally (using `git config` + `git push`) which keeps the diary logic self-contained.

## Evidence

- `.github/workflows/pipeline-weekly-diary.yml` — new weekly diary workflow, single `diary-agent` stage.
- `.github/agents/diary-agent.agent.md` — new agent definition, read-only output contract.
- `docs/diary/README.md` — initial rolling index placeholder.
- Issue: #428

