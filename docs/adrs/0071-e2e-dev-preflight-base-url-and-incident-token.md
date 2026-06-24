# ADR-0071: E2E dev workflow preflights base URL and uses github.token for incidents

- **Status:** Superseded by ADR-0098
- **Date:** 2026-06-21
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** Superseded by ADR-0098

## Context

`Test - E2E Dev` runs on `main` continued to execute with a blank
`vars.E2E_BASE_URL`, causing Playwright suites to skip and skip-budget checks to
fail noisily. The workflow then filed repeated incident updates without an
explicit configuration error at the point of failure.

The same incident path must always have a valid token for `gh issue`
create/comment commands in the failure handler.

## Decision

We add an explicit base-URL preflight in E2E dev jobs before Playwright
execution and fail immediately if `vars.E2E_BASE_URL` is missing or not an HTTP
URL. We also set the incident step token directly from `github.token` so the
reporting path is always populated in this workflow.

## Consequences

- E2E dev runs now fail fast with a clear configuration error when
  `vars.E2E_BASE_URL` is unset.
- The smoke incident handler keeps a guaranteed token source and can update the
  deduplicated incident on failure.
- Entity drill-down preserves its existing policy to skip cleanly when auth
  credentials are absent, but now validates base URL when it does run.

## Alternatives considered

- Keep relying on skip-budget failures as implicit config detection. Rejected
  because this produces noisy failure modes and unclear root cause.
- Continue token fallback chaining for incident filing. Rejected in favor of a
  single guaranteed workflow token source.

## Evidence

- `.github/workflows/e2e-dev.yml`
- Issue: `#40`
