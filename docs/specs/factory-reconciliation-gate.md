---
type: Spec
title: Factory Reconciliation Gate
description: Shared contracts for PR lifecycle classification, merged-PR cleanup, and stale-assignment detection in the GitHub factory pipeline.
tags: [factory, copilot, reconciliation, assignment, pipeline]
status: Active
timestamp: 2026-06-23T00:00:00Z
---

**Status:** Active  
**Scope:** `.github/tools/shared/src/factory-tools.ts`, `.github/tools/shared/src/run-assignment.ts`

---

## Purpose

The reconciliation gate is a set of shared contracts that govern how the factory pipeline
handles the full lifecycle of a Copilot PR — from assignment through merge and cleanup.

Without these guardrails, the pipeline falls into infinite no-op re-kick loops:

1. Copilot opens a PR without `Closes #N` → issue stays open → pipeline re-kicks → repeat.
2. A no-op "Confirm X is already resolved" PR gets merged → issue stays open → re-kick → repeat.
3. `get_stale_assignments` only looks at open PRs → merged-but-open issues re-enter churn → repeat.

---

## Shared Result Type

```typescript
interface ReconciliationResult {
  diff_state:         "has_diff" | "no_diff";
  satisfaction_state: "already_satisfied" | "unknown";
  linkage_state:      "has_closing_refs" | "none";
  decision:           "implementation_ready" | "already_satisfied" | "hold_no_diff";
  evidence:           string;
  actions:            string[];
}
```

---

## Decision Rules

### `hold_no_diff`

**Condition:** `additions + deletions == 0`

The PR has no substantive diff. This is the signature of a no-op "Confirm X" PR. It
**cannot deliver value** and must not be merged.

`actions: ["block_merge", "unassign_copilot", "comment_on_pr"]`

### `already_satisfied`

**Condition:** `has_diff` AND `isAlreadySatisfied == true` (caller provides positive evidence)

The issue is already resolved on the default branch. The caller must supply evidence —
an empty diff alone is **not** sufficient. An empty diff is `hold_no_diff`.

`actions: ["close_issue", "unassign_copilot"]`

### `implementation_ready`

**Condition:** `has_diff` AND not `already_satisfied`

Normal PR with substantive changes. Proceed through the standard review/merge path.

`actions: ["merge_when_approved"]`

---

## Covered-Issue Set — Three Linkage Signals

Both `merge_pr` and stale-assignment detection use the same three signals to identify
which issues a PR covers. All signals are required because Copilot often omits `Closes #N`.

| Signal | Example | Notes |
|--------|---------|-------|
| `closingIssuesReferences` | `Closes #458` in PR body | Authoritative; populated by GitHub |
| Branch name number | `copilot/fix-458-something` | Cross-checked against known assigned issues |
| PR title `#NNN` | `Fix the thing for #458` | Cross-checked against known assigned issues |

Branch and title signals are filtered to only add numbers that appear in the known set of
assigned issues — this prevents false-positive closures from coincidental numeric tokens.

---

## `merge_pr` Lifecycle Cleanup

After a successful squash merge, the `merge_pr` tool:

1. Fetches `additions`, `deletions`, `closingIssuesReferences`, `headRefName`, and `title`
   from the merged PR.
2. Applies the reconciliation gate **before** merging — returns `{ blocked: true }` if
   `decision == "hold_no_diff"`.
3. After merge: builds the linked-issue set using all three signals.
4. For each linked issue that has Copilot assigned or is still open:
   - Removes `copilot-swe-agent[bot]` via GraphQL `removeAssigneesFromAssignable`
   - Closes the issue via `gh issue close`
   - Posts a comment explaining the closure

This frees capacity even when the PR body did not include `Closes #N`.

---

## Stale-Assignment Detection — Recently-Merged PRs

Both `findStaleIssues()` (programmatic, `run-assignment.ts`) and `get_stale_assignments`
(tool, `factory-tools.ts`) now check recently-merged Copilot PRs (last 7 days) in addition
to open PRs when building the coverage set.

An issue is **stale** only if:
- No open Copilot PR covers it, AND
- No recently-merged Copilot PR covers it

An issue covered by a recently-merged PR but still open is classified as
**merged-but-open** and is cleaned up (close + unassign) instead of re-kicked.

`get_stale_assignments` returns:

```json
{
  "stale_issues": [...],
  "merged_but_open_issues": [
    { "number": 692, "title": "...", "merged_pr": 1005, "assigned_hours_ago": 48 }
  ]
}
```

The project-manager agent calls `close_issue` for each item in `merged_but_open_issues`.

---

## `close_issue` Tool

A standalone tool available to agents for explicit lifecycle cleanup:

- Removes `copilot-swe-agent[bot]` assignee
- Closes the issue
- Posts an evidence-based comment (required)

Use when `get_stale_assignments` returns `merged_but_open_issues`, or when independent
evidence confirms an issue is already satisfied on the default branch.

---

## Related

- [`docs/specs/copilot-assignment-cleanup.md`](copilot-assignment-cleanup.md) — root cause
  inventory and remediation history
- [`docs/specs/factory-pipeline-reliability.md`](factory-pipeline-reliability.md) — broader
  pipeline reliability spec
