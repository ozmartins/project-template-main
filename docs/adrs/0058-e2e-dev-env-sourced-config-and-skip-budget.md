# ADR-0058: E2E dev workflow uses `dev` environment config and enforces skip budget

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** N/A

## Context
The deployed-environment E2E workflow (`.github/workflows/e2e-dev.yml`) was repeatedly recording fully skipped suites (`smoke` and `experience`) with `base_url: null`. This produced green runs without real browser coverage and breached the QA skip-rate SLO (`max_skip_pct <= 25%`).

The workflow consumed repository-level `vars.E2E_BASE_URL` and secrets, but did not bind jobs to the `dev` environment where deployed-target configuration is managed. As a result, Playwright jobs executed with empty E2E config and skipped all tests.

## Decision
We bind all `e2e-dev.yml` jobs to the `dev` GitHub Actions environment, pass MFA code support through workflow env, and enforce a max 25% skip budget in smoke and experience job results.

We also require smoke execution to include real browser assertions (`smoke.spec.ts` + `navigation.spec.ts`) alongside existing suite coverage.

## Consequences
- Deployed E2E now reads environment-scoped base URL and auth credentials consistently across smoke, experience, entity drill-down, and history publication.
- Fully skipped suites now breach the skip-budget guard, making configuration regressions fail loudly instead of appearing green.
- This adds an operational expectation: `dev` environment E2E secrets/vars must remain configured for ongoing signal quality.

## Alternatives considered
- Keep repository-level vars/secrets only and document setup more loudly. Rejected because this did not prevent repeated empty-config runs.
- Keep placeholder-heavy smoke execution and only post-process skip metrics. Rejected because this still under-signals real browser coverage.
- Remove test-level `skip()` behavior globally. Rejected because this would break fresh-fork ergonomics beyond the deployed dev workflow.

## Evidence
- `.github/workflows/e2e-dev.yml`
- `.github/scripts/check-e2e-skip-budget.mjs`
- `frontend/e2e/smoke.spec.ts`
- `README.md`
- `.github/FACTORY-ACTIVATION.md`
