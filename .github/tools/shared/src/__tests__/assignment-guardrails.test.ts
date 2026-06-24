import { describe, expect, it } from "vitest";
import { evaluateAssignmentGuardrails } from "../factory-tools.js";

describe("evaluateAssignmentGuardrails", () => {
  it("blocks assignment for queue:architecture issues", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["documentation", "queue:architecture"],
      openPrs: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.reason).toContain("queue:architecture");
  });

  it("blocks assignment when an open PR already references the issue", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [
        {
          number: 476,
          title: "Restructure docs directory",
          closingIssuesReferences: [{ number: 458 }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.duplicatePrNumbers).toEqual([476]);
  });

  it("detects duplicate PRs from #issue references in title/body", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [
        { number: 475, title: "[WIP] Work for #458" },
        { number: 477, title: "Another PR", body: "Fixes #458" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.duplicatePrNumbers).toEqual([475, 477]);
  });

  it("detects duplicate PRs from fully-qualified owner/repo#issue references", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [
        { number: 479, title: "Follow-up for Volaris-AI/project-template#458" },
        { number: 480, title: "Another PR", body: "Closes Volaris-AI/project-template#458" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.duplicatePrNumbers).toEqual([479, 480]);
  });

  it("detects duplicate open PRs via issue token in branch name", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [{ number: 478, title: "Work in progress", headRefName: "copilot/fix-458-duplicate" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.duplicatePrNumbers).toEqual([478]);
  });

  it("allows assignment when issue is implementation-ready and has no open duplicate PR", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [{ number: 500, title: "Unrelated PR for #123" }],
    });

    expect(result).toEqual({ ok: true, duplicatePrNumbers: [] });
  });

  it("blocks assignment when a recently merged PR already covers the issue", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [],
      mergedPrs: [
        {
          number: 610,
          title: "Fix duplicate no-op assignment for #458",
          mergedAt: new Date().toISOString(),
          closingIssuesReferences: [{ number: 458 }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.reason).toContain("recently merged PR");
    expect(result.duplicatePrNumbers).toEqual([610]);
    expect(result.closeIssue).toBe(true);
  });

  it("blocks assignment when recent merged coverage is only via branch token", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [],
      mergedPrs: [
        {
          number: 612,
          title: "Follow-up fix",
          headRefName: "copilot/fix-458-main-already-has-it",
          mergedAt: new Date().toISOString(),
          closingIssuesReferences: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected guardrail block");
    expect(result.duplicatePrNumbers).toEqual([612]);
    expect(result.closeIssue).toBe(true);
  });

  it("allows assignment when only older merged PRs reference the issue", () => {
    const result = evaluateAssignmentGuardrails({
      issueNumber: 458,
      issueLabels: ["queue:development", "ready-for-dev"],
      openPrs: [],
      mergedPrs: [
        {
          number: 611,
          title: "Older work for #458",
          mergedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          closingIssuesReferences: [{ number: 458 }],
        },
      ],
    });

    expect(result).toEqual({ ok: true, duplicatePrNumbers: [] });
  });
});
