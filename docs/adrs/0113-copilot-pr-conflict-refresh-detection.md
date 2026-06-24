# ADR-0113: Copilot PR Conflict-Refresh Detection Stage

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Copilot coding agent (implementation), factory process
- **Supersedes / Superseded by:** —

## Context

Multiple Copilot PRs required human `@copilot please rebase` comments to unblock
merge-conflict situations that arose when `main` moved after the PR was opened.
Examples: PR #992, PR #966, PR #965 — all within a 24-hour window — each needed
the same manual conflict-only nudge before Copilot could proceed.

The `pipeline-fast` PR handler loop already handles `mergeable == "CONFLICTING"`
as priority-1 work (see `pr-ordering.ts`). The existing `pr-handler` agent prompt
already defines the correct single-nudge response for CONFLICTING state.

What was missing:

1. **A visible detection record** — no step in the pipeline explicitly listed
   which Copilot PRs were CONFLICTING at the time of each run, making the 7-day
   regression check impossible without reading agent session logs.
2. **Scan-before-handle ordering** — if the PR handler loop exhausted its budget,
   the detection record disappeared with the session, leaving no trail.

## Decision

Add a lightweight "Stage 1b — Conflict refresh scan" step to `pipeline-fast.yml`
that runs **before** the PR Handler loop.

The step executes `scan-conflict-refresh.ts`, a pure TypeScript module (no LLM,
no PR comments) that:

- Fetches all open PR snapshots via the existing `fetchPrSnapshots` infrastructure.
- Filters for `author === "copilot-swe-agent[bot]"` **and** `mergeable === "CONFLICTING"`.
- Records each detected PR (number, title, timestamp, expected action) to
  `$GITHUB_STEP_SUMMARY`.
- Emits a structured `info` log line for grep-based audit queries.

The actual conflict nudge is unchanged — it continues to be handled by the existing
PR Handler loop at priority 1 (CONFLICTING PRs are always handled before reviews and
CI nudges in the same pass).

## Consequences

**Easier:**
- Every pipeline run now has a machine-readable conflict detection record in its
  step summary, enabling the 7-day regression check.
- The detection record is written even when the PR Handler loop times out, ensuring
  no CONFLICTING PR is silently deferred without a trace.
- A single source of truth: `scan-conflict-refresh.ts` is unit-tested and type-safe.

**Harder / constrained:**
- The `pipeline-fast` job gains ~5 minutes of worst-case overhead (one extra step
  with a 5-minute timeout). In practice the scan completes in seconds.
- The scan fetches all open PRs (same GraphQL call as `fetchPrSnapshots`). This adds
  one extra API call to the pipeline-fast run.

**New obligations:**
- `scan-conflict-refresh.ts` must be kept in sync with the Copilot bot login name
  (`copilot-swe-agent[bot]`). If the bot login ever changes, update `COPILOT_BOT`
  in that file.

## Alternatives considered

**A: Do nothing / rely on the existing PR handler loop**
Rejected. The PR handler handles CONFLICTING PRs correctly, but leaves no visible
detection record. The 7-day regression check cannot be measured from agent session
logs alone, and the approach fails when the loop is budget-constrained.

**B: Have the scan also post the conflict nudge comment**
Rejected. This creates a second conflict-resolution flow and risks duplicate nudge
comments when both the scan and the PR handler fire in the same pass. The issue
explicitly requires reusing the existing safe conflict-resolution contract.

**C: Add a dedicated workflow that triggers on `pull_request` events**
Rejected. Event-driven workflows for this use case cause self-cancellation thrash
(see ADR-0025 history re: `workflow_run` removal from pipeline-fast). A polling
step inside the existing serialised pipeline is safer and avoids concurrent runs.

**D: Add recording to `run-pr-pipeline.ts` without a new stage**
Considered but less visible. A pre-scan inside the PR pipeline runner would produce
a detection record, but only as part of the PR pipeline summary section rather than
a dedicated named step. A named step makes the detection explicitly visible and
independently monitorable in the Actions UI.

## Evidence

- `pipeline-fast.yml` — Stage 1b "Conflict refresh scan" step using
  `src/scan-conflict-refresh.ts`.
- `.github/tools/shared/src/scan-conflict-refresh.ts` — detection module.
- `.github/tools/shared/src/__tests__/scan-conflict-refresh.test.ts` — 10 unit tests.
- `pr-ordering.ts` — existing priority-1 bucket for CONFLICTING PRs.
- `run-pr-pipeline.ts` — `buildConflictRefreshOutcomes` records triggered/skipped/deferred
  outcome per CONFLICTING PR in the Stage 2 step summary (satisfies the "record whether
  refresh was triggered or intentionally skipped" acceptance criterion from issue #1014).
- PR #992, #966, #965 — motivating examples (same-day manual nudge pattern).
- Issue #1014 — originating issue: "auto(process): detect Copilot PR merge-conflict
  refresh needs".
