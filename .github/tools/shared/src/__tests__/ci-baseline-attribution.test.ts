/**
 * Tests for classifyCiChecks — the pure CI baseline attribution function.
 *
 * This function is the shared attribution gate used by get_ci_baseline and
 * get_pr_investigation to separate pre-existing main failures from
 * PR-introduced failures and action_required gates.
 */

import { describe, it, expect } from "vitest";
import { classifyCiChecks, buildCiGuidance, fetchMainFailingCheckNames } from "../factory-tools.js";
import type { CiCheck, CiAttributionResult } from "../factory-tools.js";

const makeCheck = (
  name: string,
  state: string,
  conclusion: string,
  link = "https://example.com"
): CiCheck => ({ name, state, conclusion, link });

// ── action_required classification ──────────────────────────────────────────

describe("classifyCiChecks — action_required", () => {
  it("classifies a check with state ACTION_REQUIRED as action_required", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "ACTION_REQUIRED", "")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("action_required");
    expect(results[0].name).toBe("PR - Validation");
  });

  it("classifies action_required checks even when the same name is failing on main", () => {
    const results = classifyCiChecks(
      [makeCheck("Validate - Semgrep", "ACTION_REQUIRED", "")],
      new Set(["Validate - Semgrep"])
    );
    expect(results[0].classification).toBe("action_required");
  });

  it("classifies multiple action_required checks independently", () => {
    const prChecks: CiCheck[] = [
      makeCheck("PR - Validation", "ACTION_REQUIRED", ""),
      makeCheck("PR - Enrichment", "ACTION_REQUIRED", ""),
      makeCheck("PR - OSV Dependency Scan", "ACTION_REQUIRED", ""),
    ];
    const results = classifyCiChecks(prChecks, new Set());
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.classification === "action_required")).toBe(true);
  });
});

describe("classifyCiChecks — cancelled", () => {
  it("classifies a check with cancelled conclusion as cancelled", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "cancelled")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("cancelled");
  });

  it("classifies a cancelled check separately from pre-existing failures on main", () => {
    const results = classifyCiChecks(
      [makeCheck("Validate - Semgrep", "COMPLETED", "cancelled")],
      new Set(["Validate - Semgrep"])
    );
    expect(results[0].classification).toBe("cancelled");
  });
});

// ── pre_existing_on_main classification ──────────────────────────────────────

describe("classifyCiChecks — pre_existing_on_main", () => {
  it("classifies a failing check as pre_existing when the same name is failing on main", () => {
    const results = classifyCiChecks(
      [makeCheck("Validate - Semgrep", "COMPLETED", "FAILURE")],
      new Set(["Validate - Semgrep"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pre_existing_on_main");
  });

  it("classifies a job-level check as pre_existing when its parent workflow is failing on main", () => {
    // "Validate - Semgrep / lint" is a job inside "Validate - Semgrep" workflow
    const results = classifyCiChecks(
      [makeCheck("Validate - Semgrep / lint", "COMPLETED", "FAILURE")],
      new Set(["Validate - Semgrep"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pre_existing_on_main");
  });

  it("does NOT classify as pre_existing when check name only partially matches (not a / separator)", () => {
    const results = classifyCiChecks(
      [makeCheck("Validate - Semgrep-extended", "COMPLETED", "FAILURE")],
      new Set(["Validate - Semgrep"])
    );
    expect(results[0].classification).toBe("pr_introduced");
  });

  it("classifies multiple pre-existing checks correctly", () => {
    const prChecks: CiCheck[] = [
      makeCheck("Validate - Semgrep", "COMPLETED", "FAILURE"),
      makeCheck("CICD - Build Images", "COMPLETED", "FAILURE"),
    ];
    const results = classifyCiChecks(
      prChecks,
      new Set(["Validate - Semgrep", "CICD - Build Images"])
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.classification === "pre_existing_on_main")).toBe(true);
  });
});

// ── pr_introduced classification ─────────────────────────────────────────────

describe("classifyCiChecks — pr_introduced", () => {
  it("classifies a failing check as pr_introduced when not on main", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "FAILURE")],
      new Set(["Validate - Semgrep"])
    );
    expect(results[0].classification).toBe("pr_introduced");
  });

  it("classifies a failing check as pr_introduced when main has no failures", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "failure")],
      new Set()
    );
    expect(results[0].classification).toBe("pr_introduced");
  });

  it("handles lowercase 'failure' conclusion as a real failure", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "failure")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pr_introduced");
  });

  it("handles FAILURE state (not just conclusion) as a real failure", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "FAILURE", "")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pr_introduced");
  });
});

// ── mixed scenario ────────────────────────────────────────────────────────────

describe("classifyCiChecks — mixed scenario", () => {
  it("correctly separates all three buckets in a real-world-like scenario", () => {
    const prChecks: CiCheck[] = [
      // Same-repo action_required gates
      makeCheck("PR - Validation", "ACTION_REQUIRED", ""),
      makeCheck("Validate - Semgrep", "ACTION_REQUIRED", ""),
      makeCheck("CICD - Build Images", "ACTION_REQUIRED", ""),
      // Pre-existing main failures (these happen to also be action_required above)
      // Simulate a different run that was a real failure pre-existing on main
      makeCheck("Validate - Semgrep", "COMPLETED", "FAILURE"),
      makeCheck("CICD - Build Images", "COMPLETED", "FAILURE"),
      // PR-introduced
      makeCheck("PR - Validation", "COMPLETED", "FAILURE"),
    ];
    const mainFailing = new Set(["Validate - Semgrep", "CICD - Build Images"]);
    const results = classifyCiChecks(prChecks, mainFailing);

    const actionRequired = results.filter((r) => r.classification === "action_required");
    const preExisting = results.filter((r) => r.classification === "pre_existing_on_main");
    const prIntroduced = results.filter((r) => r.classification === "pr_introduced");

    expect(actionRequired).toHaveLength(3);
    expect(preExisting).toHaveLength(2);
    expect(prIntroduced).toHaveLength(1);
    expect(prIntroduced[0].name).toBe("PR - Validation");
  });

  it("returns empty array when all checks are passing", () => {
    const prChecks: CiCheck[] = [
      makeCheck("PR - Validation", "COMPLETED", "SUCCESS"),
      makeCheck("Validate - Semgrep", "COMPLETED", "success"),
    ];
    const results = classifyCiChecks(prChecks, new Set());
    expect(results).toHaveLength(0);
  });

  it("preserves the link field in results", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "FAILURE", "https://github.com/runs/123")],
      new Set()
    );
    expect(results[0].link).toBe("https://github.com/runs/123");
  });
});

// ── guidance string (derived from classifyCiChecks output) ───────────────────

describe("classifyCiChecks — guidance derivation", () => {
  it("no pr_introduced means no Copilot nudge is needed", () => {
    const results = classifyCiChecks(
      [makeCheck("Validate - Semgrep", "COMPLETED", "FAILURE")],
      new Set(["Validate - Semgrep"])
    );
    const prIntroduced = results.filter((r) => r.classification === "pr_introduced");
    expect(prIntroduced).toHaveLength(0);
    // Callers use prIntroduced.length === 0 to suppress nudges
  });

  it("pr_introduced present means Copilot nudge is warranted", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "FAILURE")],
      new Set()
    );
    const prIntroduced = results.filter((r) => r.classification === "pr_introduced");
    expect(prIntroduced.length).toBeGreaterThan(0);
  });
});

// ── buildCiGuidance ───────────────────────────────────────────────────────────

describe("buildCiGuidance", () => {
  it("returns no-nudge message when no pr_introduced failures", () => {
    const guidance = buildCiGuidance([]);
    expect(guidance).toMatch(/Do not ask Copilot/);
  });

  it("returns nudge message naming each pr_introduced failure", () => {
    const failures: CiAttributionResult[] = [
      { name: "PR - Validation", classification: "pr_introduced" },
      { name: "PR - Enrichment", classification: "pr_introduced" },
    ];
    const guidance = buildCiGuidance(failures);
    expect(guidance).toContain("2 PR-introduced failure(s)");
    expect(guidance).toContain("PR - Validation");
    expect(guidance).toContain("PR - Enrichment");
  });

  it("includes pre-existing main failures in guidance when passed via options", () => {
    const preExisting: CiAttributionResult[] = [
      { name: "Validate - Semgrep", classification: "pre_existing_on_main" },
    ];
    const guidance = buildCiGuidance([], { preExistingOnMain: preExisting });
    expect(guidance).toMatch(/Do not ask Copilot/);
    expect(guidance).toContain("1 pre-existing failure(s) on main");
    expect(guidance).toContain("Validate - Semgrep");
    expect(guidance).toContain("do not ask Copilot to fix");
  });

  it("includes action_required guidance when passed via options", () => {
    const actionRequired: CiAttributionResult[] = [
      { name: "PR - Validation", classification: "action_required" },
      { name: "CICD - Build Images", classification: "action_required" },
    ];
    const guidance = buildCiGuidance([], { actionRequired });
    expect(guidance).toContain("2 action_required gate(s)");
    expect(guidance).toContain("PR - Validation");
    expect(guidance).toContain("CICD - Build Images");
    expect(guidance).toContain("trusted rerun");
  });

  it("includes cancelled check guidance when passed via options", () => {
    const cancelled: CiAttributionResult[] = [
      { name: "PR - OSV Dependency Scan", classification: "cancelled" },
    ];
    const guidance = buildCiGuidance([], { cancelled });
    expect(guidance).toContain("1 cancelled check(s)");
    expect(guidance).toContain("PR - OSV Dependency Scan");
    expect(guidance).toContain("rerun before evaluating");
  });

  it("combines all four buckets in a single guidance string", () => {
    const prIntroduced: CiAttributionResult[] = [
      { name: "PR - Validation", classification: "pr_introduced" },
    ];
    const preExisting: CiAttributionResult[] = [
      { name: "Validate - Semgrep", classification: "pre_existing_on_main" },
    ];
    const actionRequired: CiAttributionResult[] = [
      { name: "CICD - Build Images", classification: "action_required" },
    ];
    const cancelled: CiAttributionResult[] = [
      { name: "PR - Enrichment", classification: "cancelled" },
    ];
    const guidance = buildCiGuidance(prIntroduced, { preExistingOnMain: preExisting, actionRequired, cancelled });
    expect(guidance).toContain("1 PR-introduced failure(s)");
    expect(guidance).toContain("1 pre-existing failure(s) on main");
    expect(guidance).toContain("1 action_required gate(s)");
    expect(guidance).toContain("1 cancelled check(s)");
  });

  it("omits optional sections when they are empty arrays", () => {
    const guidance = buildCiGuidance([], { preExistingOnMain: [], actionRequired: [], cancelled: [] });
    expect(guidance).toBe("No PR-introduced CI failures. Do not ask Copilot to fix CI on this branch.");
  });
});

// ── fetchMainFailingCheckNames ────────────────────────────────────────────────

describe("fetchMainFailingCheckNames", () => {
  it("returns failing run names from a successful gh response", () => {
    const mockGh = () =>
      JSON.stringify([
        { name: "Validate - Semgrep", conclusion: "failure" },
        { name: "CICD - Build Images", conclusion: "FAILURE" },
        { name: "PR - Validation", conclusion: "success" },
      ]);
    const { names, warning } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.has("Validate - Semgrep")).toBe(true);
    expect(names.has("CICD - Build Images")).toBe(true);
    expect(names.has("PR - Validation")).toBe(false);
    expect(warning).toBeUndefined();
  });

  it("returns empty set and a warning when gh call throws", () => {
    const mockGh = (): string => { throw new Error("API error"); };
    const { names, warning } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.size).toBe(0);
    expect(warning).toMatch(/main.*incomplete/i);
  });

  it("ignores runs with non-failure conclusions", () => {
    const mockGh = () =>
      JSON.stringify([
        { name: "PR - Validation", conclusion: "cancelled" },
        { name: "PR - Enrichment", conclusion: "skipped" },
        { name: "Validate - Semgrep", conclusion: "success" },
      ]);
    const { names } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.size).toBe(0);
  });

  it("counts timed_out runs as baseline failures so PRs are not nudged to fix timeouts", () => {
    const mockGh = () =>
      JSON.stringify([
        { name: "CICD - Build Images", conclusion: "timed_out" },
        { name: "Validate - Semgrep", conclusion: "success" },
      ]);
    const { names } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.has("CICD - Build Images")).toBe(true);
    expect(names.has("Validate - Semgrep")).toBe(false);
  });

  it("counts TIMED_OUT (uppercase GraphQL variant) runs as baseline failures", () => {
    const mockGh = () =>
      JSON.stringify([
        { name: "CICD - Build Images", conclusion: "TIMED_OUT" },
        { name: "Validate - Semgrep", conclusion: "success" },
      ]);
    const { names } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.has("CICD - Build Images")).toBe(true);
    expect(names.has("Validate - Semgrep")).toBe(false);
  });

  it("counts startup_failure runs as baseline failures", () => {
    const mockGh = () =>
      JSON.stringify([
        { name: "PR - Validation", conclusion: "startup_failure" },
        { name: "Validate - Semgrep", conclusion: "success" },
      ]);
    const { names } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.has("PR - Validation")).toBe(true);
    expect(names.has("Validate - Semgrep")).toBe(false);
  });

  it("counts STARTUP_FAILURE (uppercase GraphQL variant) runs as baseline failures", () => {
    const mockGh = () =>
      JSON.stringify([
        { name: "PR - Validation", conclusion: "STARTUP_FAILURE" },
        { name: "Validate - Semgrep", conclusion: "success" },
      ]);
    const { names } = fetchMainFailingCheckNames(mockGh, "owner", "repo", "main");
    expect(names.has("PR - Validation")).toBe(true);
    expect(names.has("Validate - Semgrep")).toBe(false);
  });

  it("classifies a timed_out PR check as pre_existing when main also has that run timing out", () => {
    // If CICD - Build Images timed out on main, a PR that also sees it time out
    // should be classified as pre_existing_on_main, not pr_introduced.
    const results = classifyCiChecks(
      [makeCheck("CICD - Build Images", "COMPLETED", "timed_out")],
      new Set(["CICD - Build Images"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pre_existing_on_main");
  });

  it("classifies a TIMED_OUT (uppercase) PR check as pre_existing when main has that run failing", () => {
    const results = classifyCiChecks(
      [makeCheck("CICD - Build Images", "COMPLETED", "TIMED_OUT")],
      new Set(["CICD - Build Images"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pre_existing_on_main");
  });

  it("classifies a TIMED_OUT (uppercase) PR check as pr_introduced when main does not have that run failing", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "TIMED_OUT")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pr_introduced");
  });

  it("classifies a timed_out PR check as pr_introduced when main does not have that run timing out", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "timed_out")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pr_introduced");
  });

  it("classifies a startup_failure PR check as pre_existing when main has that run failing", () => {
    const results = classifyCiChecks(
      [makeCheck("CICD - Build Images", "COMPLETED", "startup_failure")],
      new Set(["CICD - Build Images"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pre_existing_on_main");
  });

  it("classifies a STARTUP_FAILURE (uppercase) PR check as pre_existing when main has that run failing", () => {
    const results = classifyCiChecks(
      [makeCheck("CICD - Build Images", "COMPLETED", "STARTUP_FAILURE")],
      new Set(["CICD - Build Images"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pre_existing_on_main");
  });

  it("classifies a STARTUP_FAILURE (uppercase) PR check as pr_introduced when main does not have that run failing", () => {
    const results = classifyCiChecks(
      [makeCheck("PR - Validation", "COMPLETED", "STARTUP_FAILURE")],
      new Set()
    );
    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe("pr_introduced");
  });
});
