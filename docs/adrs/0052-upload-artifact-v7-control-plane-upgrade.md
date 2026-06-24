# ADR-0052: Use actions/upload-artifact v7 in control-plane workflows

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

Several control-plane workflows in this repository upload CI artifacts (build logs, audit reports, test results, validation outputs) using `actions/upload-artifact`. The dependency was pinned to major version 4; Dependabot proposed a bump to version 7.

Because `.github/workflows/**` is a control-plane boundary in this repository, a major-version action upgrade must be accompanied by an ADR in the same PR, per ADR-0044.

`actions/upload-artifact` v6+ requires Actions Runner >= 2.327.1 on self-hosted machines. Two workflows in this repository run on the `factory-cluster-guardian` self-hosted runner:

- `.github/workflows/audit-azure-security.yml`
- `.github/workflows/audit-cis-kubernetes.yml`

Because there is no in-repo evidence that the `factory-cluster-guardian` runner fleet meets the 2.327.1 floor, those two workflows are kept at `actions/upload-artifact@v4` until the runner version is confirmed or enforced. The three GitHub-hosted workflows have no such constraint and are upgraded to v7:

- `.github/workflows/build-images.yml`
- `.github/workflows/e2e-dev.yml`
- `.github/workflows/pr-validation.yml`

The upgraded workflows retain their existing least-privilege `permissions` blocks and artifact retention settings — no permission or retention changes are introduced alongside this version bump.

## Decision

We use `actions/upload-artifact@v7` in GitHub-hosted control-plane workflows that upload artifacts. Workflows that run on the `factory-cluster-guardian` self-hosted runner remain on `actions/upload-artifact@v4` until the runner fleet is confirmed to meet the Actions Runner >= 2.327.1 requirement.

## Consequences

**Easier:**
- GitHub-hosted workflows stay current with the upstream-maintained major release and benefit from any bug fixes and performance improvements in v5, v6, and v7.
- Reduces unsupported-version drift for the GitHub-hosted fleet without introducing a potential runtime failure on self-hosted runners.

**Harder:**
- Version split between GitHub-hosted (v7) and self-hosted (v4) workflows until the runner floor is validated.
- Any future major upgrade to v8+ will again require an ADR per ADR-0044.

**New obligations:**
- Once the `factory-cluster-guardian` runner is confirmed at Actions Runner >= 2.327.1, upgrade `audit-azure-security.yml` and `audit-cis-kubernetes.yml` to `actions/upload-artifact@v7` (or the current latest) in a follow-up PR with an updated or superseding ADR.
- If artifact upload or download behaviour regresses after this bump, roll back the affected GitHub-hosted workflows to `actions/upload-artifact@v4` and supersede this ADR.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Upgrade all five workflows to v7 including self-hosted | Runner floor (Actions Runner >= 2.327.1) cannot be confirmed for `factory-cluster-guardian` in this PR; risked silent upload failures |
| Keep all workflows on v4 | Leaves GitHub-hosted workflows on an older major version unnecessarily |
| Add runner version enforcement in this PR | Out of scope for a Dependabot dependency bump |

## Evidence

- Pull request: `chore(deps): Bump actions/upload-artifact from 4 to 7`
- Workflow files upgraded to v7 (GitHub-hosted):
  - `.github/workflows/build-images.yml`
  - `.github/workflows/e2e-dev.yml`
  - `.github/workflows/pr-validation.yml`
- Workflow files kept at v4 (self-hosted runner, runner floor unconfirmed):
  - `.github/workflows/audit-azure-security.yml` (`runs-on: [self-hosted, linux, x64, factory-cluster-guardian]`)
  - `.github/workflows/audit-cis-kubernetes.yml` (`runs-on: [self-hosted, linux, x64, factory-cluster-guardian]`)
- ADR-0044: Control-plane workflow action major-version upgrades require in-PR ADRs

