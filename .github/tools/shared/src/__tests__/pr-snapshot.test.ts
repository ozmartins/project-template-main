import { describe, it, expect } from "vitest";
import { parsePrSnapshots } from "../pr-snapshot.js";

/**
 * Crafted GraphQL fixture (shape mirrors PR_SNAPSHOT_QUERY) covering the
 * parsing edge cases the loop depends on:
 *  - #1 approved AFTER an earlier changes-request from the SAME reviewer
 *        → must read as approved, NOT changes-requested (latest-per-author).
 *  - #2 a draft with a legacy StatusContext + a failing CheckRun, no reviews.
 *  - #3 empty everything (no reviews, no rollup, no commits) → safe defaults.
 */
const FIXTURE = {
  data: {
    repository: {
      pullRequests: {
        nodes: [
          {
            number: 1,
            title: "approved after changes",
            createdAt: "2026-06-01T10:00:00Z",
            updatedAt: "2026-06-01T12:00:00Z",
            isDraft: false,
            mergeable: "MERGEABLE",
            reviewDecision: null,
            changedFiles: 3,
            author: { login: "copilot-swe-agent" },
            labels: { nodes: [{ name: "queue:review" }, { name: "risk:low" }] },
            reviews: {
              nodes: [
                { state: "CHANGES_REQUESTED", author: { login: "ianreay" }, submittedAt: "2026-06-01T11:00:00Z" },
                { state: "APPROVED", author: { login: "ianreay" }, submittedAt: "2026-06-01T11:30:00Z" },
              ],
            },
            commits: {
              nodes: [
                {
                  commit: {
                    committedDate: "2026-06-01T11:45:00Z",
                    statusCheckRollup: {
                      state: "SUCCESS",
                      contexts: { nodes: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }] },
                    },
                  },
                },
              ],
            },
            closingIssuesReferences: { nodes: [{ number: 42 }] },
          },
          {
            number: 2,
            title: "draft with failing check",
            createdAt: "2026-06-02T10:00:00Z",
            updatedAt: "2026-06-02T10:30:00Z",
            isDraft: true,
            mergeable: "UNKNOWN",
            reviewDecision: null,
            changedFiles: 1,
            author: { login: "copilot-swe-agent" },
            labels: { nodes: [] },
            reviews: { nodes: [] },
            commits: {
              nodes: [
                {
                  commit: {
                    committedDate: "2026-06-02T10:25:00Z",
                    statusCheckRollup: {
                      state: "FAILURE",
                      contexts: {
                        nodes: [
                          { __typename: "CheckRun", name: "pr-validation", status: "COMPLETED", conclusion: "FAILURE" },
                          { __typename: "StatusContext", context: "legacy/ci", state: "PENDING" },
                        ],
                      },
                    },
                  },
                },
              ],
            },
            closingIssuesReferences: { nodes: [] },
          },
          {
            number: 3,
            title: "bare PR",
            createdAt: "2026-06-03T10:00:00Z",
            updatedAt: "2026-06-03T10:00:00Z",
            isDraft: false,
            mergeable: "MERGEABLE",
            reviewDecision: null,
            changedFiles: 0,
            author: { login: "copilot-swe-agent" },
            labels: { nodes: [] },
            reviews: { nodes: [] },
            commits: { nodes: [] },
            closingIssuesReferences: { nodes: [] },
          },
        ],
      },
    },
  },
};

describe("parsePrSnapshots", () => {
  const snaps = parsePrSnapshots(FIXTURE);

  it("parses one snapshot per PR node, preserving order", () => {
    expect(snaps.map((s) => s.number)).toEqual([1, 2, 3]);
  });

  it("treats an APPROVED that supersedes the same author's CHANGES_REQUESTED as approved", () => {
    const pr1 = snaps[0]!;
    expect(pr1.approved).toBe(true);
    expect(pr1.changesRequested).toBe(false);
    expect(pr1.latestReview?.state).toBe("APPROVED");
  });

  it("extracts labels, linked issues, CI rollup and last-commit time", () => {
    const pr1 = snaps[0]!;
    expect(pr1.labels).toEqual(["queue:review", "risk:low"]);
    expect(pr1.linkedIssues).toEqual([42]);
    expect(pr1.ciState).toBe("SUCCESS");
    expect(pr1.lastCommitAt).toBe("2026-06-01T11:45:00Z");
    expect(pr1.checks).toEqual([{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }]);
  });

  it("normalises a legacy StatusContext into a check with its state as conclusion", () => {
    const pr2 = snaps[1]!;
    expect(pr2.isDraft).toBe(true);
    expect(pr2.ciState).toBe("FAILURE");
    expect(pr2.checks).toContainEqual({ name: "pr-validation", status: "COMPLETED", conclusion: "FAILURE" });
    expect(pr2.checks).toContainEqual({ name: "legacy/ci", status: "STATUS", conclusion: "PENDING" });
  });

  it("uses safe defaults for a PR with no reviews, checks, or commits", () => {
    const pr3 = snaps[2]!;
    expect(pr3.approved).toBe(false);
    expect(pr3.changesRequested).toBe(false);
    expect(pr3.latestReview).toBeNull();
    expect(pr3.ciState).toBeNull();
    expect(pr3.checks).toEqual([]);
    expect(pr3.lastCommitAt).toBeNull();
    expect(pr3.linkedIssues).toEqual([]);
  });

  it("returns an empty array when the response has no PRs", () => {
    expect(parsePrSnapshots({ data: { repository: { pullRequests: { nodes: [] } } } })).toEqual([]);
    expect(parsePrSnapshots({})).toEqual([]);
  });
});
