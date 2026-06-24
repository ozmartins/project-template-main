#!/usr/bin/env node
/**
 * run-agent.ts — entry point for all scheduled SDK agent workflows.
 *
 * Uses @github/copilot-sdk which spawns a Copilot CLI subprocess with
 * built-in tool access (shell, git, file system, web). The agent can
 * execute gh CLI commands directly to manage PRs, issues, and CI.
 *
 * Required env vars:
 *   COPILOT_GITHUB_TOKEN  — Copilot SDK auth token (from secrets.COPILOT_TOKEN)
 *   GH_TOKEN              — GitHub token for gh CLI (from secrets.PROJECT_MANAGER_PAT)
 *   GITHUB_REPOSITORY     — owner/repo
 *   GITHUB_RUN_ID         — current Actions run ID
 *   GITHUB_SERVER_URL     — e.g. https://github.com
 *   GITHUB_WORKSPACE      — repo root on runner
 *   FACTORY_CONFIG_PATH   — path to .github/factory.yml
 *   AGENTS_PATH           — path to .github/agents/
 */

import { CopilotClient } from "@github/copilot-sdk";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAgent, interpolate } from "./agent-loader.js";
import { loadFactoryConfig } from "./factory-config.js";
import { getGitHubContext } from "./github-context.js";
import { approveAll } from "./permissions.js";
import { info, error, writeSummary, attachLogger } from "./logging.js";

const DEFAULT_AGENT_TIMEOUT_MINUTES = 10;
const SUMMARY_TIMEOUT_MS = 3 * 60 * 1000; // Phase 2 summary (non-fatal)
const GITHUB_HOSTED_MVP_PROFILE = "github-hosted-mvp";

type ClusterGuardianPreflight = { skip: false } | { skip: true; reason: string };
type KubectlContextResult = { context?: string; error?: string };

/**
 * Resolve the work-phase timeout (ms) for an agent.
 * Precedence: agent frontmatter `timeout_minutes` > factory.yml
 * `factory.agent_timeout_minutes` > built-in default. Heavy agents
 * (deep PR review, epic decomposition) need more than light triage agents,
 * so a single hardcoded cap was the wrong model.
 */
export function resolveTimeoutMs(
  frontmatter: { timeout_minutes?: number },
  config: { factory: { agent_timeout_minutes?: number } }
): number {
  const minutes =
    frontmatter.timeout_minutes ??
    config.factory.agent_timeout_minutes ??
    DEFAULT_AGENT_TIMEOUT_MINUTES;
  return minutes * 60 * 1000;
}

export function createCopilotClient(token: string): CopilotClient {
  return new CopilotClient({ gitHubToken: token });
}

export function buildSessionConfig(
  model: string | undefined,
  systemPrompt: string,
  workingDirectory?: string
): {
  model: string;
  onPermissionRequest: typeof approveAll;
  systemMessage: { content: string };
  workingDirectory?: string;
} {
  return {
    model: model ?? "gpt-5.5",
    onPermissionRequest: approveAll,
    systemMessage: { content: systemPrompt },
    workingDirectory,
  };
}

export function buildRunPrompt(
  agentName: string,
  ctx: { owner: string; repo: string },
  systemPrompt: string,
  nowIso = new Date().toISOString()
): string {
  return `You are the **${agentName}** agent for ${ctx.owner}/${ctx.repo}. Current time: ${nowIso}.

${systemPrompt}

Please perform your full standard run now.`;
}

export function buildTemplateVars(
  ctx: { owner: string; repo: string; runUrl: string },
  config: { repository: { default_branch: string }; factory: { max_open_copilot_prs: number } }
): Record<string, string | number> {
  return {
    owner: ctx.owner,
    repo: ctx.repo,
    run_url: ctx.runUrl,
    max_open_copilot_prs: config.factory.max_open_copilot_prs,
    default_branch: config.repository.default_branch,
  };
}

function detectKubectlCurrentContext(): KubectlContextResult {
  const result = spawnSync("kubectl", ["config", "current-context"], { encoding: "utf8" });
  if (result.error) return { error: result.error.message };
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  if (result.status !== 0) {
    return { error: stderr || stdout || `kubectl exited with status ${result.status}` };
  }
  return stdout ? { context: stdout } : { error: "kubectl returned an empty current context" };
}

export function evaluateClusterGuardianPreflight(params: {
  agentName: string;
  activeRunnerProfile?: string;
  deploymentProfiles?: string[];
  kubeconfig?: string;
  kubeDirExists: boolean;
  kubectlContextError?: string;
}): ClusterGuardianPreflight {
  if (params.agentName !== "cluster-guardian") return { skip: false };

  if (params.activeRunnerProfile === GITHUB_HOSTED_MVP_PROFILE) {
    return {
      skip: true,
      reason: `factory.active_runner_profile is \`${GITHUB_HOSTED_MVP_PROFILE}\`; cluster guardian requires a live Kubernetes runner context.`,
    };
  }

  if (!params.deploymentProfiles?.includes("kubernetes-app")) {
    return {
      skip: true,
      reason: "stack.deployment_profiles does not include `kubernetes-app`.",
    };
  }

  const hasKubeconfig = (params.kubeconfig?.trim().length ?? 0) > 0;
  if (!hasKubeconfig && !params.kubeDirExists) {
    return {
      skip: true,
      reason: "No kubeconfig available (`KUBECONFIG` is unset and `~/.kube` is missing).",
    };
  }

  if (params.kubectlContextError) {
    return {
      skip: true,
      reason: `kubectl context preflight failed: ${params.kubectlContextError}`,
    };
  }

  return { skip: false };
}

export function evaluateClusterGuardianRuntimePreflight(
  params: {
    agentName: string;
    activeRunnerProfile?: string;
    deploymentProfiles?: string[];
    kubeconfig?: string;
    kubeDirExists: boolean;
  },
  detectContext: () => KubectlContextResult = detectKubectlCurrentContext
): ClusterGuardianPreflight {
  const cheapPreflight = evaluateClusterGuardianPreflight(params);
  if (cheapPreflight.skip || params.agentName !== "cluster-guardian") {
    return cheapPreflight;
  }

  const kubectlContext = detectContext();
  return evaluateClusterGuardianPreflight({
    ...params,
    kubectlContextError: kubectlContext.error,
  });
}

function parseArgs(argv: string[]): { agent: string } {
  const idx = argv.indexOf("--agent");
  if (idx === -1 || !argv[idx + 1]) {
    throw new Error("Usage: run-agent.ts --agent <name>");
  }
  return { agent: argv[idx + 1]! };
}

export async function main(): Promise<void> {
  const token = process.env["COPILOT_GITHUB_TOKEN"];
  if (!token) {
    writeSummary(
      "## ⚠️ Agent skipped\n\n`COPILOT_TOKEN` is not configured.\n\nSet the `COPILOT_TOKEN` repository secret to enable SDK agents."
    );
    info("COPILOT_GITHUB_TOKEN not set — skipping agent run");
    process.exit(0);
  }

  const { agent: agentName } = parseArgs(process.argv.slice(2));
  const ctx = getGitHubContext();

  const configPath =
    process.env["FACTORY_CONFIG_PATH"] ?? join(ctx.workspace, ".github", "factory.yml");
  const agentsPath =
    process.env["AGENTS_PATH"] ?? join(ctx.workspace, ".github", "agents");

  const config = loadFactoryConfig(configPath);
  const preflight = evaluateClusterGuardianRuntimePreflight({
    agentName,
    activeRunnerProfile: config.factory.active_runner_profile,
    deploymentProfiles: config.stack?.deployment_profiles,
    kubeconfig: process.env["KUBECONFIG"],
    kubeDirExists: existsSync(join(homedir(), ".kube")),
  });

  if (preflight.skip) {
    writeSummary(
      `## ⏭️ Agent skipped: ${agentName}\n\n${preflight.reason}\n\nThis run is detection-only and requires kubeconfig/context before cluster discovery can execute.`
    );
    info("Cluster guardian preflight skip", { reason: preflight.reason });
    process.exit(0);
  }

  const { frontmatter, body } = loadAgent(agentsPath, agentName);

  const agentTimeoutMs = resolveTimeoutMs(frontmatter, config);
  info("Starting agent", {
    agent: agentName,
    run: ctx.runUrl,
    timeoutMin: agentTimeoutMs / 60000,
  });

  const vars = buildTemplateVars(ctx, config);

  const systemPrompt = interpolate(body, vars);
  const client = createCopilotClient(token);

  try {
    const session = await client.createSession({
      ...buildSessionConfig(frontmatter.model, systemPrompt, ctx.workspace),
    });

    attachLogger(session);

    // Phase 1: do all the real work
    await session.sendAndWait(
      { prompt: buildRunPrompt(agentName, ctx, systemPrompt) },
      agentTimeoutMs
    );

    // Phase 2: write summary (best-effort; timeout is non-fatal)
    try {
      await session.sendAndWait(
        { prompt: "Write your full run summary to $GITHUB_STEP_SUMMARY. Include every action taken, every PR merged or skipped (with reasons), every issue assigned or skipped. Be specific." },
        SUMMARY_TIMEOUT_MS
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("Timeout")) {
        info("Phase 2 summary timed out — Phase 1 completed", { agent: agentName });
      } else {
        throw e;
      }
    }

    info("Agent run complete", { agent: agentName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error("Agent run failed", { agent: agentName, err: msg });
    writeSummary(`## ❌ Agent failed: ${agentName}\n\n\`\`\`\n${msg}\n\`\`\``);
    process.exit(1);
  } finally {
    await client.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
