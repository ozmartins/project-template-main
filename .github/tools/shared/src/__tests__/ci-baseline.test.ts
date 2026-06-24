import { describe, it, expect } from "vitest";
import { attributeCiFailures, isCancelledConclusion, isFailureConclusion } from "../ci-baseline.js";

const FAILING_ON_MAIN = [
  { name: "Validate - Semgrep", conclusion: "failure", databaseId: 28039343996 },
  { name: "Validate - Semgrep", conclusion: "failure", databaseId: 28039337780 },
  { name: "CICD - Build Images", conclusion: "failure", databaseId: 28038855972 },
  { name: "PR - Validation", conclusion: "success", databaseId: 28038000001 },
];

describe("attributeCiFailures", () => {
  it("marks a check as pre_existing_on_main when main has a matching failure", () => {
    const result = attributeCiFailures(
      ["Validate - Semgrep"],
      [],
      FAILING_ON_MAIN,
      "main"
    );
    expect(result.attribution["Validate - Semgrep"]?.pre_existing_on_main).toBe(true);
    expect(result.attribution["Validate - Semgrep"]?.main_failure_run_ids).toContain(28039343996);
    expect(result.attribution["Validate - Semgrep"]?.is_action_required).toBe(false);
  });

  it("marks a job-level check as pre_existing_on_main when main has a failing parent workflow", () => {
    const result = attributeCiFailures(
      ["Validate - Semgrep / lint"],
      [],
      FAILING_ON_MAIN,
      "main"
    );
    expect(result.attribution["Validate - Semgrep / lint"]?.pre_existing_on_main).toBe(true);
    expect(result.attribution["Validate - Semgrep / lint"]?.main_failure_run_ids).toContain(28039343996);
  });

  it("marks a check as NOT pre_existing_on_main when main has no matching failure", () => {
    const result = attributeCiFailures(
      ["PR - Validation"],
      [],
      FAILING_ON_MAIN,
      "main"
    );
    expect(result.attribution["PR - Validation"]?.pre_existing_on_main).toBe(false);
    expect(result.attribution["PR - Validation"]?.main_failure_run_ids).toEqual([]);
    expect(result.attribution["PR - Validation"]?.is_action_required).toBe(false);
  });

  it("marks action_required checks separately from code failures", () => {
    const result = attributeCiFailures(
      [],
      ["PR - Validation", "PR - Enrichment"],
      FAILING_ON_MAIN,
      "main"
    );
    expect(result.attribution["PR - Validation"]?.is_action_required).toBe(true);
    expect(result.attribution["PR - Validation"]?.pre_existing_on_main).toBe(false);
    expect(result.attribution["PR - Enrichment"]?.is_action_required).toBe(true);
    expect(result.attribution["PR - Validation"]?.is_cancelled).toBe(false);
  });

  it("marks cancelled checks separately from code failures", () => {
    const result = attributeCiFailures(
      [],
      [],
      FAILING_ON_MAIN,
      "main",
      ["PR - Validation", "PR - Enrichment"]
    );
    expect(result.attribution["PR - Validation"]?.is_cancelled).toBe(true);
    expect(result.attribution["PR - Validation"]?.is_action_required).toBe(false);
    expect(result.attribution["PR - Enrichment"]?.is_cancelled).toBe(true);
  });

  it("handles a check that appears in both failing and action_required", () => {
    // A check can be simultaneously listed as failing AND action_required
    // (e.g. a re-triggered run stuck at action_required)
    const result = attributeCiFailures(
      ["PR - Validation"],
      ["PR - Validation"],
      FAILING_ON_MAIN,
      "main"
    );
    expect(result.attribution["PR - Validation"]?.is_action_required).toBe(true);
    // PR - Validation has a successful run on main, so not pre-existing
    expect(result.attribution["PR - Validation"]?.pre_existing_on_main).toBe(false);
  });

  it("produces accurate summary counts", () => {
    const result = attributeCiFailures(
      ["Validate - Semgrep", "PR - Validation", "My New Check"],
      ["PR - OSV Dependency Scan"],
      FAILING_ON_MAIN,
      "main"
    );
    // Semgrep: pre_existing_on_main
    // PR - Validation: pr-introduced (success on main, failing on PR)
    // My New Check: pr-introduced (no matching main run)
    // PR - OSV Dependency Scan: action_required only
    expect(result.summary.total_checks).toBe(4);
    expect(result.summary.pre_existing_on_main).toBe(1);
    expect(result.summary.action_required_count).toBe(1);
    expect(result.summary.cancelled_count).toBe(0);
    expect(result.summary.pr_introduced_failures).toBe(2);
  });

  it("returns the correct baseline_branch", () => {
    const result = attributeCiFailures([], [], [], "main");
    expect(result.baseline_branch).toBe("main");
  });

  it("treats timed_out runs as failures for baseline attribution", () => {
    const timedOutRun = [
      { name: "CICD - Build Images", conclusion: "timed_out", databaseId: 99999 },
    ];
    const result = attributeCiFailures(["CICD - Build Images"], [], timedOutRun, "main");
    expect(result.attribution["CICD - Build Images"]?.pre_existing_on_main).toBe(true);
    expect(result.attribution["CICD - Build Images"]?.main_failure_run_ids).toContain(99999);
  });

  it("returns empty attribution and zero summary when no checks provided", () => {
    const result = attributeCiFailures([], [], FAILING_ON_MAIN, "main");
    expect(result.attribution).toEqual({});
    expect(result.summary.total_checks).toBe(0);
    expect(result.summary.pre_existing_on_main).toBe(0);
    expect(result.summary.action_required_count).toBe(0);
    expect(result.summary.cancelled_count).toBe(0);
    expect(result.summary.pr_introduced_failures).toBe(0);
  });
});

describe("isFailureConclusion", () => {
  it("returns true for failure and FAILURE", () => {
    expect(isFailureConclusion("failure")).toBe(true);
    expect(isFailureConclusion("FAILURE")).toBe(true);
  });

  it("returns true for timed_out and TIMED_OUT", () => {
    expect(isFailureConclusion("timed_out")).toBe(true);
    expect(isFailureConclusion("TIMED_OUT")).toBe(true);
  });

  it("returns true for startup_failure and STARTUP_FAILURE", () => {
    expect(isFailureConclusion("startup_failure")).toBe(true);
    expect(isFailureConclusion("STARTUP_FAILURE")).toBe(true);
  });

  it("returns false for success, skipped, cancelled", () => {
    expect(isFailureConclusion("success")).toBe(false);
    expect(isFailureConclusion("skipped")).toBe(false);
    expect(isFailureConclusion("cancelled")).toBe(false);
  });
});

describe("isCancelledConclusion", () => {
  it("returns true for cancelled and CANCELLED", () => {
    expect(isCancelledConclusion("cancelled")).toBe(true);
    expect(isCancelledConclusion("CANCELLED")).toBe(true);
  });

  it("returns false for failure and success", () => {
    expect(isCancelledConclusion("failure")).toBe(false);
    expect(isCancelledConclusion("success")).toBe(false);
  });
});
