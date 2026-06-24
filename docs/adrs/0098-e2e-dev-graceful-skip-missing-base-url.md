# ADR-0098: E2E dev workflow skips gracefully when `vars.E2E_BASE_URL` is unset

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot coding agent (issue #691)
- **Supersedes / Superseded by:** Supersedes ADR-0071

## Context

ADR-0071 added a hard-fail preflight check to `e2e-dev.yml` that exits with an error when
`vars.E2E_BASE_URL` is unset. This was the right fix for the original problem (silent runs
with an empty URL). However, when the variable is genuinely unconfigured in a fresh fork or
after an environment reset, every hourly and post-deploy run fails before Playwright starts.
The failure handler then updates the deduped incident every hour, creating noise that obscures
real E2E failures and pressures maintainers who cannot set the variable immediately.

The `entity-drilldown` job already demonstrates the correct pattern for missing optional
configuration: it emits a skip output and gracefully exits when `E2E_AUTH_EMAIL` is absent,
letting the job complete as success. The smoke and experience jobs did not follow this pattern
for the URL check.

## Decision

When `vars.E2E_BASE_URL` is empty or unset, all three E2E jobs (`e2e`, `entity-drilldown`,
`experience`) emit a `::warning::` annotation and set a `skip=true` step output, then all
subsequent steps in the job are guarded with `if: steps.url-check.outputs.skip != 'true'`.
The job exits successfully (all guarded steps are skipped). The incident filing step, which
is already guarded by `failure()`, does not fire.

An invalid URL format (present but not starting with `http://` or `https://`) continues to
hard-fail — this is a configuration error that should be corrected immediately.

## Consequences

- When `vars.E2E_BASE_URL` is unconfigured, jobs complete as success (all steps skipped)
  instead of failing. No incident update is filed.
- A `::warning::` annotation on the `Check deployed dev base URL` step remains visible in the
  Actions UI and directs operators to `.github/FACTORY-ACTIVATION.md` step 5.
- Once the variable is set, the workflow resumes normal E2E execution without any further
  changes.
- The skip-budget guard and incident handler continue to run exactly as before when the URL
  is correctly configured and tests execute.
- This makes the "URL not configured" state distinct from "E2E tests actually failing",
  so the incident channel carries only genuine app-regression signal.

## Alternatives considered

- **Keep hard-fail, escalate only to ops queue:** Was already tried (ADR-0071 + issue #691).
  Hourly failures continued to update the incident comment without resolution because ops
  configuration takes time and the variable is outside code.
- **Add a hardcoded fallback URL:** Rejected — embedding a live Azure Front Door hostname
  in the workflow couples the template to one deployment instance and silently runs tests
  against an unrelated host in other forks.
- **Disable the hourly schedule when unconfigured:** Rejected — the schedule is necessary for
  ongoing post-deploy validation once the URL is set, and disabling it requires a code change
  to re-enable.

## Evidence

- `.github/workflows/e2e-dev.yml` — `Check deployed dev base URL` step with `id: url-check`
  in `e2e`, `entity-drilldown`, and `experience` jobs
- `.github/FACTORY-ACTIVATION.md` step 5 — documents the `vars.E2E_BASE_URL` requirement
- ADR-0071 — superseded; its "fail immediately" decision is replaced by "skip gracefully"
- ADR-0058 — skip-budget enforcement is preserved; guards are conditioned on `url-check`
- Issue #691 — the repeated hourly failures this change resolves
