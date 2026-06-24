# ADR-0080: Pin workflow actions to immutable commit SHAs

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** N/A

## Context
Workflow files under `.github/workflows/` referenced actions by mutable tags (for example `@v4` and `@v5`). Mutable tags are a supply-chain risk because a retargeted upstream tag can change executed code without any repository diff.

During security follow-up on this same hardening PR, `.github/workflows/code-quality.yml` was also updated to move Trivy from compromised `v0.28.0` to patched `v0.36.0`, pinned by full commit SHA.

This repository treats workflow changes as a control-plane boundary and requires auditable hardening decisions for those updates.

## Decision
Pin every `uses:` reference in `.github/workflows/*.yml` to a full 40-character commit SHA and keep a trailing comment with the human-readable tag.

## Consequences
**Positive:**
- Workflow dependencies become immutable and auditable at review time.
- CI execution no longer depends on mutable upstream tags.
- Dependabot `github-actions` updates can safely rotate SHAs through normal PR review.

**Negative:**
- Action updates require explicit SHA bumps instead of implicit tag drift.
- Workflow files become more verbose.

## Alternatives considered
1. Keep major tags (for example `@v4`) and rely on maintainers — rejected due to mutable-tag supply-chain risk.
2. Pin only third-party actions — rejected because official and third-party actions can both be retargeted.
3. Use branch refs (`@main`/`@master`) — rejected because branches are mutable and least secure.

## Evidence
- `.github/workflows/*.yml` `uses:` references now pinned to full SHAs with version comments.
- `.github/workflows/code-quality.yml` uses `aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25  # v0.36.0`.
- `.github/dependabot.yml` includes `package-ecosystem: "github-actions"` to maintain action updates.
