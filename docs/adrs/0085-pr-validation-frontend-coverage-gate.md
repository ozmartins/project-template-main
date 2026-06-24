# ADR-0085: PR validation frontend unit tests enforce coverage thresholds

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot coding agent (@copilot)
- **Supersedes / Superseded by:** N/A

## Context
The `coverage` job is intentionally non-gating and runs only on push-to-main for trend telemetry. Without a gating coverage path in PR validation, test coverage can regress silently while CI still passes.

## Decision
We enforce coverage in the PR-gating frontend unit-test step by running Vitest with `--coverage`, and we define minimum thresholds in `frontend/vitest.config.ts`.

## Consequences
PR validation now fails deterministically when frontend coverage drops below the configured floor, while the non-gating `coverage` trend job remains unchanged for historical reporting.

## Alternatives considered
- Keep enforcement in the non-gating `coverage` job only. Rejected because it cannot block low-coverage PRs.
- Enforce coverage only in workflow logic without test-runner thresholds. Rejected because runner-level thresholds are the authoritative gate and apply consistently in local and CI runs.

## Evidence
- `.github/workflows/pr-validation.yml`
- `frontend/vitest.config.ts`
