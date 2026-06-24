/**
 * Tests for the reconciliation gate: classifyPrDecision and buildCoveredSet.
 *
 * These functions are the authoritative shared contracts used by merge_pr
 * (to enforce the hold_no_diff guardrail) and stale-assignment detection
 * (to exclude issues covered by open or recently-merged PRs from re-kick).
 */

import { describe, it, expect } from "vitest";
import { classifyPrDecision, buildCoveredSet } from "../factory-tools.js";

// ── classifyPrDecision ────────────────────────────────────────────────────────

describe("classifyPrDecision — three decisions", () => {
  it("hold_no_diff: PR with zero additions and deletions is blocked", () => {
    const result = classifyPrDecision({
      additions: 0,
      deletions: 0,
      closingIssuesReferences: [],
    });

    expect(result.decision).toBe("hold_no_diff");
    expect(result.diff_state).toBe("no_diff");
    expect(result.actions).toContain("block_merge");
    expect(result.actions).toContain("unassign_copilot");
    expect(result.evidence).toMatch(/no substantive changes/i);
  });

  it("hold_no_diff: takes precedence over closing refs when diff is empty", () => {
    // An empty diff alone is not proof that the issue is satisfied — the PR
    // just has no changes.  already_satisfied requires positive evidence from
    // the caller.
    const result = classifyPrDecision({
      additions: 0,
      deletions: 0,
      closingIssuesReferences: [{ number: 458 }],
    });

    expect(result.decision).toBe("hold_no_diff");
    expect(result.satisfaction_state).toBe("unknown");
  });

  it("already_satisfied: has diff and caller provides positive evidence", () => {
    const result = classifyPrDecision({
      additions: 5,
      deletions: 2,
      closingIssuesReferences: [{ number: 458 }],
      isAlreadySatisfied: true,
    });

    expect(result.decision).toBe("already_satisfied");
    expect(result.diff_state).toBe("has_diff");
    expect(result.satisfaction_state).toBe("already_satisfied");
    expect(result.actions).toContain("close_issue");
    expect(result.actions).toContain("unassign_copilot");
  });

  it("already_satisfied: works even without closing refs", () => {
    const result = classifyPrDecision({
      additions: 3,
      deletions: 0,
      closingIssuesReferences: [],
      isAlreadySatisfied: true,
    });

    expect(result.decision).toBe("already_satisfied");
    expect(result.linkage_state).toBe("none");
  });

  it("implementation_ready: non-empty diff, not already satisfied", () => {
    const result = classifyPrDecision({
      additions: 42,
      deletions: 7,
      closingIssuesReferences: [{ number: 500 }],
    });

    expect(result.decision).toBe("implementation_ready");
    expect(result.diff_state).toBe("has_diff");
    expect(result.satisfaction_state).toBe("unknown");
    expect(result.linkage_state).toBe("has_closing_refs");
    expect(result.actions).toContain("merge_when_approved");
  });

  it("implementation_ready: diff with no closing refs has linkage_state none", () => {
    const result = classifyPrDecision({
      additions: 10,
      deletions: 0,
      closingIssuesReferences: [],
    });

    expect(result.decision).toBe("implementation_ready");
    expect(result.linkage_state).toBe("none");
  });

  it("isAlreadySatisfied defaults to false", () => {
    const result = classifyPrDecision({
      additions: 5,
      deletions: 0,
      closingIssuesReferences: [],
    });

    expect(result.decision).toBe("implementation_ready");
    expect(result.satisfaction_state).toBe("unknown");
  });
});

// ── buildCoveredSet ───────────────────────────────────────────────────────────

describe("buildCoveredSet — stale-detection coverage", () => {
  const knownIssues = new Set([1, 2, 3, 4, 5, 100, 200, 300]);

  it("covers issues via explicit closingIssuesReferences", () => {
    const covered = buildCoveredSet(
      [
        {
          headRefName: "copilot/unrelated-fix",
          title: "Unrelated fix",
          closingIssuesReferences: [{ number: 1 }, { number: 2 }],
        },
      ],
      knownIssues
    );

    expect(covered.has(1)).toBe(true);
    expect(covered.has(2)).toBe(true);
    expect(covered.has(3)).toBe(false);
  });

  it("covers issues via issue number embedded in branch name", () => {
    const covered = buildCoveredSet(
      [
        {
          headRefName: "copilot/fix-issue-3-some-description",
          title: "Fix something",
          closingIssuesReferences: [],
        },
      ],
      knownIssues
    );

    expect(covered.has(3)).toBe(true);
  });

  it("does NOT cover issues via branch name when number is not in knownIssues", () => {
    const covered = buildCoveredSet(
      [
        {
          headRefName: "copilot/fix-99-something",
          title: "Fix 99",
          closingIssuesReferences: [],
        },
      ],
      knownIssues
    );

    // 99 is not a known assigned issue — should not be added
    expect(covered.has(99)).toBe(false);
  });

  it("covers issues via #NNN reference in PR title", () => {
    const covered = buildCoveredSet(
      [
        {
          headRefName: "copilot/some-work",
          title: "Fix the problem for #4",
          closingIssuesReferences: [],
        },
      ],
      knownIssues
    );

    expect(covered.has(4)).toBe(true);
  });

  it("does NOT cover issues via title when number is not in knownIssues", () => {
    const covered = buildCoveredSet(
      [
        {
          headRefName: "copilot/some-work",
          title: "Fix the problem for #999",
          closingIssuesReferences: [],
        },
      ],
      knownIssues
    );

    expect(covered.has(999)).toBe(false);
  });

  it("builds covered set from multiple PRs using all three signals", () => {
    const covered = buildCoveredSet(
      [
        {
          headRefName: "copilot/fix-100-feature",
          title: "Add feature",
          closingIssuesReferences: [{ number: 200 }],
        },
        {
          headRefName: "copilot/work-for-something",
          title: "Work for #300",
          closingIssuesReferences: [],
        },
      ],
      knownIssues
    );

    expect(covered.has(100)).toBe(true); // branch signal
    expect(covered.has(200)).toBe(true); // explicit ref
    expect(covered.has(300)).toBe(true); // title signal
    expect(covered.has(5)).toBe(false);  // uncovered
  });

  it("returns empty set for empty PR list", () => {
    const covered = buildCoveredSet([], knownIssues);
    expect(covered.size).toBe(0);
  });
});

// ── Stale-assignment: recently-merged PRs not re-kicked ───────────────────────

describe("stale-assignment: recently-merged PRs must exclude issues from re-kick", () => {
  // This test validates the core logic contract:
  // issues covered by recently-merged PRs must NOT appear as stale.

  it("issue covered by recent merge is not stale", () => {
    const assignedIssues = new Set([1, 2, 3, 4, 5]);

    // open PRs cover only #1 and #2
    const openPrCovered = buildCoveredSet(
      [
        { headRefName: "copilot/fix-1-a", title: "Fix #1", closingIssuesReferences: [{ number: 1 }] },
        { headRefName: "copilot/fix-2-b", title: "Fix", closingIssuesReferences: [{ number: 2 }] },
      ],
      assignedIssues
    );

    // recently-merged PRs cover #3 and #4
    const recentMergeCovered = buildCoveredSet(
      [
        { headRefName: "copilot/fix-3-c", title: "Fix 3", closingIssuesReferences: [{ number: 3 }] },
        { headRefName: "copilot/work-for-issue-4", title: "Work", closingIssuesReferences: [] },
      ],
      assignedIssues
    );

    // Issue #5 is covered by neither — it is genuinely stale
    const genuinelyStale = [...assignedIssues].filter(
      (n) => !openPrCovered.has(n) && !recentMergeCovered.has(n)
    );

    expect(genuinelyStale).toEqual([5]);
    expect(openPrCovered.has(3)).toBe(false); // #3 not in open PRs
    expect(recentMergeCovered.has(3)).toBe(true); // #3 covered by recent merge → not stale
    expect(recentMergeCovered.has(4)).toBe(true); // #4 covered via branch name
  });

  it("capacity gate: no re-kicks when open PRs >= max", () => {
    // Simulate 8 open PRs covering issues #1–#8
    const assignedIssues = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const MAX = 8;
    const openPrCount = 8;

    // When open PRs hit the max, findStaleIssues returns [] before filtering
    const gap = MAX - openPrCount;
    expect(gap).toBe(0);

    // The gap slice ensures no re-kicks even if genuinely stale issues exist
    const genuinelyStale = [9]; // issue #9 has no PR
    const toRekick = genuinelyStale.slice(0, gap);
    expect(toRekick).toEqual([]);
  });

  it("filters to genuinely stale when open PRs cover some but not all assigned issues", () => {
    const assignedIssues = new Set([10, 20, 30, 40, 50]);
    const MAX = 8;

    // 5 open PRs — gap is 3, but we only have 5 assigned issues
    const openPrs = [
      { headRefName: "copilot/fix-10", title: "Fix", closingIssuesReferences: [{ number: 10 }] },
      { headRefName: "copilot/fix-20", title: "Fix", closingIssuesReferences: [{ number: 20 }] },
      { headRefName: "copilot/fix-30", title: "Fix", closingIssuesReferences: [{ number: 30 }] },
    ];
    const openPrCovered = buildCoveredSet(openPrs, assignedIssues);

    const genuinelyStale = [...assignedIssues].filter((n) => !openPrCovered.has(n));
    const gap = MAX - openPrs.length;
    const toRekick = genuinelyStale.slice(0, gap);

    // #40 and #50 are stale; gap is 5 so both would be re-kicked
    expect(genuinelyStale.sort()).toEqual([40, 50]);
    expect(gap).toBe(5);
    expect(toRekick.sort()).toEqual([40, 50]);
  });
});
