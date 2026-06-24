# ADR-0091: Nightly developer-docs coverage pipeline and manager agent

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`docs/developer/` has no automated coverage owner today, so onboarding guidance can drift into scattered root-level docs instead of a clear guide set. This issue introduces a new control-plane workflow and agent under `.github/workflows/**` and `.github/agents/**`, which is an architectural boundary and requires a same-PR ADR.

## Decision

We add a nightly `pipeline-nightly-devdocs.yml` workflow (22:00 UTC, plus `workflow_dispatch`) that runs a new `developer-docs-manager` agent. The agent bootstraps prioritized docs coverage tickets when `docs/developer/` is empty, then maintains steady-state coverage using a PR watermark and deduplicated `developer-docs-<area>` fingerprints.

## Consequences

- Developer documentation coverage gains a dedicated owner lane (`developer-docs-manager`) and scheduled cadence.
- The first manual/nightly run can open a bounded starter backlog (up to 5 tickets) for high-priority missing guides.
- Ongoing runs focus only on PR-touched high-signal paths (`frontend/src`, `temporal`, `supabase/migrations`, `charts`, `terraform`) to reduce noise.
- The workflow needs issue-write permission to create/update tracker and coverage tickets.

**Rollback:** Disable or remove `.github/workflows/pipeline-nightly-devdocs.yml` to stop automatic ticket generation. Existing tickets and docs files remain valid and can be managed manually.

## Alternatives considered

- Fold this into `pipeline-daily.yml`: rejected to keep existing daily stages stable and avoid coupling new docs-manager behavior to unrelated daily responsibilities.
- Rely on docs-improver only: rejected because docs-improver is threshold/repeat-signal oriented and not designed to proactively bootstrap `docs/developer/` coverage from empty state.
- Manual tracking only: rejected because coverage gaps are easy to miss without an explicit owner and watermark process.

## Evidence

- `.github/agents/developer-docs-manager.agent.md`
- `.github/workflows/pipeline-nightly-devdocs.yml`
- `docs/developer/README.md`
- `README.md`
- `.github/README.md`
- `.github/workflows/WORKFLOWS.md`
- Issue: `#596`
