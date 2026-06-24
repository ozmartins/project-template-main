# ADR-0077: E2E dev skip-budget checks require Playwright results output

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`Test - E2E Dev` can fail during base-URL preflight when `vars.E2E_BASE_URL` is unset.
In that path, Playwright never runs and does not create `frontend/e2e-results.json`.
The unconditional skip-budget steps then fail with `ENOENT`, adding noisy follow-on
errors that obscure the primary bootstrap/configuration failure.

## Decision

We gate smoke and experience skip-budget checks on whether their Playwright execution
steps actually ran, and we emit an explicit error if a results file is unexpectedly
missing after execution.

## Consequences

- Missing `E2E_BASE_URL` now surfaces as a single clear preflight failure instead of
  being mixed with a misleading file-not-found cascade.
- If Playwright runs but fails to emit `e2e-results.json`, the workflow fails with a
  direct contract error.
- Skip-budget enforcement remains unchanged when tests execute normally.

## Alternatives considered

- Keep unconditional skip-budget checks and accept `ENOENT` noise. Rejected because it
  obscures the root cause and weakens incident triage quality.
- Move missing-file handling into the Node skip-budget script. Rejected to keep the
  script focused on budget logic and preserve per-job execution context in workflow logs.

## Evidence

- `.github/workflows/e2e-dev.yml`
- Issue: `#370`
