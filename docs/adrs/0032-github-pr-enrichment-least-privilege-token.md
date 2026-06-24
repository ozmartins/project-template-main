# ADR-0032: PR Enrichment Uses Minimal Pull-Request Token

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The `pr-enrichment.yml` workflow applies labels and context to PRs at open/sync time. It runs on `pull_request` events — which means, for fork PRs, it runs in a context with restricted token permissions. Using a full PAT for this workflow would either fail on fork PRs (token scoped to the base repo) or require granting broad permissions to an event that fires on untrusted code.

More broadly, any workflow that fires on PR events should follow the principle of least privilege: request only the permissions it needs, and no more.

## Decision

`pr-enrichment.yml` uses **only the minimal GITHUB_TOKEN permissions** required for its work:

```yaml
permissions:
  pull-requests: write  # to apply labels and post the enrichment comment
  contents: read        # to read the PR diff and file list
```

It does not use a PAT. It does not request `issues: write`, `checks: write`, or any other scope. If future enrichment steps need additional permissions, they must be explicitly added with a rationale comment in the workflow YAML.

The same principle applies to all workflows: the `permissions:` block is required in every workflow file. A workflow without an explicit `permissions:` block inherits the repository default (often `read-all` or `write-all`), which violates least privilege.

**Fork PR handling:** The GITHUB_TOKEN on fork PRs has read-only access. Enrichment that requires write access (labels, comments) must use the `pull_request_target` event type carefully, or accept that enrichment does not run on fork PRs. The default template assumes same-repo PRs (Copilot PRs are always same-repo).

## Consequences

**Positive:**
- A compromised or misbehaving enrichment step cannot escalate to repo-wide write access.
- The `permissions:` block is a self-documenting contract — reviewers can see exactly what the workflow can do without reading the step implementation.
- Complies with GitHub's recommended minimal-permissions model for GITHUB_TOKEN workflows.

**Negative:**
- Every new workflow must have its `permissions:` block designed up front. This is a code-review discipline concern.
- Fork PR enrichment is limited. A fork contributor's PR will not receive the full enrichment until it is merged (or until a maintainer manually triggers enrichment). This is acceptable for the template's use case (Copilot is same-repo).

## Alternatives considered

**PAT for all workflow operations:** Simplifies permission management but creates a single high-privilege credential whose rotation affects all workflows. Least-privilege GITHUB_TOKEN is strictly better for scoped operations.

**Shared elevated permissions via environment protection rules:** GitHub allows environment-scoped secrets with required reviewers. Appropriate for deploy workflows; disproportionate for a label-application step.

## Evidence

- `.github/workflows/pr-enrichment.yml` — `permissions:` block
- `.github/copilot-instructions.md` — protected paths policy
- ADR-0010 — runner placement (same philosophy: least-privilege defaults)
