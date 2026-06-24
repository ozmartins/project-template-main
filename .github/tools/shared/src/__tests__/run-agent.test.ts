import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: vi.fn(function () {
    return {};
  }),
  approveAll: vi.fn(() => ({ kind: "approve-once" })),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("../logging.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  writeSummary: vi.fn(),
  attachLogger: vi.fn(),
}));

vi.mock("../factory-config.js", () => ({
  loadFactoryConfig: vi.fn(),
}));

vi.mock("../github-context.js", () => ({
  getGitHubContext: vi.fn(),
}));

import { CopilotClient } from "@github/copilot-sdk";
import { spawnSync } from "node:child_process";
import { loadFactoryConfig } from "../factory-config.js";
import { getGitHubContext } from "../github-context.js";
import { writeSummary } from "../logging.js";
import {
  buildTemplateVars,
  buildRunPrompt,
  buildSessionConfig,
  createCopilotClient,
  evaluateClusterGuardianPreflight,
  evaluateClusterGuardianRuntimePreflight,
  main,
  resolveTimeoutMs,
} from "../run-agent.js";
import { approveAll } from "../permissions.js";

describe("run-agent helpers", () => {
  it("builds run prompt with full system prompt body", () => {
    const systemPrompt = "Line one\nLine two";
    const prompt = buildRunPrompt(
      "project-manager",
      { owner: "<ORG>", repo: "<REPO_NAME>" },
      systemPrompt,
      "2026-01-01T00:00:00.000Z"
    );

    expect(prompt).toContain("You are the **project-manager** agent");
    expect(prompt).toContain("Current time: 2026-01-01T00:00:00.000Z");
    expect(prompt).toContain(systemPrompt);
    expect(prompt).toContain("Please perform your full standard run now.");
  });

  it("builds createSession config with systemMessage content", () => {
    const systemPrompt = "Agent instructions go here";
    const config = buildSessionConfig("gpt-5.5", systemPrompt);

    expect(config).toEqual({
      model: "gpt-5.5",
      onPermissionRequest: approveAll,
      systemMessage: { content: systemPrompt },
    });
    expect((config as { systemPrompt?: unknown }).systemPrompt).toBeUndefined();
  });

  it("sets session working directory when provided", () => {
    const config = buildSessionConfig("gpt-5.5", "prompt", "/repo/root");
    expect(config.workingDirectory).toBe("/repo/root");
  });

  it("constructs Copilot client with explicit github token", () => {
    createCopilotClient("token-123");
    expect(CopilotClient).toHaveBeenCalledWith({ gitHubToken: "token-123" });
  });
});

describe("resolveTimeoutMs", () => {
  it("prefers the agent frontmatter timeout_minutes", () => {
    const ms = resolveTimeoutMs(
      { timeout_minutes: 15 },
      { factory: { agent_timeout_minutes: 10 } }
    );
    expect(ms).toBe(15 * 60 * 1000);
  });

  it("falls back to the factory config default", () => {
    const ms = resolveTimeoutMs({}, { factory: { agent_timeout_minutes: 10 } });
    expect(ms).toBe(10 * 60 * 1000);
  });

  it("falls back to the built-in default when neither is set", () => {
    const ms = resolveTimeoutMs({}, { factory: {} });
    expect(ms).toBe(10 * 60 * 1000);
  });
});

describe("main preflight flow", () => {
  it("exits cluster-guardian on github-hosted-mvp before probing kubectl", async () => {
    const originalArgv = process.argv;
    const originalEnv = process.env;
    const exitError = new Error("process.exit");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw code === 0 ? exitError : new Error(`unexpected exit code: ${code}`);
      }) as never);

    process.argv = ["node", "run-agent.ts", "--agent", "cluster-guardian"];
    process.env = {
      ...originalEnv,
      COPILOT_GITHUB_TOKEN: "test-token",
      GITHUB_REPOSITORY: "Volaris-AI/project-template",
      GITHUB_RUN_ID: "123",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_WORKSPACE: "/tmp/workspace",
    };

    vi.mocked(getGitHubContext).mockReturnValue({
      owner: "Volaris-AI",
      repo: "project-template",
      runId: "123",
      serverUrl: "https://github.com",
      workspace: "/tmp/workspace",
      runUrl: "https://github.com/Volaris-AI/project-template/actions/runs/123",
    });
    vi.mocked(loadFactoryConfig).mockReturnValue({
      repository: { default_branch: "main" },
      factory: { max_open_copilot_prs: 3, active_runner_profile: "github-hosted-mvp" },
      stack: { deployment_profiles: ["kubernetes-app"] },
    });

    try {
      await expect(main()).rejects.toBe(exitError);
    } finally {
      exitSpy.mockRestore();
      process.argv = originalArgv;
      process.env = originalEnv;
    }

    expect(spawnSync).not.toHaveBeenCalled();
    expect(writeSummary).toHaveBeenCalledWith(
      expect.stringContaining("## ⏭️ Agent skipped: cluster-guardian")
    );
  });
});

describe("buildTemplateVars", () => {
  it("includes default_branch for agent prompt interpolation", () => {
    const vars = buildTemplateVars(
      {
        owner: "<ORG>",
        repo: "<REPO_NAME>",
        runUrl: "https://github.com/<ORG>/<REPO_NAME>/actions/runs/1",
      },
      {
        repository: { default_branch: "main" },
        factory: { max_open_copilot_prs: 3 },
      }
    );

    expect(vars).toMatchObject({
      owner: "<ORG>",
      repo: "<REPO_NAME>",
      run_url: "https://github.com/<ORG>/<REPO_NAME>/actions/runs/1",
      max_open_copilot_prs: 3,
      default_branch: "main",
    });
  });

  describe("evaluateClusterGuardianRuntimePreflight", () => {
    const base = {
      agentName: "cluster-guardian",
      activeRunnerProfile: "factory-cluster-guardian",
      deploymentProfiles: ["kubernetes-app"],
      kubeconfig: "/tmp/kubeconfig",
      kubeDirExists: true,
    };

    it("does not probe kubectl for non cluster-guardian agents", () => {
      const detectContext = vi.fn(() => ({ error: "should not run" }));
      const result = evaluateClusterGuardianRuntimePreflight(
        {
          ...base,
          agentName: "qa-manager",
        },
        detectContext
      );

      expect(result).toEqual({ skip: false });
      expect(detectContext).not.toHaveBeenCalled();
    });

    it("does not probe kubectl when cheap preflight already skips", () => {
      const detectContext = vi.fn(() => ({ error: "should not run" }));
      const result = evaluateClusterGuardianRuntimePreflight(
        {
          ...base,
          activeRunnerProfile: "github-hosted-mvp",
        },
        detectContext
      );

      expect(result).toEqual({
        skip: true,
        reason:
          "factory.active_runner_profile is `github-hosted-mvp`; cluster guardian requires a live Kubernetes runner context.",
      });
      expect(detectContext).not.toHaveBeenCalled();
    });

    it("probes kubectl only after cheap preflight passes", () => {
      const detectContext = vi.fn(() => ({ error: "error: current-context is not set" }));
      const result = evaluateClusterGuardianRuntimePreflight(base, detectContext);

      expect(detectContext).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        skip: true,
        reason: "kubectl context preflight failed: error: current-context is not set",
      });
    });
  });

  describe("evaluateClusterGuardianPreflight", () => {
    const base = {
      agentName: "cluster-guardian",
      activeRunnerProfile: "factory-cluster-guardian",
      deploymentProfiles: ["kubernetes-app"],
      kubeDirExists: true,
    };

    it("skips on github-hosted mvp profile", () => {
      const result = evaluateClusterGuardianPreflight({
        ...base,
        activeRunnerProfile: "github-hosted-mvp",
      });

      expect(result).toEqual({
        skip: true,
        reason:
          "factory.active_runner_profile is `github-hosted-mvp`; cluster guardian requires a live Kubernetes runner context.",
      });
    });

    it("skips when kubeconfig and ~/.kube are both unavailable", () => {
      const result = evaluateClusterGuardianPreflight({
        ...base,
        kubeDirExists: false,
      });

      expect(result).toEqual({
        skip: true,
        reason: "No kubeconfig available (`KUBECONFIG` is unset and `~/.kube` is missing).",
      });
    });

    it("skips when kubectl reports no current context", () => {
      const result = evaluateClusterGuardianPreflight({
        ...base,
        kubectlContextError: "error: current-context is not set",
      });

      expect(result).toEqual({
        skip: true,
        reason: "kubectl context preflight failed: error: current-context is not set",
      });
    });

    it("skips when kubernetes-app deployment profile is not active", () => {
      const result = evaluateClusterGuardianPreflight({
        ...base,
        deploymentProfiles: ["local-compose"],
      });

      expect(result).toEqual({
        skip: true,
        reason: "stack.deployment_profiles does not include `kubernetes-app`.",
      });
    });

    it("does not skip for non cluster-guardian agents", () => {
      const result = evaluateClusterGuardianPreflight({
        ...base,
        agentName: "qa-manager",
        kubeDirExists: false,
        kubeconfig: "",
        activeRunnerProfile: "github-hosted-mvp",
      });

      expect(result).toEqual({ skip: false });
    });
  });
});
