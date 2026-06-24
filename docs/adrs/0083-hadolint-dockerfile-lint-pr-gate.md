# ADR-0083: Hadolint Dockerfile linting as a PR gate

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

Dockerfile quality issues — running `npm install` instead of `npm ci`, missing `USER` directives, unsafe `COPY` patterns, and unpinned base image tags — are only caught in code review today, and only when reviewers notice them. These issues can introduce supply-chain risk, non-deterministic dependency trees, or containers that run as root.

Adding hadolint as a CI gate catches these issues mechanically before code merges, with a configurable suppression file (`.hadolint.yaml`) for accepted deviations that must be justified inline.

Control-plane workflow changes in this repository require an ADR in the same PR per the repository policy.

## Decision

We add a `dockerfile-lint` job to `.github/workflows/pr-validation.yml` that runs `hadolint/hadolint-action` (pinned to a full commit SHA) against `frontend/Dockerfile` and `temporal/Dockerfile` on every PR and push to `main`. The job uses `failure-threshold: warning` so warnings as well as errors gate the PR. We add `.hadolint.yaml` at the repo root as the canonical suppression file; all suppressions must carry an inline justification comment. The job is wired into the `validation-summary` gate so the summary fails closed when this job fails.

## Consequences

- Dockerfile defects are caught at PR time rather than during code review or after deployment.
- The `hadolint-action` reference is pinned to a full commit SHA to prevent supply-chain drift from mutable version tags.
- Workflow permissions remain read-only (`contents: read`, `pull-requests: read` at the workflow level); the job needs no secrets.
- The `.hadolint.yaml` suppression file is reviewable and auditable in the same PR as any change that adds a suppression.
- Future Dockerfile changes must pass hadolint; suppressions require explicit justification, not blanket ignores.

## Alternatives considered

- **Run hadolint as a local pre-commit hook only:** rejected because pre-commit can be bypassed and does not provide an enforceable PR gate.
- **Use a mutable tag (`hadolint/hadolint-action@v3.1.0`) without SHA pinning:** rejected per the security review requirement for immutable action refs.
- **Suppress all DL rules for the existing Dockerfiles:** rejected because both current Dockerfiles pass hadolint without suppressions; blanket ignores would undermine the gate's value.

## Evidence

- `.github/workflows/pr-validation.yml` — `dockerfile-lint` job
- `.hadolint.yaml` — suppression file
- hadolint: https://github.com/hadolint/hadolint (MIT)
- hadolint-action: https://github.com/hadolint/hadolint-action
- Issue: Volaris-AI/project-template#28
