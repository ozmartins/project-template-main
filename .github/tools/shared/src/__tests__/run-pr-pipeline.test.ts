import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));
import {
  runPrLoop,
  buildPrPrompt,
  evaluatePrPreflight,
  buildLinkedIssueNoDiffComment,
  buildConflictRefreshOutcomes,
  closeNoDiffCopilotPr,
  type PrLoopResult,
} from "../run-pr-pipeline.js";
import {
  buildAssignmentPrompt,
  buildAssignmentSummary,
} from "../run-assignment.js";
import type { PrSnapshot } from "../pr-snapshot.js";

function pr(n: number, title = `pr ${n}`, overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    number: n,
    title,
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

describe("runPrLoop", () => {
  it("returns no results for an empty PR list", async () => {
    const calls: number[] = [];
    const out = await runPrLoop([], async (p) => {
      calls.push(p.number);
      return { number: p.number, title: p.title, status: "ok" } as PrLoopResult;
    });
    expect(out).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("processes PRs in the given order, one by one", async () => {
    const seen: number[] = [];
    await runPrLoop([pr(10), pr(20), pr(30)], async (p) => {
      seen.push(p.number);
      return { number: p.number, title: p.title, status: "ok" };
    });
    expect(seen).toEqual([10, 20, 30]);
  });

  it("continues past a handler that throws, recording it as an error", async () => {
    const seen: number[] = [];
    const out = await runPrLoop([pr(1), pr(2), pr(3)], async (p) => {
      seen.push(p.number);
      if (p.number === 2) throw new Error("boom");
      return { number: p.number, title: p.title, status: "ok" };
    });
    // All three were attempted despite #2 throwing — tail is never lost to one bad PR.
    expect(seen).toEqual([1, 2, 3]);
    expect(out.map((r) => [r.number, r.status])).toEqual([
      [1, "ok"],
      [2, "error"],
      [3, "ok"],
    ]);
    expect(out[1]!.detail).toContain("boom");
  });

  it("stops starting new PRs once shouldContinue() returns false (defers the tail)", async () => {
    const seen: number[] = [];
    let budget = 2; // allow exactly two PRs, then "run out of budget"
    const out = await runPrLoop(
      [pr(10), pr(20), pr(30), pr(40)],
      async (p) => {
        seen.push(p.number);
        return { number: p.number, title: p.title, status: "ok" };
      },
      () => budget-- > 0
    );
    // Oldest two handled; newer two deferred to the next pass.
    expect(seen).toEqual([10, 20]);
    expect(out.map((r) => r.number)).toEqual([10, 20]);
  });

  it("preserves a timeout status returned by the handler", async () => {
    const out = await runPrLoop([pr(7)], async (p) => ({
      number: p.number,
      title: p.title,
      status: "timeout",
      detail: "Timeout after 360000ms",
    }));
    expect(out[0]!.status).toBe("timeout");
  });
});

describe("buildPrPrompt", () => {
  it("embeds the PR number, title, and the snapshot JSON", () => {
    const prompt = buildPrPrompt(pr(42, "fix the thing"));
    expect(prompt).toContain("#42");
    expect(prompt).toContain("fix the thing");
    expect(prompt).toContain('"number": 42');
    expect(prompt).toContain("--pr 42");
  });
});

describe("evaluatePrPreflight", () => {
  it("auto-closes no-diff Copilot PRs before review", () => {
    const decision = evaluatePrPreflight(
      pr(44, "confirm already fixed", { changedFiles: 0, author: "copilot-swe-agent[bot]" })
    );
    expect(decision.autoCloseNoDiff).toBe(true);
    expect(decision.reason).toContain("changedFiles=0");
  });

  it("does not auto-close non-Copilot zero-diff PRs", () => {
    const decision = evaluatePrPreflight(
      pr(45, "maintainer bookkeeping", { changedFiles: 0, author: "ianreay" })
    );
    expect(decision).toEqual({ autoCloseNoDiff: false });
  });

  it("does not auto-close Copilot PRs that have a real diff", () => {
    const decision = evaluatePrPreflight(pr(46, "real fix", { changedFiles: 2 }));
    expect(decision).toEqual({ autoCloseNoDiff: false });
  });
});

describe("buildLinkedIssueNoDiffComment", () => {
  it("includes the factory-reconciliation-guard marker for deduplication", () => {
    const comment = buildLinkedIssueNoDiffComment(1079);
    expect(comment).toContain("[factory-reconciliation-guard]");
  });

  it("references the PR number so the issue comment is traceable", () => {
    const comment = buildLinkedIssueNoDiffComment(1079);
    expect(comment).toContain("#1079");
  });

  it("mentions changedFiles: 0 as the reason for closure", () => {
    const comment = buildLinkedIssueNoDiffComment(1079);
    expect(comment).toContain("changedFiles: 0");
  });

  it("mentions that the Copilot assignee was removed", () => {
    const comment = buildLinkedIssueNoDiffComment(1079);
    expect(comment.toLowerCase()).toContain("assignee");
  });

  it("mentions checking main so the developer knows the next step", () => {
    const comment = buildLinkedIssueNoDiffComment(1079);
    expect(comment).toContain("main");
  });

  it("produces distinct comments for different PR numbers", () => {
    expect(buildLinkedIssueNoDiffComment(100)).not.toBe(buildLinkedIssueNoDiffComment(200));
  });
});

describe("closeNoDiffCopilotPr", () => {
  const ctx = { owner: "myorg", repo: "myrepo", workspace: "/workspace" } as ReturnType<typeof import("../github-context.js").getGitHubContext>;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      // lookupCopilotBotId — assignableUsers query returns bot node ID
      if (args.includes("graphql") && args.some((a) => a.includes("assignableUsers"))) {
        return "BOT_NODE_ID\n";
      }
      // lookupCopilotBotId fallback via issue assignees — not needed when primary succeeds
      if (args.includes("graphql") && args.some((a) => a.includes("filterBy"))) {
        return "BOT_NODE_ID\n";
      }
      // gh api repos/.../issues/:n --jq .node_id
      if (args.includes("api") && args.some((a) => a.includes("/issues/")) && args.includes("--jq")) {
        return "ISSUE_NODE_ID\n";
      }
      // GraphQL removeAssigneesFromAssignable mutation — just succeed
      if (args.includes("graphql") && args.some((a) => a.includes("removeAssigneesFromAssignable"))) {
        return '{"data":{}}\n';
      }
      // All other gh calls (pr comment, pr close, issue comment) succeed silently
      return "";
    });
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  it("calls GraphQL removeAssigneesFromAssignable for each linked issue", () => {
    const snapshot = pr(1080, "empty pr", {
      author: "copilot-swe-agent[bot]",
      changedFiles: 0,
      linkedIssues: [42, 57],
    });

    closeNoDiffCopilotPr(snapshot, ctx);

    const graphqlCalls = (execFileSyncMock.mock.calls as [string, string[]][]).filter(
      ([, args]) => args.includes("graphql") && args.some((a) => a.includes("removeAssigneesFromAssignable"))
    );
    expect(graphqlCalls).toHaveLength(2);
    // Each call passes the Copilot bot node ID and issue node ID
    for (const call of graphqlCalls) {
      const argsText = call[1]?.join(" ") ?? "";
      expect(argsText).toContain("BOT_NODE_ID");
      expect(argsText).toContain("ISSUE_NODE_ID");
    }
  });

  it("posts an evidence comment on each linked issue after unassigning", () => {
    const snapshot = pr(1081, "empty pr", {
      author: "copilot-swe-agent[bot]",
      changedFiles: 0,
      linkedIssues: [99],
    });

    closeNoDiffCopilotPr(snapshot, ctx);

    const issueCommentCalls = (execFileSyncMock.mock.calls as [string, string[]][]).filter(
      ([, args]) => args[0] === "issue" && args[1] === "comment"
    );
    expect(issueCommentCalls).toHaveLength(1);
    const [, bodyArgs] = issueCommentCalls[0]!;
    const bodyIndex = bodyArgs.indexOf("--body");
    expect(bodyIndex).toBeGreaterThan(-1);
    const commentBody = bodyArgs[bodyIndex + 1]!;
    expect(commentBody).toContain("[factory-reconciliation-guard]");
    expect(commentBody).toContain("#1081");
  });
  it("does not call removeAssigneesFromAssignable when there are no linked issues", () => {
    const snapshot = pr(1082, "empty pr no links", {
      author: "copilot-swe-agent[bot]",
      changedFiles: 0,
      linkedIssues: [],
    });

    const result = closeNoDiffCopilotPr(snapshot, ctx);

    const graphqlCalls = (execFileSyncMock.mock.calls as [string, string[]][]).filter(
      ([, args]) => args.includes("graphql") && args.some((a) => a.includes("removeAssigneesFromAssignable"))
    );
    expect(graphqlCalls).toHaveLength(0);
    expect(result.status).toBe("ok");
  });

  it("records detail entries for unassign and comment on each linked issue", () => {
    const snapshot = pr(1083, "empty pr", {
      author: "copilot-swe-agent[bot]",
      changedFiles: 0,
      linkedIssues: [10, 11],
    });

    const result = closeNoDiffCopilotPr(snapshot, ctx);

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("unassigned Copilot from issue #10");
    expect(result.detail).toContain("unassigned Copilot from issue #11");
    expect(result.detail).toContain("commented on issue #10");
    expect(result.detail).toContain("commented on issue #11");
  });
});

describe("buildConflictRefreshOutcomes", () => {
  it("records triggered refresh for handled conflicting Copilot PRs", () => {
    const outcomes = buildConflictRefreshOutcomes(
      [pr(1, "conflict", { mergeable: "CONFLICTING", author: "copilot-swe-agent[bot]" })],
      [{ number: 1, title: "conflict", status: "ok" }],
      [],
      [],
      "2026-06-23T12:00:00.000Z",
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.refreshStatus).toContain("refresh triggered");
  });

  it("records intentionally skipped refresh with explicit reason", () => {
    const conflictPr = pr(2, "warm draft conflict", {
      mergeable: "CONFLICTING",
      author: "copilot-swe-agent[bot]",
      isDraft: true,
    });
    const outcomes = buildConflictRefreshOutcomes(
      [conflictPr],
      [],
      [{ snapshot: conflictPr, reason: "draft still warm" }],
      [],
      "2026-06-23T12:00:00.000Z",
    );
    expect(outcomes[0]!.refreshStatus).toContain("intentionally skipped");
    expect(outcomes[0]!.refreshStatus).toContain("draft still warm");
  });

  it("records deferred refresh when pass budget is exhausted", () => {
    const conflictPr = pr(3, "deferred conflict", {
      mergeable: "CONFLICTING",
      author: "copilot-swe-agent[bot]",
    });
    const outcomes = buildConflictRefreshOutcomes(
      [conflictPr],
      [],
      [],
      [conflictPr],
      "2026-06-23T12:00:00.000Z",
    );
    expect(outcomes[0]!.refreshStatus).toContain("deferred due to pass budget");
  });

  it("excludes human-authored CONFLICTING PRs from conflict outcomes", () => {
    const humanPr = pr(4, "human conflict", {
      mergeable: "CONFLICTING",
      author: "ianreay",
    });
    const outcomes = buildConflictRefreshOutcomes(
      [humanPr],
      [],
      [],
      [],
      "2026-06-23T12:00:00.000Z",
    );
    expect(outcomes).toHaveLength(0);
  });

  it("records unknown refresh outcome when PR was not handled, skipped, or deferred", () => {
    const conflictPr = pr(5, "unaccounted conflict", {
      mergeable: "CONFLICTING",
      author: "copilot-swe-agent[bot]",
    });
    const outcomes = buildConflictRefreshOutcomes(
      [conflictPr],
      [],
      [],
      [],
      "2026-06-23T12:00:00.000Z",
    );
    expect(outcomes[0]!.refreshStatus).toContain("refresh outcome unknown");
  });

  it("records error status when refresh session errored", () => {
    const conflictPr = pr(6, "errored conflict", {
      mergeable: "CONFLICTING",
      author: "copilot-swe-agent[bot]",
    });
    const outcomes = buildConflictRefreshOutcomes(
      [conflictPr],
      [{ number: 6, title: "errored conflict", status: "error", detail: "SDK error" }],
      [],
      [],
      "2026-06-23T12:00:00.000Z",
    );
    expect(outcomes[0]!.refreshStatus).toContain("refresh triggered");
    expect(outcomes[0]!.refreshStatus).toContain("error");
  });
});

describe("assignment-phase contract", () => {
  it("keeps stale-cleanup prompt aligned with linked PRs, @copilot nudges, and capacity refill", () => {
    const prompt = buildAssignmentPrompt({
      defaultBranch: "main",
      maxOpenCopilotPrs: 8,
      rekickedCount: 2,
    });

    expect(prompt).toContain("Stage 2b assignment pass must still run even when Stage 2a fails or times out");
    expect(prompt).toContain("linkedPullRequests");
    expect(prompt).toContain("@copilot please open a draft PR for this issue from main. The PR body MUST include 'Closes #<issue-number>' so the pipeline can track it. Do not expand scope.");
    expect(prompt).toContain("30 minutes old or more");
    expect(prompt).toContain("refill capacity up to 8 open Copilot PRs");
    expect(prompt).not.toContain("assigned-to-copilot");
    expect(prompt).not.toContain("updated >3 hours ago");
  });

  it("includes [factory-rekick] coordination instruction so Stage 2b agents avoid double-kicking Stage 0 issues", () => {
    // Stage 0 (rekickIssue in run-assignment.ts) posts a comment prefixed with
    // "[factory-rekick]". The Stage 2b prompt must instruct the agent to check
    // for that marker before re-kicking, so the two phases stay coordinated.
    const prompt = buildAssignmentPrompt({
      defaultBranch: "main",
      maxOpenCopilotPrs: 8,
      rekickedCount: 3,
    });

    expect(prompt).toContain("[factory-rekick]");
    expect(prompt).toContain("30 minutes");
  });

  it("summarises stale cleanup without drifting back to removed label language", () => {
    const summary = buildAssignmentSummary({
      status: "ok",
      maxOpenCopilotPrs: 8,
      staleIssues: [{ number: 17, title: "stale issue", nodeId: "ISSUE_17" }],
      rekickedCount: 1,
    });

    expect(summary).toContain("linkedPullRequests");
    expect(summary).toContain("@copilot");
    expect(summary).toContain("30-minute grace nudge");
    expect(summary).toContain("up to 8 open Copilot PRs");
    expect(summary).toContain("Re-kicked earlier this pass: #17");
    expect(summary).not.toContain("assigned-to-copilot");
  });
});
