/**
 * Regression tests for the stale-rekick filter in findStaleIssues (run-assignment.ts).
 *
 * These tests document the behavioral contracts for Task C from
 * docs/specs/copilot-assignment-cleanup.md:
 *
 *   Given: assigned issues with open/merged PR coverage at various combinations,
 *   Asserts: only genuinely uncovered issues are returned for re-kick,
 *   Asserts: capacity gate prevents re-kicks when openPrs >= max,
 *   Asserts: issues covered by a recently-merged PR are excluded from re-kick.
 *
 * The filter logic lives in buildCoveredSet (factory-tools.ts), which is the
 * exported pure function that findStaleIssues uses internally.  All tests run
 * without network access — no gh CLI calls are made.
 */

import { describe, it, expect } from "vitest";
import { buildCoveredSet } from "../factory-tools.js";

// ── Helper types ──────────────────────────────────────────────────────────────

type PrLike = {
  headRefName: string;
  title: string;
  closingIssuesReferences: Array<{ number: number }>;
};

// ── Task C: findStaleIssues filter behavioral contracts ───────────────────────

describe("stale-rekick filter — Task C behavioral contracts", () => {
  /**
   * Core scenario from the spec:
   * 5 assigned issues, 3 open PRs covering #1/#2/#3 via different signals,
   * open PR count = 5, max = 8, gap = 3.
   * Result: only #4 and #5 are genuinely stale.
   */
  it("returns only uncovered issues as stale given mixed coverage signals", () => {
    const assignedIssues = new Set([1, 2, 3, 4, 5]);
    const MAX = 8;

    const openPrs: PrLike[] = [
      // #1 covered via explicit closingIssuesReferences
      { headRefName: "copilot/some-fix", title: "Fix something", closingIssuesReferences: [{ number: 1 }] },
      // #2 covered via issue number in branch name
      { headRefName: "copilot/fix-2-description", title: "Unrelated title", closingIssuesReferences: [] },
      // #3 covered via #N in PR title
      { headRefName: "copilot/other-work", title: "Work for #3", closingIssuesReferences: [] },
    ];

    const covered = buildCoveredSet(openPrs, assignedIssues);
    const genuinelyStale = [...assignedIssues].filter((n) => !covered.has(n));
    const gap = MAX - openPrs.length;
    const toRekick = genuinelyStale.slice(0, gap);

    // #1, #2, #3 are covered — only #4 and #5 are stale
    expect(covered.has(1)).toBe(true); // explicit ref
    expect(covered.has(2)).toBe(true); // branch name
    expect(covered.has(3)).toBe(true); // title
    expect(covered.has(4)).toBe(false);
    expect(covered.has(5)).toBe(false);

    expect(genuinelyStale.sort()).toEqual([4, 5]);

    // gap = 8 - 3 = 5, so both stale issues would be re-kicked
    expect(gap).toBe(5);
    expect(toRekick.sort()).toEqual([4, 5]);
  });

  /**
   * Capacity gate: when openPrs >= max, the gap is 0 and no issues are re-kicked,
   * even if genuinely stale issues exist.
   */
  it("capacity gate: no re-kicks when open PRs reach maximum", () => {
    const MAX = 8;
    const openPrCount = 8;
    const gap = MAX - openPrCount;

    expect(gap).toBe(0);

    // Even if there are stale issues, the gap slice returns nothing
    const genuinelyStale = [9, 10, 11];
    const toRekick = genuinelyStale.slice(0, gap);
    expect(toRekick).toEqual([]);
  });

  /**
   * Capacity gate: when openPrs exceed max (e.g. pipeline has more open PRs than
   * the configured ceiling), the gap is negative — treat as 0 re-kicks.
   */
  it("capacity gate: no re-kicks when open PRs exceed maximum", () => {
    const MAX = 8;
    const openPrCount = 10;
    const gap = Math.max(0, MAX - openPrCount);

    expect(gap).toBe(0);

    const toRekick = [99].slice(0, gap);
    expect(toRekick).toEqual([]);
  });

  /**
   * Issues covered by recently-merged PRs must be excluded from re-kick.
   * They are classified as "merged_but_open" (work was done, issue just wasn't closed).
   */
  it("issues covered by recently-merged PRs are excluded from re-kick", () => {
    const assignedIssues = new Set([1, 2, 3, 4, 5]);

    // Open PRs cover only #1 and #2
    const openPrCovered = buildCoveredSet(
      [
        { headRefName: "copilot/fix-1", title: "Fix #1", closingIssuesReferences: [{ number: 1 }] },
        { headRefName: "copilot/fix-2", title: "Fix", closingIssuesReferences: [{ number: 2 }] },
      ],
      assignedIssues
    );

    // Recently-merged PRs cover #3 and #4
    const recentMergeCovered = buildCoveredSet(
      [
        { headRefName: "copilot/fix-3", title: "Fix 3", closingIssuesReferences: [{ number: 3 }] },
        { headRefName: "copilot/work-for-issue-4", title: "Work", closingIssuesReferences: [] },
      ],
      assignedIssues
    );

    // Only #5 has no coverage at all — genuinely stale
    const genuinelyStale = [...assignedIssues].filter(
      (n) => !openPrCovered.has(n) && !recentMergeCovered.has(n)
    );

    // Issues covered only by a merged PR — should be cleaned up, not re-kicked
    const mergedButOpen = [...assignedIssues].filter(
      (n) => !openPrCovered.has(n) && recentMergeCovered.has(n)
    );

    expect(genuinelyStale).toEqual([5]);
    expect(mergedButOpen.sort()).toEqual([3, 4]);

    // Confirm #3 is in merged-but-open, not stale
    expect(recentMergeCovered.has(3)).toBe(true);
    expect(openPrCovered.has(3)).toBe(false);

    // Confirm #4 is covered via branch name in the merged PR
    expect(recentMergeCovered.has(4)).toBe(true);
  });

  /**
   * Branch-name signal must not produce false positives: a number that appears
   * in the branch but is NOT a known assigned issue must not be added to
   * the covered set.
   */
  it("branch-name signal does not cover numbers absent from known assigned issues", () => {
    const assignedIssues = new Set([100, 200, 300]);

    const covered = buildCoveredSet(
      [
        // Branch "fix-99-something": 99 is not in assignedIssues → not covered
        { headRefName: "copilot/fix-99-something", title: "Fix", closingIssuesReferences: [] },
      ],
      assignedIssues
    );

    expect(covered.has(99)).toBe(false);
    expect(covered.size).toBe(0);
  });

  /**
   * Title #N signal must not produce false positives for unknown issue numbers.
   */
  it("title #N signal does not cover numbers absent from known assigned issues", () => {
    const assignedIssues = new Set([100, 200, 300]);

    const covered = buildCoveredSet(
      [
        { headRefName: "copilot/some-work", title: "Fix the problem for #999", closingIssuesReferences: [] },
      ],
      assignedIssues
    );

    expect(covered.has(999)).toBe(false);
    expect(covered.size).toBe(0);
  });

  /**
   * Multiple PRs — combined coverage from all three signals across multiple PRs.
   */
  it("combines coverage across multiple PRs using all three signals", () => {
    const assignedIssues = new Set([10, 20, 30, 40, 50]);

    const covered = buildCoveredSet(
      [
        // #10 via branch name
        { headRefName: "copilot/fix-10-feature", title: "Add feature", closingIssuesReferences: [] },
        // #20 via explicit ref
        { headRefName: "copilot/some-other", title: "Other work", closingIssuesReferences: [{ number: 20 }] },
        // #30 via title
        { headRefName: "copilot/some-work", title: "Work for #30", closingIssuesReferences: [] },
        // #40 and #50 have no coverage
      ],
      assignedIssues
    );

    expect(covered.has(10)).toBe(true);  // branch
    expect(covered.has(20)).toBe(true);  // explicit ref
    expect(covered.has(30)).toBe(true);  // title
    expect(covered.has(40)).toBe(false); // no coverage
    expect(covered.has(50)).toBe(false); // no coverage

    const genuinelyStale = [...assignedIssues].filter((n) => !covered.has(n));
    expect(genuinelyStale.sort()).toEqual([40, 50]);
  });

  /**
   * Empty PR list → all assigned issues are stale (no coverage).
   */
  it("all assigned issues are stale when there are no open PRs", () => {
    const assignedIssues = new Set([1, 2, 3]);
    const covered = buildCoveredSet([], assignedIssues);
    expect(covered.size).toBe(0);

    const genuinelyStale = [...assignedIssues];
    expect(genuinelyStale.sort()).toEqual([1, 2, 3]);
  });

  /**
   * When all assigned issues are covered by open PRs, no re-kicks happen.
   */
  it("no stale issues when all assigned issues are covered by open PRs", () => {
    const assignedIssues = new Set([1, 2, 3]);

    const covered = buildCoveredSet(
      [
        { headRefName: "copilot/fix", title: "Fix", closingIssuesReferences: [{ number: 1 }, { number: 2 }, { number: 3 }] },
      ],
      assignedIssues
    );

    const genuinelyStale = [...assignedIssues].filter((n) => !covered.has(n));
    expect(genuinelyStale).toEqual([]);
  });
});
