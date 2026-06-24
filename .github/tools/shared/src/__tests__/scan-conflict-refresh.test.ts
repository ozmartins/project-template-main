import { describe, it, expect } from "vitest";
import { scanConflictingPrs, formatConflictSummary, COPILOT_BOT } from "../scan-conflict-refresh.js";
import type { PrSnapshot } from "../pr-snapshot.js";

const DETECTED_AT = "2026-06-15T14:30:00.000Z";

function pr(overrides: Partial<PrSnapshot>): PrSnapshot {
  return {
    number: 1,
    title: "test PR",
    author: COPILOT_BOT,
    createdAt: "2026-06-14T10:00:00Z",
    updatedAt: "2026-06-15T12:00:00Z",
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    changedFiles: 2,
    labels: [],
    latestReview: null,
    approved: false,
    changesRequested: false,
    lastCommitAt: "2026-06-15T10:00:00Z",
    ciState: "SUCCESS",
    checks: [],
    linkedIssues: [],
    ...overrides,
  };
}

describe("scanConflictingPrs", () => {
  it("returns empty array when no PRs are present", () => {
    expect(scanConflictingPrs([], DETECTED_AT)).toEqual([]);
  });

  it("returns empty array when no Copilot PRs are CONFLICTING", () => {
    const snapshots = [
      pr({ number: 1, mergeable: "MERGEABLE" }),
      pr({ number: 2, mergeable: "UNKNOWN" }),
    ];
    expect(scanConflictingPrs(snapshots, DETECTED_AT)).toEqual([]);
  });

  it("excludes CONFLICTING PRs authored by humans (not the Copilot bot)", () => {
    const snapshots = [
      pr({ number: 5, author: "human-dev", mergeable: "CONFLICTING" }),
    ];
    expect(scanConflictingPrs(snapshots, DETECTED_AT)).toEqual([]);
  });

  it("detects a CONFLICTING Copilot PR and stamps it with detectedAt", () => {
    const snapshots = [
      pr({ number: 42, title: "feat: add new thing", mergeable: "CONFLICTING" }),
    ];
    const records = scanConflictingPrs(snapshots, DETECTED_AT);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      number: 42,
      title: "feat: add new thing",
      author: COPILOT_BOT,
      detectedAt: DETECTED_AT,
    });
    expect(records[0]!.action).toBeTruthy();
  });

  it("detects multiple CONFLICTING Copilot PRs in one scan", () => {
    const snapshots = [
      pr({ number: 10, mergeable: "CONFLICTING" }),
      pr({ number: 11, mergeable: "MERGEABLE" }),
      pr({ number: 12, mergeable: "CONFLICTING" }),
      pr({ number: 13, author: "someone-else", mergeable: "CONFLICTING" }),
    ];
    const records = scanConflictingPrs(snapshots, DETECTED_AT);
    expect(records.map((r) => r.number)).toEqual([10, 12]);
  });

  it("stamps each record with the provided detectedAt timestamp", () => {
    const ts = "2026-06-20T09:15:00.000Z";
    const snapshots = [pr({ number: 99, mergeable: "CONFLICTING" })];
    const [record] = scanConflictingPrs(snapshots, ts);
    expect(record!.detectedAt).toBe(ts);
  });
});

describe("formatConflictSummary", () => {
  it("shows a green tick and total count when no conflicts are found", () => {
    const summary = formatConflictSummary([], DETECTED_AT, 5);
    expect(summary).toContain("✅");
    expect(summary).toContain("No open Copilot PRs are currently CONFLICTING");
    expect(summary).toContain("5");
  });

  it("shows the conflict count and a table row for each detected PR", () => {
    const records = [
      {
        number: 42,
        title: "feat: add new thing",
        author: COPILOT_BOT,
        detectedAt: DETECTED_AT,
        action: "queued for pr-handler conflict refresh; Stage 2 summary records triggered/skipped outcome",
      },
      {
        number: 55,
        title: "fix: another thing",
        author: COPILOT_BOT,
        detectedAt: DETECTED_AT,
        action: "queued for pr-handler conflict refresh; Stage 2 summary records triggered/skipped outcome",
      },
    ];
    const summary = formatConflictSummary(records, DETECTED_AT, 8);
    expect(summary).toContain("⚡");
    expect(summary).toContain("2 Copilot PR(s) detected as CONFLICTING");
    expect(summary).toContain("| #42 |");
    expect(summary).toContain("| #55 |");
    expect(summary).toContain("feat: add new thing");
    expect(summary).toContain("fix: another thing");
  });

  it("truncates long PR titles at 60 characters in the table", () => {
    const longTitle = "A".repeat(80);
    const records = [
      { number: 7, title: longTitle, author: COPILOT_BOT, detectedAt: DETECTED_AT, action: "pr-handler will nudge (priority-1 in this pipeline pass)" },
    ];
    const summary = formatConflictSummary(records, DETECTED_AT, 3);
    expect(summary).toContain("A".repeat(60));
    expect(summary).not.toContain("A".repeat(61));
  });

  it("includes the scan timestamp in the heading", () => {
    const summary = formatConflictSummary([], "2026-06-15T14:30:00.000Z", 0);
    expect(summary).toContain("2026-06-15 14:30 UTC");
  });
});
