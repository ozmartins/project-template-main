# ADR-0104: Trusted rerun backstop for same-repo Copilot PR workflow gates

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** none

## Context

Same-repo Copilot pull requests have been repeatedly landing in `action_required`, which prevents required `pull_request` workflows from starting until a trusted actor re-runs them. Issue #451 groups the recurring incidents and explicitly allows either a repository settings fix or an equivalent maintainer-owned rerun path.

Repository settings are not fully expressible inside this template, and the current troubleshooting guidance depended on ad-hoc `gh pr update-branch` or empty-commit pushes by a maintainer. That clears one PR at a time, but it is not a versioned, auditable, least-privilege control-plane path.

## Decision

We add a manual workflow, `pr-trusted-rerun.yml`, that accepts a same-repo pull request number, finds `action_required` `pull_request` workflow runs for that PR head SHA, and re-runs them with job-scoped `GITHUB_TOKEN` permissions (`actions: write`, `pull-requests: read`, `contents: read`).

The workflow is documented in the active workflow catalog and CI troubleshooting/activation guides so maintainers have a single trusted backstop while repository/org Actions approval settings are being corrected.

## Consequences

- Maintainers can clear the approval gate for all blocked workflows on one Copilot PR without pushing speculative commits or using a broad PAT.
- The rerun path is auditable in version control and produces a step summary with the PR, head SHA, and re-run run IDs.
- This does not remove the underlying GitHub Actions approval-policy defect; maintainers still need to correct repo/org settings to stop new runs landing in `action_required`.
- The workflow is intentionally limited to same-repo PRs because the trend affects same-repo Copilot branches and fork approval policies have different trust rules.

## Alternatives considered

- **Document-only guidance (`gh pr update-branch` / empty commit):** rejected because the issue asks for a systemic fix or equivalent rerun path, and ad-hoc commands are not a governed control-plane mechanism.
- **Use `PROJECT_MANAGER_PAT` in a workflow:** rejected because the rerun API should work with `GITHUB_TOKEN` plus `actions: write`, and the repository policy prefers least-privilege runtime identities for factory workflows.
- **Wait for a manual settings-only fix:** rejected because template users still need a versioned operational backstop that survives forks and documents the failure mode.

## Evidence

- `.github/workflows/pr-trusted-rerun.yml`
- `.github/tools/shared/src/__tests__/pr-trusted-rerun-contract.test.ts`
- `.github/workflows/WORKFLOWS.md`
- `.github/FACTORY-ACTIVATION.md`
- `docs/troubleshooting.md`
- Issue `#451`
