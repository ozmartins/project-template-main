# ADR-0116: Align actions-monitor baseline attribution with shared failure-conclusion set

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Development
- **Supersedes / Superseded by:** Extends ADR-0112

## Context

ADR-0112 added a shared `attributeCiFailures` pure function and `get_ci_baseline` SDK tool that classify CI failures against three baseline conclusions: `failure`, `timed_out`, and `startup_failure`. PR #1108 extended both the SDK tool and `fetchMainFailingCheckNames` to include `timed_out` and `startup_failure` in the baseline comparison set.

The `actions-monitor.agent.md` step 2.5 bash command was added in the same ADR-0112 PR (#1078) but only compared against `conclusion == "failure"`. Because the actions-monitor uses only `gh` as its tool (not the factory SDK), it cannot call `get_ci_baseline` directly and must perform the baseline comparison inline.

The result: if `Validate - Semgrep` or `CICD - Build Images` has conclusion `timed_out` or `startup_failure` on `main`, the actions-monitor's step 2.5 would not classify it as pre-existing. A subsequent PR-branch run with the same conclusion would be misclassified as a genuine PR-introduced failure, triggering an unwarranted incident or Copilot nudge.

## Decision

Update the step 2.5 jq filter in `actions-monitor.agent.md` to include `timed_out` and `startup_failure` alongside `failure`, matching the `BASELINE_FAILING_CONCLUSIONS` set used by `fetchMainFailingCheckNames` in `factory-tools.ts`:

```bash
jq -r '.[] | select(
  .conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "startup_failure"
) | .name'
```

This is an implementation alignment, not a policy change. ADR-0112's intent always included all three conclusions; the bash command was incomplete.

## Consequences

- The actions-monitor baseline comparison is now consistent with the SDK tool path for all three failure conclusions.
- `timed_out` runs on `main` (e.g. a flaky long-running job) no longer generate PR-branch incidents.
- `startup_failure` runs on `main` (e.g. a broken runner environment) no longer generate PR-branch incidents.
- No change to the `failure` case — this was already handled.

## Alternatives considered

- **Do nothing until the actions-monitor can call `get_ci_baseline` directly**: rejected because the agent uses only `gh` tools and does not participate in the SDK pipeline, so it will always require an inline baseline query for the foreseeable future.
- **Extend the baseline to include `cancelled`**: rejected because cancelled runs do not represent a broken check on main; the cancellation policy is handled separately by ADR-0114.

## Evidence

- `.github/agents/actions-monitor.agent.md` step 2.5 — updated jq filter.
- `.github/tools/shared/src/factory-tools.ts` `BASELINE_FAILING_CONCLUSIONS` — the authoritative set.
- Trend issue #1033; member tickets #853, #855, #995, #1081.
