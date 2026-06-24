# ADR-0115: Factory No-Diff and Already-Satisfied Copilot PR Guardrails

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Factory Process Reviewer, Copilot coding agent
- **Supersedes / Superseded by:** None

## Context

The factory pipeline produced a sustained stream of no-op Copilot PRs that consumed
reviewer attention without delivering value. Documented instances include:

- PRs #1034, #1035, #1031, #1061 — closed with 0 changed files after review feedback.
- PRs #1037, #1039, #1044, #1050, #1051, #1057, #1058, #1068 — confirmed no-op on review.

Two structural gaps drove this:

1. **No preflight gate.** The per-PR agent session was launched even for PRs with
   `changedFiles: 0`. The agent would receive the snapshot, discover there was nothing
   to review, and exit — but only after consuming a full PR handler session and in some
   cases triggering a human review request.

2. **No assignment-time coverage check.** When an issue was already covered by a
   recently-merged Copilot PR that lacked a `Closes #N` keyword, the stale-detection
   logic did not detect the coverage. It would re-kick the issue, creating a second
   Copilot session that would open another no-op PR for work already delivered.

The repository instructions already told Copilot to verify whether an issue was fixed on
`main`, but these checks occurred at LLM reasoning time (inside the agent session), not at
the factory layer (before the session starts). Agent reasoning is fallible; factory-layer
enforcement is deterministic.

## Decision

We add two deterministic guardrail layers to the factory pipeline:

**Layer 1 — PR preflight (run-pr-pipeline.ts).**
Before launching a `pr-handler` agent session, check `pr.changedFiles === 0` for
Copilot-authored PRs. If true, skip the session entirely: post a single
`[factory-reconciliation-guard]` evidence comment and close the PR. Non-Copilot PRs are
unaffected.

**Layer 2 — Assignment preflight (factory-tools.ts).**
Before assigning a new issue to Copilot via `assign_to_copilot`, evaluate:
- Whether any *open* Copilot PR already covers the issue (via closing refs, branch name
  token, or PR title `#N` reference).
- Whether any *recently-merged* Copilot PR (last 7 days) already covers the issue using
  the same three signals.

If a recently-merged PR covers the issue, post one `[factory-assignment-guard]` comment
and close the issue instead of opening a new PR.

**Layer 3 — Merge gate (factory-tools.ts, merge_pr tool).**
`classifyPrDecision` classifies every PR before `merge_pr` executes as one of:
`implementation_ready`, `already_satisfied`, or `hold_no_diff`. A `hold_no_diff`
classification (additions + deletions == 0) returns `{ blocked: true }` and prevents
merge regardless of approval state.

All three layers are deterministic pure functions with full unit-test coverage. They run
without LLM inference.

## Consequences

**Easier:**
- No-diff Copilot PRs are detected and closed in seconds, before any human review
  request is triggered.
- Already-covered issues are skipped at assignment time; the factory does not open a
  second PR for work already delivered.
- The evidence comment on closed/skipped items is auditable: reviewers can see exactly
  why the factory acted without a human review round-trip.

**Harder / constrained:**
- Copilot PRs with `changedFiles: 0` are automatically closed. If a Copilot PR
  legitimately modifies only binary or non-trackable files and GitHub reports
  `changedFiles: 0`, the preflight would close it incorrectly. In practice this case
  is not observed; the gate protects against a common failure mode.
- The 7-day merged-PR window may miss issues delivered by older PRs that lacked
  `Closes #N`. Those issues remain visible until a human or the `close_issue` tool
  acts on them.

**New obligations:**
- Factory agents must always include `Closes #<issue-number>` in PR bodies so GitHub
  populates `closingIssuesReferences`. Without this keyword, merged-PR coverage detection
  falls back to heuristic branch-name and title signals, which may miss coverage.
- The three linkage signals (`closingIssuesReferences`, branch name token, title `#N`)
  must remain consistent across `buildCoveredSet`, `evaluateAssignmentGuardrails`, and
  `findStaleIssues`. Any change to linkage logic must update all three.

## Alternatives considered

**A: Rely solely on Copilot instruction to check `main` before opening a PR.**
Rejected. Instructions are advisory; a factory-layer check is deterministic. The failure
corpus showed the instruction was not sufficient: multiple re-kick cycles produced no-diff
PRs even with the instruction in place.

**B: Block no-diff PRs at PR-creation time via a GitHub Actions workflow.**
Rejected. A `pull_request` event workflow cannot close or prevent PRs without write
permissions and introduces race conditions. The pipeline-fast polling model (running
preflight inside the PR handler loop) is consistent with ADR-0002 and ADR-0004.

**C: Use `additions + deletions == 0` instead of `changedFiles == 0` for the preflight.**
Accepted as the *merge gate* check (Layer 3 via `classifyPrDecision`). Rejected as the
*preflight* check because `additions + deletions` requires an extra API call not available
in the snapshot. `changedFiles == 0` is available in the GraphQL snapshot and is reliable
for the "literally no files changed" case. Both checks are in place; they cover
complementary edge cases.

**D: Close no-diff issues via an nightly audit script instead of inline preflight.**
Considered. `scripts/audit-copilot-assignments.ts` implements this for one-off cleanup.
Rejected as the sole ongoing mechanism because it requires manual invocation and produces
a delay between no-diff PR creation and cleanup. Inline preflight (Layer 1) closes the PR
in the same pipeline pass it is detected.

## Evidence

- `run-pr-pipeline.ts` — `evaluatePrPreflight`, `closeNoDiffCopilotPr`, `NO_DIFF_PR_COMMENT_MARKER`
- `factory-tools.ts` — `evaluateAssignmentGuardrails`, `classifyPrDecision`, `buildCoveredSet`,
  `ASSIGNMENT_GUARD_COMMENT_MARKER`
- `run-assignment.ts` — `findStaleIssues` merged-PR coverage window
- `__tests__/run-pr-pipeline.test.ts` — preflight unit tests
- `__tests__/assignment-guardrails.test.ts` — guardrail unit tests
- `__tests__/reconciliation-gate.test.ts` — `classifyPrDecision` + `buildCoveredSet` unit tests
- `__tests__/stale-rekick-filter.test.ts` — stale-detection filter unit tests
- `docs/specs/factory-reconciliation-gate.md` — shared result type and decision rules
- PR #1095 — initial no-diff preflight + assignment guardrail implementation
- PR #1107 — hardened branch-token linkage detection in assignment guardrails
- PR #1115 — stale-rekick regression tests
- Issue #1079 — motivating problem statement and acceptance criteria
