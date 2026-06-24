# ADR-0077: Daily contract drift detector for Supabase RPC and Temporal activity surfaces

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The repository had no automated cross-layer contract check to detect drift between:

- Supabase `SECURITY DEFINER` RPC signatures used by application callers, and
- Temporal activity signatures (`temporal/src/activities/`) consumed by DSL workflow definitions (`temporal/definitions/*.json`).

Layer-local checks (unit tests, typechecks) do not detect this class of breaking change early. A drift detector is needed in the factory control plane, but it must remain non-gating and file actionable issues when mismatches are found.

Because this change updates `.github/workflows/pipeline-daily.yml`, it crosses a control-plane boundary and requires an in-PR ADR.

## Decision

We add a deterministic `contract-drift-detector` stage to `pipeline-daily.yml` that runs TypeScript audit scripts in `scripts/audit/`:

1. `check-rpc-contracts.ts` parses Supabase migrations for `SECURITY DEFINER` function contracts and compares against `supabase/contract-snapshot.json`.
2. `check-activity-contracts.ts` snapshots exported Temporal activity parameter keys and workflow-definition activity calls, comparing against `temporal/contract-snapshot.json` and current definition usage.

On drift findings, the stage writes warnings to `$GITHUB_STEP_SUMMARY` and files deduplicated high-priority issues (`needs-database-review` for RPC drift, `queue:development` for activity drift). The stage is report-only (`continue-on-error: true` + non-gating script exit).

## Consequences

- Contract drift now appears in a daily, centralized factory signal with issue auto-filing.
- Baseline snapshots (`supabase/contract-snapshot.json`, `temporal/contract-snapshot.json`) become reviewable contract artifacts updated intentionally alongside contract changes.
- The detector does not block merges; it creates triage work instead.
- Issue creation depends on workflow token context (`github.token`); local runs still produce summaries and snapshots without issue filing.

## Alternatives considered

- Extend only architecture-alignment auditor agent behavior: rejected for this ticket because deterministic contract parsing is simpler and lower-variance as a direct script stage.
- Make drift detection gating: rejected to avoid immediate false-positive/noise risk while baselines and ownership practices settle.
- Runtime integration tests for all contract paths: rejected as out of scope for this change (E2E/integration territory).

## Evidence

- `.github/workflows/pipeline-daily.yml`
- `scripts/audit/check-rpc-contracts.ts`
- `scripts/audit/check-activity-contracts.ts`
- `scripts/audit/check-contract-drift.ts`
- `supabase/contract-snapshot.json`
- `temporal/contract-snapshot.json`
- Issue: `#404`
