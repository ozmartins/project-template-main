# ADR-0108: Maintainer-dispatched rerun of same-repo action_required workflow runs

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Ian Reay
- **Supersedes / Superseded by:** none

## Context

Repeated evidence from the operations-manager sweep (issues #119, #132) showed that same-repo Copilot-bot and Dependabot PRs frequently land in `conclusion=action_required` immediately after being triggered. A `gh run rerun` from a trusted actor consistently moves the blocked run back to `in_progress` or `success`.

Representative affected workflows: `PR - Validation`, `PR - Enrichment`, `CICD - Build Images`, `Security - Gitleaks secret scan`, `Validate - Semgrep`, `PR - OSV Dependency Scan`.

The root cause is a GitHub repository or organisation Actions approval policy that requires a human to approve workflow runs from GitHub Apps (Copilot, Dependabot) before they execute. Changing that setting is a manual, one-time operation that a maintainer must perform in Settings → Actions → General. Until the setting is confirmed stable, every new PR from those bots regenerates the problem.

A scheduled, repo-wide drain that runs automatically with an elevated PAT was evaluated but rejected (see Alternatives below) because it reintroduces a broad high-privilege identity as the workflow runtime, conflicting with the least-privilege posture tracked in issue #454.

## Decision

Add `.github/workflows/rerun-blocked-runs.yml` — a `workflow_dispatch`-only workflow invoked by a maintainer for a specific PR. The maintainer supplies the head commit SHA of the blocked PR; the workflow queries for `action_required` runs at that SHA and calls `gh run rerun` on each.

**Authentication and permissions:** The workflow uses only the job-scoped `${{ github.token }}` with explicit minimal permissions (`actions: write`, `contents: read`, `pull-requests: read`). No PAT is used as the workflow runtime identity. This keeps any elevated-privilege credential out of the scheduled or background execution path.

**Scope:** By requiring a `head_sha` input and querying only runs for that SHA, the workflow is bounded to one PR at a time. A maintainer can invoke it in succession for multiple PRs but each invocation is deliberately narrow.

**Limitation acknowledged:** If the org/repo approval gate also gates `github-actions[bot]`-identity reruns, `github.token` may not clear the `action_required` state. In that scenario the correct resolution is the root-cause settings fix (see README.md "Actions approval policy"), not escalating to a broader identity in this workflow.

## Consequences

- **Easier:** Maintainers have a reproducible, auditable one-click dispatch path to clear a specific blocked PR without granting broad PAT access to an automated scheduler.
- **Safer:** No high-privilege secret is bound to a scheduled cron job that runs unconditionally every 10 minutes. Permissions are minimal and explicit.
- **Trade-off:** Unlike the scheduled variant, this workflow requires a human to notice and trigger it. The preferred long-term fix remains the root-cause settings change.
- **Follow-up obligation:** After a maintainer corrects the repo/org Actions approval setting so that bot PRs run without approval, this workflow becomes a non-critical convenience tool. It should remain in place for future approval-gate regressions.

## Alternatives considered

- **Scheduled cron with `PROJECT_MANAGER_PAT` (rejected):** A scheduled workflow running every 10 minutes with a human-backed PAT would drain the queue without manual intervention. Rejected because it makes a high-privilege token the workflow runtime identity for a cron job, reintroducing the risk pattern tracked in issue #454. The PAT is valid for all API operations, not just `actions:write`, and running it on a schedule rather than on-demand maximises the exposure window.
- **Manual reruns only (status quo):** Maintainers can invoke `gh run rerun` directly from the CLI. This workflow provides a convenient audit trail via the Actions UI without requiring local CLI access.
- **Event-driven via `workflow_run`:** GitHub does not fire a `workflow_run` event for runs ending in `action_required`, so no event-driven trigger exists for this specific state.
- **Fixing the root cause only (settings change):** That change must happen, but it requires maintainer access and has been escalated separately. A code-level dispatch backstop is still valuable for edge cases.
- **Expanding the operations-manager agent:** The ops agent uses an LLM and a long runner budget. Embedding bulk rerun logic there adds latency and costs tokens on every sweep even when no runs are blocked. A thin, purpose-built workflow is cheaper and more reliable.

## Evidence

- Issue #119: monitoring supersession tracking the approval regression.
- Issue #132: escalated escalation with 20+ evidence comments confirming `action_required` recurrence.
- Issue #454: tracks the high-privilege PAT default that motivated keeping the PAT out of the workflow runtime identity.
- Operations-manager sweep logs: `gh run rerun` consistently moved blocked runs from `action_required` to `in_progress`.
- `.github/workflows/rerun-blocked-runs.yml`: implementation of this ADR.
