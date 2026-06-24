# ADR-0076: Weekly pipeline and personas-curator agent

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

User personas are typically created once and forgotten. The factory has no automated
process to synthesise product direction (issues, epics, roadmap) with feature request
patterns into living persona documents that the team can reference when prioritising
work.

Adding a new workflow under `.github/workflows/**` is a control-plane boundary change
and requires an ADR in the same PR.

## Decision

We add a new `pipeline-weekly.yml` GitHub Actions workflow running every Monday at
09:00 UTC, and a new `personas-curator` agent
(`.github/agents/personas-curator.agent.md`) as its sole stage. The agent reads
issues and epics tagged `user-story`, `user-request`, `ux`, `accessibility`, and any
`segment:*` labels, then creates or updates persona files under `docs/personas/` and
keeps `docs/personas/README.md` as a live index. Personas are never deleted; stale
ones are marked `status: retired`.

## Consequences

- `docs/personas/` becomes a continuously maintained library of user personas derived
  from real issue/epic evidence.
- The weekly cadence runs independently of the daily and hourly pipelines; a failure
  there does not affect those pipelines.
- The workflow requires `contents: write` permission so the agent can commit persona
  file changes via the shared run-agent tooling.
- Persona files accumulate over time; the `status: retired` mechanism prevents
  unbounded active-persona count without data loss.

**Rollback:** Disable `.github/workflows/pipeline-weekly.yml` to stop automated
persona maintenance. Existing `docs/personas/` files are inert markdown and cause no
harm if the workflow is disabled.

## Alternatives considered

- Add personas-curator as a stage in `pipeline-daily.yml`: rejected because persona
  synthesis is a weekly synthesis task; running it daily would add noise and API cost
  without proportional signal.
- Manual persona maintenance only: rejected because personas are routinely forgotten
  and quickly become stale when maintained manually.
- Separate standalone cron workflow per agent: rejected in favour of the existing
  pipeline-per-cadence pattern established for daily and hourly pipelines.

## Evidence

- `.github/workflows/pipeline-weekly.yml` — new weekly pipeline, single stage.
- `.github/agents/personas-curator.agent.md` — new agent definition.
- `docs/personas/README.md` — initial empty index, populated by first agent run.
- Issue: `#426`
