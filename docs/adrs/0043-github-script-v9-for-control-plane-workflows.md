# ADR-0043: Use actions/github-script v9 in control-plane workflows

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

`.github/workflows/pr-enrichment.yml` is a control-plane workflow that classifies PR risk and routes specialist review labels. It currently runs `actions/github-script`, and this repository tracks action major upgrades through Dependabot.

Because workflow files are a control-plane boundary in this repository, action major-version upgrades need an ADR in the same PR so platform review can validate the change against an explicit decision record.

## Decision

Use `actions/github-script@v9` for PR enrichment and treat this major-version bump as an explicit, documented control-plane decision.

## Consequences

**Positive:**
- Keeps the workflow on the current major of `actions/github-script`.
- Provides an auditable record for a control-plane dependency upgrade.

**Negative:**
- Workflow dependency bumps that touch `.github/workflows/**` now carry ADR overhead in the same PR.
- Any future major bump still requires review for runtime compatibility and permission implications.

## Alternatives considered

**Stay on `actions/github-script@v7`:** rejected because it leaves the workflow on an older major while Dependabot already identified an upgrade path.

**Upgrade without ADR:** rejected because control-plane workflow changes in this repository require ADR-backed rationale in the same PR.

## Evidence

- `.github/workflows/pr-enrichment.yml` (`uses: actions/github-script@v9`)
- Commit `662f83a` (`chore(deps): Bump actions/github-script from 7 to 9`)
