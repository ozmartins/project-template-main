#!/usr/bin/env node
/**
 * run-issue-pipeline.ts — the per-issue backlog-review loop.
 *
 * Strategy (mirrors run-pr-pipeline.ts):
 *
 *   1. Fetch every open issue sorted by updatedAt ASC (oldest-stale first).
 *   2. Skip issues updated within the settle window — they are actively changing.
 *   3. Loop one-by-one: a FRESH, focused `backlog-reviewer` agent session per
 *      issue, handed the issue's snapshot, with its own short timeout.
 *   4. Wall-clock budget caps the loop so the workflow step doesn't run
 *      past the GitHub Actions job limit.
 *
 * The key property: oldest issues always go first. If the budget runs out the
 * freshest (least stale) issues are the ones deferred. They will be first-out
 * on the next daily run because their updatedAt is still older than any issue
 * the agent touched.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import { loadAgent, interpolate } from "./agent-loader.js";
import { loadFactoryConfig } from "./factory-config.js";
import { getGitHubContext } from "./github-context.js";
import { fetchIssueSnapshots, type IssueSnapshot } from "./issue-snapshot.js";
import { factoryTools } from "./factory-tools.js";
import {
  createCopilotClient,
  buildSessionConfig,
  buildTemplateVars,
} from "./run-agent.js";
import { attachLogger, info, warn, writeSummary } from "./logging.js";

/** Per-issue work budget (ms). */
const PER_ISSUE_TIMEOUT_MS =
  (Number(process.env["ISSUE_REVIEWER_TIMEOUT_MIN"]) || 8) * 60 * 1000;

/** Overall wall-clock budget for the issue loop. */
const PIPELINE_BUDGET_MS =
  (Number(process.env["ISSUE_PIPELINE_BUDGET_MIN"]) || 300) * 60 * 1000;

/** Issues updated within this many minutes are skipped — they are actively changing. */
const SETTLE_MINUTES =
  Number(process.env["ISSUE_SETTLE_MINUTES"]) || 120;

export type IssueLoopStatus = "ok" | "timeout" | "error";

export interface IssueLoopResult {
  number: number;
  title: string;
  status: IssueLoopStatus;
  detail?: string;
}

/** Filter: skip issues that are too fresh (still being actively updated). */
export function isSettled(issue: IssueSnapshot, nowMs: number): boolean {
  const ageMin = (nowMs - new Date(issue.updatedAt).getTime()) / 60_000;
  return ageMin >= SETTLE_MINUTES;
}

/** Build the per-issue prompt handing the agent ONE issue plus its snapshot. */
export function buildIssuePrompt(issue: IssueSnapshot): string {
  return [
    `Review exactly ONE issue now: #${issue.number} — "${issue.title}" (author: ${issue.author}).`,
    ``,
    `Current state snapshot (authoritative as of moments ago):`,
    "```json",
    JSON.stringify(issue, null, 2),
    "```",
    ``,
    `Apply your decision tree for this single issue, take ONE action (or no action), then stop.`,
    `Use \`gh issue view ${issue.number}\` to read the full body or comments if you need more context.`,
  ].join("\n");
}

/**
 * Pure sequential loop. Continues past individual failures so one bad issue
 * never blocks the rest. `shouldContinue` is checked BEFORE each issue.
 */
export async function runIssueLoop(
  issues: IssueSnapshot[],
  handleOne: (issue: IssueSnapshot) => Promise<IssueLoopResult>,
  shouldContinue: () => boolean = () => true
): Promise<IssueLoopResult[]> {
  const results: IssueLoopResult[] = [];
  for (const issue of issues) {
    if (!shouldContinue()) break;
    try {
      results.push(await handleOne(issue));
    } catch (err) {
      results.push({
        number: issue.number,
        title: issue.title,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** Handle one issue via a fresh focused SDK session with its own timeout. */
async function handleIssueWithSession(
  client: CopilotClient,
  model: string | undefined,
  systemPrompt: string,
  workspace: string,
  issue: IssueSnapshot,
  ctx: ReturnType<typeof getGitHubContext>,
  defaultBranch: string
): Promise<IssueLoopResult> {
  info("Issue reviewer start", { issue: issue.number, title: issue.title });
  let session: CopilotSession | undefined;
  try {
    const sessionConfig = buildSessionConfig(model, systemPrompt, workspace);
    session = await client.createSession({
      ...sessionConfig,
      tools: factoryTools(ctx, defaultBranch),
    });
    attachLogger(session as unknown as { on: (l: (e: unknown) => void) => void });
    await session.sendAndWait({ prompt: buildIssuePrompt(issue) }, PER_ISSUE_TIMEOUT_MS);
    info("Issue reviewer done", { issue: issue.number });
    return { number: issue.number, title: issue.title, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = msg.startsWith("Timeout");
    if (session) await session.abort().catch(() => undefined);
    warn("Issue reviewer did not complete", {
      issue: issue.number,
      status: timedOut ? "timeout" : "error",
      err: msg,
    });
    return {
      number: issue.number,
      title: issue.title,
      status: timedOut ? "timeout" : "error",
      detail: msg,
    };
  }
}

function emoji(status: IssueLoopStatus): string {
  return status === "ok" ? "✅" : status === "timeout" ? "⏱️" : "⚠️";
}

async function main(): Promise<void> {
  const token = process.env["COPILOT_GITHUB_TOKEN"];
  if (!token) {
    writeSummary("## ⚠️ Issue pipeline skipped\n\n`COPILOT_TOKEN` is not configured.");
    info("COPILOT_GITHUB_TOKEN not set — skipping issue pipeline");
    process.exit(0);
  }

  const ctx = getGitHubContext();
  const configPath =
    process.env["FACTORY_CONFIG_PATH"] ?? join(ctx.workspace, ".github", "factory.yml");
  const agentsPath =
    process.env["AGENTS_PATH"] ?? join(ctx.workspace, ".github", "agents");

  const config = loadFactoryConfig(configPath);
  const vars = buildTemplateVars(ctx, config);
  const defaultBranch = String(vars["default_branch"] ?? "main");
  const { frontmatter, body } = loadAgent(agentsPath, "backlog-reviewer");
  const systemPrompt = interpolate(body, vars);

  const allSnapshots = fetchIssueSnapshots(ctx);
  const nowMs = Date.now();

  // Oldest-stale first: already sorted by updatedAt ASC from the query.
  // Skip issues that are still "warm" (actively being updated).
  const settled: IssueSnapshot[] = [];
  const tooFresh: IssueSnapshot[] = [];
  for (const s of allSnapshots) {
    if (isSettled(s, nowMs)) settled.push(s);
    else tooFresh.push(s);
  }

  info("Issue pipeline plan", {
    total: allSnapshots.length,
    settled: settled.length,
    tooFresh: tooFresh.length,
    order: settled.slice(0, 10).map((s) => s.number),
  });

  const client = createCopilotClient(token);
  const stopStartingAtMs = nowMs + PIPELINE_BUDGET_MS;
  const shouldContinue = () => Date.now() < stopStartingAtMs;

  let results: IssueLoopResult[] = [];
  try {
    results = await runIssueLoop(
      settled,
      (issue) =>
        handleIssueWithSession(
          client,
          frontmatter.model,
          systemPrompt,
          ctx.workspace,
          issue,
          ctx,
          defaultBranch
        ),
      shouldContinue
    );
  } finally {
    await client.stop();
  }

  const deferred = settled.slice(results.length);

  const lines: string[] = [
    `## Issue backlog review — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Open issues: **${allSnapshots.length}** · reviewed: **${results.length}** · skipped (fresh): **${tooFresh.length}** · deferred: **${deferred.length}**`,
    "",
    "| Issue | Result | Notes |",
    "|-------|--------|-------|",
  ];
  for (const r of results) {
    lines.push(`| #${r.number} | ${emoji(r.status)} ${r.status} | ${(r.detail ?? r.title).slice(0, 80)} |`);
  }
  for (const s of tooFresh) {
    lines.push(`| #${s.number} | ⏭️ skipped | updated ${Math.round((nowMs - new Date(s.updatedAt).getTime()) / 60_000)}m ago — inside ${SETTLE_MINUTES}m settle window |`);
  }
  for (const d of deferred) {
    lines.push(`| #${d.number} | ⏳ deferred | budget exhausted — oldest-first next run |`);
  }
  writeSummary(lines.join("\n"));
  info("Issue pipeline complete", {
    reviewed: results.length,
    timeouts: results.filter((r) => r.status === "timeout").length,
    errors: results.filter((r) => r.status === "error").length,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
