# ADR-0044: Control-plane workflow action major-version upgrades require in-PR ADRs

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

Changes under `.github/workflows/**` modify CI/CD control-plane behavior for the repository. Even dependency-only workflow edits (for example, major-version action bumps) can affect deployment and validation execution paths across environments.

This repository's review policy requires an ADR in the same PR for control-plane changes so platform reviewers can assess risk and rollback expectations from a written decision record rather than from YAML diffs alone.
ADR-0043 was merged on `main` in parallel for a specific `actions/github-script` major bump; this ADR generalizes that same review requirement for future control-plane major upgrades.

## Decision

We record control-plane major-version action upgrades with an ADR in the same PR that changes `.github/workflows/**`, including the rationale, risks, and rollback path.

For this change set, `azure/setup-helm` is upgraded from `v4` to `v5` in deployment and validation workflows to keep workflow dependencies current and reduce unsupported-version risk.

## Consequences

**Easier:**
- Platform review has a durable decision record for workflow dependency upgrades.
- Future debugging of workflow regressions can reference explicit upgrade intent and affected files.

**Harder:**
- Workflow dependency bumps now require lightweight architecture documentation in addition to YAML edits.

**New obligations:**
- Each control-plane workflow PR must include or reference an ADR in `docs/adrs/`.
- If a major action bump causes regression, rollback is to pin the affected workflows back to the prior major version and document the superseding ADR if the policy changes.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Merge workflow dependency bump without ADR | Violates control-plane review policy and makes risk acceptance implicit rather than explicit |
| Delay upgrade until platform sweep PR | Leaves known drift longer and increases batch-risk by combining unrelated control-plane changes |

## Evidence

- Workflow files updated in this PR:
  - `.github/workflows/deploy-dev.yml`
  - `.github/workflows/deploy-test.yml`
  - `.github/workflows/deploy-prod.yml`
  - `.github/workflows/k8s-render-validate.yml`
  - `.github/workflows/pr-validation.yml`
- Commit: `869a228` (`chore(deps): Bump azure/setup-helm from 4 to 5`)
