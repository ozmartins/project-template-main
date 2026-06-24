# ADR-0125: Workflow run-shell context uses env indirection

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Copilot coding agent (@copilot)
- **Supersedes / Superseded by:** N/A

## Context
Semgrep reported HIGH-severity `run-shell-injection` findings in multiple control-plane workflow files where `${{ ... }}` context values were interpolated directly inside `run:` shell scripts. These values can originate from attacker-influenced metadata (for example dispatch inputs, refs, and event payload fields), so direct interpolation increases script-injection risk in privileged CI jobs. Repository policy requires an ADR for `.github/workflows/**` changes.

## Decision
We move context expressions out of inline shell scripts and into step-level `env:` assignments, then reference only shell variables inside `run:` blocks for the flagged workflow steps.

```yaml
# before
run: |
  echo "Triggered by: ${{ github.ref }} @ ${{ github.sha }}"

# after
env:
  GITHUB_REF: ${{ github.ref }}
  GITHUB_SHA: ${{ github.sha }}
run: |
  echo "Triggered by: ${GITHUB_REF} @ ${GITHUB_SHA}"
```

## Consequences
This removes semgrep-detected injection paths without changing workflow intent, inputs, or downstream outputs. Workflow steps now follow a safer and more uniform pattern for shell parameter handling, reducing accidental reintroduction of the same class of issue. Future workflow edits must keep context expansion outside shell bodies.

## Alternatives considered
- Keep direct `${{ ... }}` interpolation and suppress semgrep findings: rejected because it preserves a known injection risk.
- Rewrite affected steps into JavaScript actions: rejected as unnecessary scope expansion for a targeted hardening issue.

## Evidence
Implemented in this PR across:
- `.github/workflows/architecture-audit.yml`
- `.github/workflows/audit-azure-security.yml`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/deploy-test.yml`
- `.github/workflows/rerun-blocked-runs.yml`
