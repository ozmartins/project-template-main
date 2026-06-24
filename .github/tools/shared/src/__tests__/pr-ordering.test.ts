import { describe, it, expect } from "vitest";
import { orderPrs, isActionable, planLoop, minutesSince, SETTLE_MINUTES } from "../pr-ordering.js";
import type { PrSnapshot } from "../pr-snapshot.js";

const NOW = new Date("2026-06-07T12:00:00Z").getTime();

function pr(overrides: Partial<PrSnapshot>): PrSnapshot {
  return {
    number: 1,
    title: "t",
    author: "copilot-swe-agent",
    createdAt: "2026-06-07T10:00:00Z",
    updatedAt: "2026-06-07T11:00:00Z",
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    changedFiles: 1,
    labels: [],
    latestReview: null,
    approved: false,
    changesRequested: false,
    lastCommitAt: "2026-06-07T11:00:00Z",
    ciState: "SUCCESS",
    checks: [],
    linkedIssues: [],
    ...overrides,
  };
}

describe("orderPrs", () => {
  it("sorts strictly oldest-first by createdAt", () => {
    const out = orderPrs([
      pr({ number: 3, createdAt: "2026-06-07T11:00:00Z" }),
      pr({ number: 1, createdAt: "2026-06-07T09:00:00Z" }),
      pr({ number: 2, createdAt: "2026-06-07T10:00:00Z" }),
    ]);
    expect(out.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("breaks createdAt ties by PR number and does not mutate the input", () => {
    const input = [
      pr({ number: 9, createdAt: "2026-06-07T10:00:00Z" }),
      pr({ number: 4, createdAt: "2026-06-07T10:00:00Z" }),
    ];
    const out = orderPrs(input);
    expect(out.map((p) => p.number)).toEqual([4, 9]);
    expect(input.map((p) => p.number)).toEqual([9, 4]); // original untouched
  });
});

describe("minutesSince", () => {
  it("returns Infinity for null", () => {
    expect(minutesSince(null, NOW)).toBe(Infinity);
  });
  it("computes elapsed minutes", () => {
    expect(minutesSince("2026-06-07T11:30:00Z", NOW)).toBe(30);
  });
});

describe("isActionable", () => {
  it("skips a draft that committed within the settle window", () => {
    const d = isActionable(pr({ isDraft: true, lastCommitAt: "2026-06-07T11:58:00Z" }), NOW);
    expect(d.actionable).toBe(false);
    expect(d.reason).toMatch(/still warm/);
  });

  it("keeps a settled draft (commit older than the settle window) actionable", () => {
    const old = new Date(NOW - (SETTLE_MINUTES + 5) * 60000).toISOString();
    expect(isActionable(pr({ isDraft: true, lastCommitAt: old }), NOW).actionable).toBe(true);
  });

  it("keeps a draft with no commit timestamp actionable (defaults to true when uncertain)", () => {
    expect(isActionable(pr({ isDraft: true, lastCommitAt: null }), NOW).actionable).toBe(true);
  });

  it("always keeps non-draft PRs actionable (conflicts, failing CI, awaiting review)", () => {
    expect(isActionable(pr({ isDraft: false, mergeable: "CONFLICTING" }), NOW).actionable).toBe(true);
    expect(isActionable(pr({ isDraft: false, ciState: "FAILURE" }), NOW).actionable).toBe(true);
    expect(isActionable(pr({ isDraft: false, approved: true }), NOW).actionable).toBe(true);
  });
});

describe("planLoop", () => {
  it("returns actionable PRs oldest-first and skipped PRs with reasons", () => {
    const plan = planLoop(
      [
        pr({ number: 30, createdAt: "2026-06-07T11:50:00Z", isDraft: true, lastCommitAt: "2026-06-07T11:59:00Z" }),
        pr({ number: 10, createdAt: "2026-06-07T09:00:00Z" }),
        pr({ number: 20, createdAt: "2026-06-07T10:00:00Z" }),
      ],
      NOW
    );
    expect(plan.actionable.map((p) => p.number)).toEqual([10, 20]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.snapshot.number).toBe(30);
    expect(plan.skipped[0]!.reason).toMatch(/still warm/);
  });
});
