# ADR-0100: Isolate `contents: write` to factory-architect publish job in pipeline-hourly

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay
- **Supersedes / Superseded by:** none

## Context

The factory-architect agent runs in `pipeline-hourly.yml` and is responsible for converting architecture-queue issues into specs and ADRs committed to `docs/`. The workflow previously declared `permissions: contents: read`. The `actions/checkout` step injects the `GITHUB_TOKEN` as the git credential, so any `git push` by the agent uses that token regardless of what `GH_TOKEN` is set to. With `contents: read`, every push attempt returned HTTP 403.

Evidence: run 27926966279 log — `"repository contents push is blocked with HTTP 403"` — agent committed locally as `3029d05` but could not push. This caused #458 to loop in `design-in-progress` for days with duplicate design-artifact comments and no files ever reaching the remote.

The diary agent (`pipeline-weekly-diary.yml`) has `contents: write` and successfully commits diary entries to `docs/diary/` on the same runner with the same SDK pattern.

## Decision

`pipeline-hourly.yml` is split into two jobs:

- `factory_architect_publish` gets job-scoped `permissions.contents: write` so the factory-architect stage can publish specs/ADRs.
- `hourly_readonly_stages` (qa-manager, operations-manager, cluster-guardian) keeps `permissions.contents: read`.

This preserves the direct-publish behavior for factory-architect while restoring least privilege for non-publishing hourly stages.

## Consequences

- Factory-architect can publish `docs/specs/` and `docs/adrs/` files directly without a PR, unblocking the design → implementation pipeline.
- Direct pushes to `main` from factory-architect remain intentional and limited to the publish job.
- Non-publishing hourly stages no longer receive repository-write scope, reducing blast radius if one of those stages is compromised.
- Branch protection rules on `main` (if any require PR for code changes) do not apply to this workflow because it runs as a GitHub Actions bot with bypass permissions. If that bypass is ever removed, the publish job would need to switch to a branch + PR pattern.

## Alternatives considered

- **PR-based publish**: agent pushes to `architect/<slug>` branch and opens a PR. More overhead, slower feedback loop, not consistent with how diary commits work. Rejected in favour of the simpler direct-push pattern already used by diary.
- **Use PROJECT_MANAGER_PAT for git**: configure git to use the PAT instead of `GITHUB_TOKEN`. More fragile (PAT rotation breaks git auth), less explicit than a workflow permission grant. Rejected.

## Evidence

- `pipeline-weekly-diary.yml` line 26: `contents: write` — working precedent for publish jobs
- Run 27926966279 log: `Contents: read` + HTTP 403 on push
- `pipeline-hourly.yml` now scopes `contents: write` to `factory_architect_publish` and keeps read-only permissions for remaining hourly stages
