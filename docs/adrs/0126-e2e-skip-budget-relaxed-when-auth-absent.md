# ADR-0126: E2E skip budget relaxed to 100% when auth credentials are absent

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The E2E dev workflow (`e2e-dev.yml`) enforces a 25% skip budget for both the `smoke`
and `experience` suites via `check-e2e-skip-budget.mjs`. The budget was designed to
catch accidental mass-skipping (e.g., a code bug that silently skips every test).

However, when `E2E_AUTH_EMAIL` is not configured (e.g., a fresh deployment without auth
secrets), every auth-requiring test intentionally skips via `test.skip()` guards. This
causes 94–100% skip rates that breach the 25% budget and fail CI — even though the
skips are correct, expected behavior.

The budget check cannot distinguish:
1. **Intentional skip**: `test.skip(!process.env.E2E_AUTH_EMAIL)` — correct behavior
2. **Accidental skip**: tests silently skip due to a bug — what the budget was meant to catch

## Decision

We conditionally relax the skip budget to 1.0 (100%) in the `Enforce smoke skip budget`
and `Enforce experience skip budget` workflow steps when `E2E_AUTH_EMAIL` is unset.
When `E2E_AUTH_EMAIL` is present, the original 0.25 (25%) budget continues to apply.

The budget value is computed inline in the workflow step:
```bash
AUTH_BUDGET=$([ -z "${E2E_AUTH_EMAIL:-}" ] && echo 1.0 || echo 0.25)
```

A `::warning::` annotation is emitted when the relaxed budget is used so the relaxation
is visible in workflow logs and surfaces in the annotations UI.

## Consequences

- E2E runs with `E2E_BASE_URL` set but no auth credentials now pass CI cleanly, with a
  warning explaining the relaxed budget.
- E2E runs with auth credentials still enforce the 25% skip budget to catch regressions.
- No change to `check-e2e-skip-budget.mjs` is needed; it already accepts the budget as
  a positional argument.
- The existing protection against mass accidental skips is preserved for configured
  environments.

## Alternatives considered

- **Detect auth-skip scenario in the script**: inspect the results file for zero
  auth-test executions and bypass the budget. Rejected because it requires the script
  to understand test categories, coupling it to test naming conventions.
- **Separate skip categories**: exclude config-gate skips from the skip count entirely.
  Rejected as overly complex and fragile against test naming drift.
- **Increase the global default budget**: raise 25% to something higher. Rejected
  because it would weaken the guard for configured environments.

## Evidence

- `.github/workflows/e2e-dev.yml` — `Enforce smoke skip budget` and `Enforce experience
  skip budget` steps
- `.github/scripts/check-e2e-skip-budget.mjs` — budget enforcer (unchanged)
- Issue: `#1221` — CI failure when auth not configured (run 28089788786)
- ADR-0058 — original skip-budget decision (preserved; this ADR extends it)
