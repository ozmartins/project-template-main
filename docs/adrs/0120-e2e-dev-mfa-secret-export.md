# ADR-0120: Export E2E_MFA_SECRET in e2e-dev workflow jobs

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Copilot (issue #1198)
- **Supersedes / Superseded by:** —

## Context

`frontend/e2e/smoke.spec.ts` implements a `resolveMfaCode` helper that resolves an
MFA code in priority order:

1. `E2E_MFA_CODE` — a static pre-computed TOTP code (useful for single-run tests).
2. `E2E_MFA_SECRET` — a base32 TOTP secret from which a live code is derived via
   `generateTotpCode()`.
3. The `[data-testid='mfa-secret']` element from an active MFA enrollment page.

The three jobs in `.github/workflows/e2e-dev.yml` (`e2e`, `entity-drilldown`,
`experience`) each expose `E2E_MFA_CODE` as an env secret, but none exported
`E2E_MFA_SECRET`. When a test account has MFA enabled and `E2E_MFA_CODE` is not
set as a static code, TOTP derivation silently falls through to the DOM fallback
(or throws), causing smoke tests to fail on the MFA challenge step.

## Decision

We add `E2E_MFA_SECRET: ${{ secrets.E2E_MFA_SECRET }}` to the `env` block of
each of the three e2e-dev jobs, alongside the existing `E2E_MFA_CODE` line, so
that `resolveMfaCode` can derive a live TOTP code from the secret when needed.

## Consequences

- Smoke tests that rely on TOTP derivation will now succeed when `E2E_MFA_SECRET`
  is configured in the `dev` environment secrets.
- No behavior change when neither `E2E_MFA_CODE` nor `E2E_MFA_SECRET` is set
  (graceful error is already thrown).
- Operators must add `E2E_MFA_SECRET` to the repository's `dev` environment
  secrets to take advantage of automatic TOTP derivation.

## Alternatives considered

- **Set only `E2E_MFA_CODE`** — requires regenerating the static code on every
  rotation; not operationally sustainable.
- **No change** — leaves TOTP derivation silently broken when `E2E_BASE_URL` is
  activated and the test account uses MFA.

## Evidence

- Issue: Volaris-AI/project-template#1198
- File changed: `.github/workflows/e2e-dev.yml` (three env blocks)
- TOTP logic: `frontend/e2e/smoke.spec.ts` lines 46–109 (`generateTotpCode`,
  `resolveMfaCode`)
