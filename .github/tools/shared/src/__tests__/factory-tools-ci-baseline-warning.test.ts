import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { factoryTools } from "../factory-tools.js";

const ctx = {
  owner: "octo-org",
  repo: "octo-repo",
};

// ── get_ci_baseline_attribution ───────────────────────────────────────────────
// ADR-0112: this tool returns the raw CiBaselineResult from attributeCiFailures,
// giving agents the per-check attribution map and summary breakdown.

describe("factoryTools get_ci_baseline_attribution", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("returns pre_existing_on_main attribution for checks already failing on main (#1033)", async () => {
    // Validates the core ADR-0112 contract: the tool must separate pre-existing
    // main failures (Semgrep, Build Images) from pr-introduced failures so agents
    // never ask Copilot to fix a baseline defect.
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 500")) {
        return JSON.stringify([
          { name: "Validate - Semgrep", state: "COMPLETED", conclusion: "failure", link: "https://example.com/semgrep" },
          { name: "PR - Validation", state: "COMPLETED", conclusion: "failure", link: "https://example.com/prv" },
        ]);
      }
      if (cmd.includes("pr view 500")) return "feature-branch\n";
      if (cmd.includes("run list") && cmd.includes("--branch feature-branch") && cmd.includes("--status action_required")) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return JSON.stringify([
          { name: "Validate - Semgrep", conclusion: "failure", databaseId: 28039343996 },
          { name: "Validate - Semgrep", conclusion: "failure", databaseId: 28039337780 },
          { name: "PR - Validation", conclusion: "success", databaseId: 28038000001 },
        ]);
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaselineAttribution = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline_attribution") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaselineAttribution.handler({ pr_number: 500 });

    // Baseline branch is recorded
    expect(result.baseline_branch).toBe("main");

    // Validate - Semgrep is pre-existing on main — should NOT generate a branch-fix nudge
    const attribution = result.attribution as Record<string, { pre_existing_on_main: boolean; main_failure_run_ids: number[]; is_action_required: boolean; is_cancelled: boolean }>;
    expect(attribution["Validate - Semgrep"]?.pre_existing_on_main).toBe(true);
    expect(attribution["Validate - Semgrep"]?.main_failure_run_ids).toContain(28039343996);
    expect(attribution["Validate - Semgrep"]?.is_action_required).toBe(false);

    // PR - Validation is NOT pre-existing on main — may need a Copilot nudge
    expect(attribution["PR - Validation"]?.pre_existing_on_main).toBe(false);
    expect(attribution["PR - Validation"]?.main_failure_run_ids).toEqual([]);

    // Summary breakdown
    const summary = result.summary as { total_checks: number; pre_existing_on_main: number; action_required_count: number; cancelled_count: number; pr_introduced_failures: number };
    expect(summary.total_checks).toBe(2);
    expect(summary.pre_existing_on_main).toBe(1);
    expect(summary.action_required_count).toBe(0);
    expect(summary.cancelled_count).toBe(0);
    expect(summary.pr_introduced_failures).toBe(1);
  });

  it("classifies action_required checks separately from code failures", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 500")) {
        return JSON.stringify([
          { name: "PR - Enrichment", state: "ACTION_REQUIRED", conclusion: "", link: "https://example.com/enrich" },
        ]);
      }
      if (cmd.includes("pr view 500")) return "feature-branch\n";
      if (cmd.includes("run list") && cmd.includes("--branch feature-branch") && cmd.includes("--status action_required")) {
        return JSON.stringify([{ name: "PR - Enrichment" }]);
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) return "[]";
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaselineAttribution = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline_attribution") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaselineAttribution.handler({ pr_number: 500 });

    const attribution = result.attribution as Record<string, { is_action_required: boolean; pre_existing_on_main: boolean; is_cancelled: boolean }>;
    expect(attribution["PR - Enrichment"]?.is_action_required).toBe(true);
    expect(attribution["PR - Enrichment"]?.pre_existing_on_main).toBe(false);
    expect(attribution["PR - Enrichment"]?.is_cancelled).toBe(false);
    const summary = result.summary as { action_required_count: number; pr_introduced_failures: number };
    expect(summary.action_required_count).toBe(1);
    expect(summary.pr_introduced_failures).toBe(0);
  });

  it("returns structured error when pr checks fetch fails", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 999")) throw new Error("PR not found");
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaselineAttribution = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline_attribution") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaselineAttribution.handler({ pr_number: 999 });

    expect(result.error).toMatch(/Could not fetch PR #999/);
  });

  it("surfaces warnings when main baseline fetch fails but returns partial attribution", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 500")) {
        return JSON.stringify([
          { name: "PR - Validation", state: "COMPLETED", conclusion: "failure", link: "https://example.com/prv" },
        ]);
      }
      if (cmd.includes("pr view 500")) return "feature-branch\n";
      if (cmd.includes("run list") && cmd.includes("--branch feature-branch") && cmd.includes("--status action_required")) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) throw new Error("main unavailable");
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaselineAttribution = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline_attribution") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaselineAttribution.handler({ pr_number: 500 });

    // Partial result is still returned — attribution defaults to pr_introduced (conservative)
    const attribution = result.attribution as Record<string, { pre_existing_on_main: boolean }>;
    expect(attribution["PR - Validation"]?.pre_existing_on_main).toBe(false);
    // Warnings field explains the incomplete baseline
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/main.*incomplete/i)])
    );
  });
});

// ── get_ci_baseline error path ────────────────────────────────────────────────

describe("factoryTools get_ci_baseline error handling", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("returns structured error when pr checks fetch itself fails", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 888")) throw new Error("network timeout");
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 888 });

    expect(result.error).toMatch(/Could not fetch PR checks/);
  });
});

// ── factoryTools CI baseline warnings ────────────────────────────────────────

describe("factoryTools CI baseline warnings", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("surfaces explicit warning when default-branch baseline runs cannot be fetched", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "PR - Validation",
            state: "COMPLETED",
            conclusion: "failure",
            link: "https://example.com/check",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        throw new Error("main baseline unavailable");
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    expect(result.pr_introduced).toEqual([{ name: "PR - Validation", classification: "pr_introduced", link: "https://example.com/check" }]);
    expect(result.warnings).toEqual([
      "Could not fetch main branch runs — pre_existing_on_main classification may be incomplete",
    ]);
  });

  it("classifies job-level PR checks as pre-existing when main has the failing parent workflow", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "Validate - Semgrep / lint",
            state: "COMPLETED",
            conclusion: "failure",
            link: "https://example.com/check",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return JSON.stringify([
          {
            name: "Validate - Semgrep",
            conclusion: "failure",
            databaseId: 424242,
          },
        ]);
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    expect(result.pre_existing_on_main).toEqual([
      { name: "Validate - Semgrep / lint", classification: "pre_existing_on_main", link: "https://example.com/check" },
    ]);
    expect(result.pr_introduced).toEqual([]);
    // guidance should mention pre-existing failures and direct agents not to request code changes
    expect(result.guidance).toContain("Do not ask Copilot");
    expect(result.guidance).toContain("pre-existing failure(s) on main");
  });

  it("includes action_required and cancelled guidance in the returned guidance string", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "PR - Validation",
            state: "ACTION_REQUIRED",
            conclusion: "",
            link: "https://example.com/ar-check",
          },
          {
            name: "PR - OSV Dependency Scan",
            state: "COMPLETED",
            conclusion: "cancelled",
            link: "https://example.com/cancelled-check",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return JSON.stringify([{ name: "PR - Validation" }]);
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return "[]";
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    expect(result.action_required).toEqual([
      { name: "PR - Validation", classification: "action_required", link: "https://example.com/ar-check" },
    ]);
    expect(result.cancelled).toEqual([
      { name: "PR - OSV Dependency Scan", classification: "cancelled", link: "https://example.com/cancelled-check" },
    ]);
    expect(result.pr_introduced).toEqual([]);
    // guidance must mention both action_required and cancelled — agents should see
    // the full picture in one field without inspecting every bucket separately
    expect(result.guidance).toContain("action_required gate(s)");
    expect(result.guidance).toContain("cancelled check(s)");
    expect(result.guidance).toContain("Do not ask Copilot");
  });

  it("correctly separates pre-existing and pr-introduced failures in a combined real-world scenario", async () => {
    // Semgrep and Build Images are failing on main — should be pre_existing_on_main.
    // PR - Validation is failing on the PR but not on main — should be pr_introduced.
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "Validate - Semgrep",
            state: "COMPLETED",
            conclusion: "FAILURE",
            link: "https://example.com/semgrep",
          },
          {
            name: "CICD - Build Images",
            state: "COMPLETED",
            conclusion: "failure",
            link: "https://example.com/build",
          },
          {
            name: "PR - Validation",
            state: "COMPLETED",
            conclusion: "failure",
            link: "https://example.com/pr-validation",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return JSON.stringify([
          { name: "Validate - Semgrep", conclusion: "failure", databaseId: 28039343996 },
          { name: "Validate - Semgrep", conclusion: "failure", databaseId: 28039337780 },
          { name: "CICD - Build Images", conclusion: "failure", databaseId: 28038855972 },
          { name: "PR - Validation", conclusion: "success", databaseId: 28038000001 },
        ]);
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    // Semgrep and Build Images are pre-existing on main — do NOT ask Copilot to fix
    expect(result.pre_existing_on_main).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Validate - Semgrep", classification: "pre_existing_on_main" }),
        expect.objectContaining({ name: "CICD - Build Images", classification: "pre_existing_on_main" }),
      ])
    );
    // PR - Validation is a genuine PR-introduced failure
    expect(result.pr_introduced).toEqual([
      { name: "PR - Validation", classification: "pr_introduced", link: "https://example.com/pr-validation" },
    ]);
    expect(result.action_required).toEqual([]);
    expect(result.cancelled).toEqual([]);

    // Guidance must surface both buckets so agents don't ask Copilot to fix pre-existing failures
    expect(result.guidance).toContain("1 PR-introduced failure(s)");
    expect(result.guidance).toContain("PR - Validation");
    expect(result.guidance).toContain("2 pre-existing failure(s) on main");
    expect(result.guidance).toContain("Validate - Semgrep");
    expect(result.guidance).toContain("CICD - Build Images");
    expect(result.guidance).toContain("do not ask Copilot to fix");
  });

  it("classifies TIMED_OUT PR checks as pre_existing when main has the same run timing out", async () => {
    // CICD - Build Images times out on main (TIMED_OUT uppercase) — pre_existing_on_main.
    // PR - Validation fails genuinely — pr_introduced.
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "CICD - Build Images",
            state: "COMPLETED",
            conclusion: "TIMED_OUT",
            link: "https://example.com/build",
          },
          {
            name: "PR - Validation",
            state: "COMPLETED",
            conclusion: "FAILURE",
            link: "https://example.com/pr-validation",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return JSON.stringify([
          { name: "CICD - Build Images", conclusion: "TIMED_OUT", databaseId: 11111 },
          { name: "PR - Validation", conclusion: "success", databaseId: 22222 },
        ]);
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    expect(result.pre_existing_on_main).toEqual([
      expect.objectContaining({ name: "CICD - Build Images", classification: "pre_existing_on_main" }),
    ]);
    expect(result.pr_introduced).toEqual([
      { name: "PR - Validation", classification: "pr_introduced", link: "https://example.com/pr-validation" },
    ]);
    // Guidance must mention only 1 PR-introduced failure and suppress Copilot nudge for the timeout
    expect(result.guidance).toContain("1 PR-introduced failure(s)");
    expect(result.guidance).toContain("1 pre-existing failure(s) on main");
    expect(result.guidance).toContain("CICD - Build Images");
    expect(result.guidance).toContain("do not ask Copilot to fix");
  });

  it("classifies STARTUP_FAILURE PR checks as pre_existing when main has the same run failing", async () => {
    // PR - OSV Dependency Scan has a startup_failure on main (STARTUP_FAILURE uppercase) — pre_existing_on_main.
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "PR - OSV Dependency Scan",
            state: "COMPLETED",
            conclusion: "STARTUP_FAILURE",
            link: "https://example.com/osv",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return JSON.stringify([
          { name: "PR - OSV Dependency Scan", conclusion: "STARTUP_FAILURE", databaseId: 33333 },
        ]);
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    expect(result.pre_existing_on_main).toEqual([
      expect.objectContaining({ name: "PR - OSV Dependency Scan", classification: "pre_existing_on_main" }),
    ]);
    expect(result.pr_introduced).toEqual([]);
    // No Copilot nudge since the failure is pre-existing
    expect(result.guidance).not.toContain("PR-introduced failure");
    expect(result.guidance).toContain("1 pre-existing failure(s) on main");
    expect(result.guidance).toContain("do not ask Copilot to fix");
  });

  it("classifies all-cancelled PR checks as cancelled — no code-fix nudge issued (member ticket #1081/#1104 scenario)", async () => {
    // When all latest-head runs are cancelled (concurrency preemption / rapid push),
    // get_ci_baseline must NOT classify them as pr_introduced — no code change is needed.
    // All checks should appear in the `cancelled` bucket so agents rerun first.
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr checks 123")) {
        return JSON.stringify([
          {
            name: "PR - Validation",
            state: "COMPLETED",
            conclusion: "cancelled",
            link: "https://example.com/pr-validation",
          },
          {
            name: "Validate - Semgrep",
            state: "COMPLETED",
            conclusion: "cancelled",
            link: "https://example.com/semgrep",
          },
          {
            name: "CICD - Build Images",
            state: "COMPLETED",
            conclusion: "cancelled",
            link: "https://example.com/build",
          },
        ]);
      }
      if (cmd.includes("pr view 123")) {
        return "feature-branch\n";
      }
      if (
        cmd.includes("run list") &&
        cmd.includes("--branch feature-branch") &&
        cmd.includes("--status action_required")
      ) {
        return "[]";
      }
      if (cmd.includes("run list") && cmd.includes("--branch main")) {
        return JSON.stringify([
          { name: "PR - Validation", conclusion: "success", databaseId: 10001 },
          { name: "Validate - Semgrep", conclusion: "failure", databaseId: 10002 },
          { name: "CICD - Build Images", conclusion: "success", databaseId: 10003 },
        ]);
      }
      throw new Error(`Unexpected gh invocation: ${cmd}`);
    });

    const tools = factoryTools(ctx, "main");
    const getCiBaseline = tools.find((tool: { name?: string }) => tool.name === "get_ci_baseline") as {
      handler: (input: { pr_number: number }) => Promise<Record<string, unknown>>;
    };

    const result = await getCiBaseline.handler({ pr_number: 123 });

    // All three checks are cancelled — none should appear as pr_introduced
    expect(result.pr_introduced).toEqual([]);
    expect(result.pre_existing_on_main).toEqual([]);
    expect(result.action_required).toEqual([]);
    expect((result.cancelled as Array<{ name: string }>).map((c) => c.name)).toEqual(
      expect.arrayContaining(["PR - Validation", "Validate - Semgrep", "CICD - Build Images"])
    );
    // Guidance must NOT ask Copilot to fix CI — all checks are cancellation-only
    expect(result.guidance).toContain("Do not ask Copilot");
    expect(result.guidance).toContain("cancelled check(s)");
    expect(result.guidance).not.toContain("PR-introduced failure");
  });
});
