---
type: Spec
title: Copilot Assignment Cleanup and Ghost Assignment Prevention
description: Diagnosis and remediation plan for the 91-issue ghost-assignment backlog and the structural bugs that caused it.
tags: [factory, copilot, assignment, pipeline, cleanup]
status: Completed
timestamp: 2026-06-23T00:00:00Z
---

## Copilot Assignment Cleanup and Ghost Assignment Prevention

**Status:** Completed  
**Scope:** `.github/tools/shared/src/run-assignment.ts`, `.github/tools/shared/src/factory-tools.ts`, `.github/agents/project-manager.agent.md`, `.github/copilot-instructions.md`, `scripts/` (two cleanup scripts)

---

## Problem Summary

As of 2026-06-21 there are **91 issues assigned to `copilot-swe-agent[bot]`** but only **10 open
Copilot PRs**. The pipeline's stale-detection and re-kick logic sees ~81 of those as ghost
assignments (assigned but no linked open PR) and tries to re-kick them every 15-minute pass.

The underlying cause is two compounding failures:

**A. Copilot never writes `Closes #N` in PR bodies.**
GitHub auto-closes issues and populates `closingIssuesReferences` only when the PR description
contains an explicit closing keyword (`Closes #N`, `Fixes #N`, `Resolves #N`) targeting the
default branch. GitHub does not inject this automatically — it depends on the PR author writing
it. The Copilot SWE agent writes detailed PR bodies but omits the closing keyword. This is not
documented as a known limitation; it is a gap in the agent's default behaviour. Consequence:
113 merged Copilot PRs have `closingIssuesReferences: []`, their source issues were never
auto-closed, and they remain open and assigned.

**B. The stale-detection code never filtered on PR coverage.**
`findStaleIssues()` in `run-assignment.ts` fetched open PRs, built a coverage set, then ignored
it — the stale loop just took `issues.slice(0, gap)`. Every assigned issue looked stale regardless
of whether a PR existed.

These two failures compounded: (A) kept issues open after work was done; (B) caused those open
issues to appear stale and get re-kicked. The capacity gate (`openPrs.length >= 8`) was the only
protection, limiting re-kicks to gaps in the 8-PR ceiling rather than preventing them entirely.

---

## Root Cause Inventory

### Bug 1 — `findStaleIssues()` filter was dead code (run-assignment.ts)

Built `openPrBranches` / `copilotBranches` sets but then used `issues.slice(0, gap)` with no
filter. Every assigned issue appeared stale.

**Status: Fixed.** `coveredByPr` is now built using three linkage signals
(`closingIssuesReferences`, issue number embedded in branch name, `#N` in PR title) and the loop
filters to `genuinelyStale` before slicing.

**Missing: test coverage.** No test asserts the filter logic. A regression could silently re-break
this. See Task C below.

### Bug 2 — Copilot never told to write `Closes #N`

No instruction anywhere in the pipeline told Copilot to include `Closes #N` in PR bodies. Four
places post assignment comments — all four omitted the instruction:

| Location | Comment text (before fix) |
|---|---|
| `run-assignment.ts` rekick comment | "Re-kicked Copilot assignment..." |
| `run-assignment.ts` Stage 4 prompt | "@copilot please open a draft PR..." |
| `factory-tools.ts` `assign_to_copilot` tool | "Assigned to Copilot. ${reason}" |
| `factory-tools.ts` `rekick_assignment` tool | "[factory-rekick] Re-triggered..." |
| `project-manager.agent.md` assignment comment | "Assigned to Copilot from a fresh..." |
| `copilot-instructions.md` PR body rules | "Linked issue" (vague, no keyword specified) |

**Status: All six fixed.** Each now explicitly states `Closes #<issue-number>` is mandatory.

### Bug 3 — Project Manager re-assigned already-assigned issues

`gh issue list --label "ready-for-dev"` returns issues already assigned to Copilot. The PM agent
only checked labels in its skip list, not assignees. When open PRs < 8, it would re-assign issues
Copilot was already working on, creating duplicate sessions.

**Status: Fixed.** `project-manager.agent.md` now explicitly skips issues where
`assignees[].login` includes `copilot-swe-agent[bot]`.

### Bug 4 — `copilot-assignment.ts` is dead code and uses wrong method

`copilot-assignment.ts` exports `assignCopilotToIssue` using `gh issue edit --add-assignee`, which:
- Does not trigger a SWE agent session (requires the GraphQL `agentAssignment` mutation)
- Is never imported by any other file in the codebase

**Status: Not yet fixed.** This file should be deleted to avoid confusion. It is not used anywhere
so deletion is safe. See Task D below.

---

## Remaining Work

### Task A — Close issues whose work is already done

Identify issues from the 91 ghost-assigned set where a merged Copilot PR delivered the work. Close
them with an explanatory comment, remove the Copilot assignment, and remove stale labels.

**High-confidence confirmed cases** (matched by sequential PR number + title overlap):

| Issue | Merged PR | Match basis |
|---|---|---|
| #423 factory-process-reviewer agent | #424 | Sequential, title tokens match |
| #196 instrument DSL interpreter | #281 | Title: "instrument DSL interpreter" |
| #183 workflow execution query surfaces | #289 | Title: "workflow execution query" |
| #180 data_validate activity | #292 | Title: "data_validate activity" |
| #179 schedule_trigger activity | #230 | Title: "schedule_trigger activity" |
| #178 slack_message activity | #231 | Title: "slack_message activity" |
| #64 prove vertical-classification pipeline | #267 | Exact title match |

**Additional candidates for manual review** (title similarity, not confirmed):
Issues 143→238, 173→296, 174→233, 177→232, 387→388, 383→385, 384→386,
390→398, 392→399, 393→400, 395→401.

**Do not auto-close:**
- Issues with `queue:architecture` label — design artifacts, not implementation deliverables
- Epics (e.g. #60) — parent containers, not closeable by a single PR
- Issues with `blocked`, `needs-*-review`, or active `changes-requested` on an open PR
- Issues where the matched PR title clearly doesn't cover the full issue scope

### Task B — Unassign Copilot from issues with no PR and no branch

For the remaining ~70 issues where Copilot was assigned but never opened a branch or PR: unassign
without closing. The issue is still valid work; the pipeline re-assigns in priority order.

**Exception:** Do not unassign issues in `queue:architecture`, `queue:platform`, `queue:security`,
or `queue:database` — these are not valid Copilot targets anyway and the PM agent's skip-list
already guards against re-assignment.

### Task C — Add regression test for `findStaleIssues` filter

The fix to `findStaleIssues()` (Bug 1) has no test coverage. A future edit could silently revert
the filter. A new test in `__tests__/` should assert:

- Given: 5 assigned issues, 3 open PRs covering issues #1/#2/#3 (via different linkage signals),
  open PR count = 5 (below max of 8, gap = 3)
- Asserts: `findStaleIssues` returns only issues #4 and #5 (the uncovered ones), not #1/#2/#3
- Asserts: capacity gate (`openPrs >= max`) returns empty array before the filter runs

The test must mock `gh` CLI calls so it runs without network access.

### Task D — Delete `copilot-assignment.ts`

The file `src/copilot-assignment.ts` exports `assignCopilotToIssue` using the wrong assignment
method (`gh issue edit --add-assignee`) and is never imported. Delete it and confirm no imports
break. This is a one-file deletion with no cascading changes.

---

## Implementation Plan

### Script 1 — `scripts/audit-copilot-assignments.ts`

A locally-runnable TypeScript script (`npx tsx scripts/audit-copilot-assignments.ts`) that:

1. Fetches all open issues assigned to `copilot-swe-agent[bot]`
2. Fetches all Copilot-authored PRs (open + merged, last 200)
3. For each assigned issue, determines coverage using:
   - `closingIssuesReferences` on open PRs (populated by GitHub from `Closes #N`)
   - Issue number as standalone token in open PR branch name (`copilot/...-423-...`)
   - Issue number in open PR title (`#423`)
   - **For merged PRs:** same three signals — if a merged PR covers the issue, it's `likely_done`
   - **Sequential heuristic:** issue #N + merged PR #(N+1) or #(N+2) with ≥3 overlapping title
     tokens after stripping type prefixes (`feat`, `fix`, `chore`, `docs`, `test`, `ci`)
4. Produces `scripts/copilot-audit-report.json`:

```json
{
  "generated_at": "2026-06-21T21:00:00Z",
  "summary": {
    "total_assigned": 91,
    "likely_done": 18,
    "has_open_pr": 10,
    "no_pr_found": 63
  },
  "likely_done": [
    {
      "issue_number": 423,
      "issue_title": "feat(factory): add factory-process-reviewer agent",
      "issue_labels": ["enhancement", "ready-for-dev", "queue:development"],
      "merged_pr": 424,
      "merged_pr_title": "Add nightly factory-process-reviewer...",
      "merged_at": "2026-06-21T11:35:02Z",
      "confidence": "high",
      "match_signals": ["sequential_number", "title_tokens:5"]
    }
  ],
  "has_open_pr": [
    {
      "issue_number": 445,
      "open_pr": 445,
      "pr_title": "Harden e2e-dev skip-budget gating...",
      "pr_branch": "copilot/fix-e2e-dev-config-missing",
      "match_signal": "branch_number"
    }
  ],
  "no_pr_found": [
    {
      "issue_number": 60,
      "issue_title": "Epic: Temporal DSL llm_agent...",
      "issue_labels": ["enhancement", "ready-for-dev", "queue:development"],
      "is_epic": true,
      "assigned_days_ago": 1,
      "recommendation": "skip"
    }
  ]
}
```

The `no_pr_found` bucket sets `recommendation` to:
- `"skip"` — has `queue:architecture`, `queue:platform`, `queue:security`, `queue:database`, or
  is an epic (title starts with "Epic:") — do not unassign
- `"unassign"` — everything else

Run with `--dry-run` (default) or `--output <path>` to specify report location.

### Script 2 — `scripts/cleanup-copilot-assignments.ts`

Reads the JSON report produced by Script 1 and acts on it. Requires `--confirm` flag to execute;
defaults to `--dry-run` which prints planned actions only.

**For `likely_done` bucket:**
1. Post comment: `Closing — work was delivered by PR #<merged_pr> (merged <date>). The PR did not include a \`Closes #<issue>\` keyword so GitHub did not auto-close this issue at merge time. See [docs/specs/copilot-assignment-cleanup.md](/docs/specs/copilot-assignment-cleanup.md).`
2. Remove Copilot assignment: GraphQL `removeAssigneesFromAssignable`
3. Remove labels `ready-for-dev` and `queue:development` if present
4. Close issue: `gh issue close <number> --reason completed`

**For `no_pr_found` where `recommendation == "unassign"`:**
1. Remove Copilot assignment: GraphQL `removeAssigneesFromAssignable`
2. Post comment: `Unassigning Copilot — no PR was opened from this assignment. The pipeline will re-assign when capacity exists.`
3. Do NOT change labels or close the issue

**For `no_pr_found` where `recommendation == "skip"`:**
Do nothing — log as skipped.

**For `has_open_pr`:**
Do nothing — pipeline is managing these.

Usage:
```bash
npx tsx scripts/audit-copilot-assignments.ts          # produces copilot-audit-report.json
npx tsx scripts/cleanup-copilot-assignments.ts --dry-run   # print actions, no changes
npx tsx scripts/cleanup-copilot-assignments.ts --confirm   # execute
```

---

## Files to Create / Modify

| File | Action | Status |
|---|---|---|
| `.github/tools/shared/src/run-assignment.ts` | Fix Bug 1 + Bug 2 (rekick comment) | **Done** |
| `.github/tools/shared/src/factory-tools.ts` | Fix Bug 2 (assign + rekick tool comments) | **Done** |
| `.github/agents/project-manager.agent.md` | Fix Bug 3 + Bug 2 (assignment comment) | **Done** |
| `.github/copilot-instructions.md` | Fix Bug 2 (PR body rule) | **Done** |
| `.github/tools/shared/src/copilot-assignment.ts` | Delete (Task D) | **Done** |
| `.github/tools/shared/src/__tests__/stale-rekick-filter.test.ts` | Create (Task C) | **Done** |
| `scripts/audit-copilot-assignments.ts` | Create (Script 1) | **Done** |
| `scripts/cleanup-copilot-assignments.ts` | Create (Script 2) | **Done** |

---

## Acceptance Criteria

### Prevention (already merged)
- [ ] New Copilot PRs opened after the instruction fixes contain `Closes #<N>` in their bodies
- [ ] After 3 pipeline-fast passes: no new ghost assignments accumulate on issues with merged PRs
- [ ] PM agent skips issues already assigned to `copilot-swe-agent[bot]` (verified by pipeline log)

### Regression test (Task C)
- [x] `stale-rekick-filter.test.ts` asserts that issues with an open covering PR are excluded from
  the stale list even when open PR count is below max capacity
- [x] Test runs without network access (pure function tests, no `gh` calls)
- [x] `npm test` passes clean

### Dead code removal (Task D)
- [x] `copilot-assignment.ts` is deleted
- [x] No import of `assignCopilotToIssue` anywhere in the codebase
- [x] TypeScript compiles clean after deletion

### Cleanup scripts
- [x] `scripts/audit-copilot-assignments.ts` created and produces `copilot-audit-report.json`
- [x] `scripts/cleanup-copilot-assignments.ts` created with `--dry-run` and `--confirm` flags

---

## Out of Scope

- Retroactively adding `Closes #N` to already-merged PR bodies — GitHub does not process closing
  keywords in edited PR bodies post-merge; there is no value in editing them
- Closing epics or `queue:architecture` issues — these require human judgment on completion
- Auditing non-Copilot PRs — this problem is specific to the SWE agent's PR body template
- Changing the GitHub Copilot SWE agent itself — we can only influence it via `copilot-instructions.md`
