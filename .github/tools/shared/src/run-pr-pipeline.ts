#!/usr/bin/env node
/**
 * run-pr-pipeline.ts — the per-PR agentic loop.
 *
 * Replaces the old monolithic `tech-review` + `merge-assign` stages (one
 * open-ended session looping over all PRs, which grew to ~100k-token context
 * and was killed mid-sweep). Instead:
 *
 *   1. Fetch every open PR in ONE batched query (pr-snapshot).
 *   2. Order OLDEST-FIRST and skip only PRs with nothing to do (pr-ordering).
 *   3. Loop one-by-one: a FRESH, focused `pr-handler` agent session per PR,
 *      handed that PR's snapshot, with its own short timeout. Each PR's actions
 *      are persisted before the next starts, so a broad timeout only truncates
 *      the TAIL — and the oldest (most at-risk) PRs are handled first.
 *   4. After the PR loop, one short `project-manager` session does ONLY
 *      assignment of new work + stale-assignment cleanup.
 *
 * The agentic loop is the core; pr-snapshot is just an optimization that hands
 * each agent authoritative state so it doesn't burn turns re-deriving it.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import { loadAgent, interpolate } from "./agent-loader.js";
import { loadFactoryConfig } from "./factory-config.js";
import { getGitHubContext } from "./github-context.js";
import { fetchPrSnapshots, type PrSnapshot } from "./pr-snapshot.js";
import { planLoop } from "./pr-ordering.js";
import { factoryTools } from "./factory-tools.js";
import {
  createCopilotClient,
  buildSessionConfig,
  buildTemplateVars,
} from "./run-agent.js";
import { attachLogger, info, warn, writeSummary } from "./logging.js";

/** Per-PR work budget (ms). The orchestrator owns the real timeout, not the SDK frontmatter. */
const PER_PR_TIMEOUT_MS =
  (Number(process.env["PR_HANDLER_TIMEOUT_MIN"]) || 6) * 60 * 1000;
/** Overall wall-clock budget for the PR loop. Assignment runs as a separate
 * workflow step (run-assignment.ts) so the full budget is available for PRs. */
const PIPELINE_BUDGET_MS =
  (Number(process.env["PR_PIPELINE_BUDGET_MIN"]) || 18) * 60 * 1000;
const NO_DIFF_PR_COMMENT_MARKER = "[factory-reconciliation-guard]";
const COPILOT_PR_AUTHORS = new Set(["copilot-swe-agent[bot]", "copilot-swe-agent", "copilot"]);
const COPILOT_GQL_FEATURES =
  "issues_copilot_assignment_api_support,coding_agent_model_selection";

export type PrLoopStatus = "ok" | "timeout" | "error";

export interface PrLoopResult {
  number: number;
  title: string;
  status: PrLoopStatus;
  detail?: string;
}

export interface PrPreflightDecision {
  autoCloseNoDiff: boolean;
  reason?: string;
}

export interface ConflictRefreshOutcome {
  number: number;
  title: string;
  detectedAt: string;
  refreshStatus: string;
}

function gh(...args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch (err) {
    const stderr = err instanceof Error && "stderr" in err
      ? String((err as Error & { stderr?: string | Buffer }).stderr ?? "")
      : "";
    throw new Error(stderr.trim() || (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * Resolve the Copilot bot's GraphQL node ID — required for removeAssigneesFromAssignable.
 * Mirrors the lookupBotId helper in factory-tools.ts.
 */
function lookupCopilotBotId(owner: string, repo: string): string {
  const result = gh(
    "api", "graphql",
    "-f", `query=query($o:String!,$r:String!){repository(owner:$o,name:$r){assignableUsers(first:100,query:"Copilot"){nodes{id,login}}}}`,
    "-f", `o=${owner}`,
    "-f", `r=${repo}`,
    "--jq", '.data.repository.assignableUsers.nodes[] | select(.login == "Copilot") | .id'
  );
  if (result) return result;
  const fromIssue = gh(
    "api", "graphql",
    "-f", `query=query($o:String!,$r:String!){repository(owner:$o,name:$r){issues(first:10,states:[OPEN],filterBy:{assignee:"copilot-swe-agent[bot]"}){nodes{assignees(first:5){nodes{id,login}}}}}}`,
    "-f", `o=${owner}`,
    "-f", `r=${repo}`,
    "--jq", '[.data.repository.issues.nodes[].assignees.nodes[] | select(.login == "Copilot")] | first | .id'
  );
  if (fromIssue && fromIssue !== "null") return fromIssue;
  throw new Error("Could not look up Copilot bot node ID");
}

function isCopilotAuthor(author: string): boolean {
  return COPILOT_PR_AUTHORS.has(author.toLowerCase());
}

export function evaluatePrPreflight(pr: PrSnapshot): PrPreflightDecision {
  const isCopilotPr = isCopilotAuthor(pr.author);
  if (isCopilotPr && pr.changedFiles === 0) {
    return {
      autoCloseNoDiff: true,
      reason:
        "Current PR snapshot shows changedFiles=0, so this Copilot PR has no substantive implementation diff.",
    };
  }
  return { autoCloseNoDiff: false };
}

/**
 * Build the evidence comment body posted on each issue linked to a no-diff Copilot PR.
 * Exported for unit testing; used by closeNoDiffCopilotPr.
 */
export function buildLinkedIssueNoDiffComment(prNumber: number): string {
  return (
    `${NO_DIFF_PR_COMMENT_MARKER} PR #${prNumber} was closed by the factory because it had ` +
    `no implementation diff (\`changedFiles: 0\`). The Copilot assignee has been removed so this ` +
    `issue is not immediately re-kicked. If the issue still needs implementation, verify the scope ` +
    `is not already resolved on \`main\` and then re-assign Copilot.`
  );
}

export function closeNoDiffCopilotPr(
  pr: PrSnapshot,
  ctx: ReturnType<typeof getGitHubContext>
): PrLoopResult {
  const details: string[] = [];
  const commentBody =
    `${NO_DIFF_PR_COMMENT_MARKER} Closing this Copilot PR because the current snapshot shows ` +
    `\`changedFiles: 0\`, so there is no substantive implementation diff to review. ` +
    `The factory closes no-diff Copilot PRs instead of sending them through a human review round-trip.`;

  try {
    gh("pr", "comment", String(pr.number), "--repo", `${ctx.owner}/${ctx.repo}`, "--body", commentBody);
    details.push("posted no-diff evidence comment");
  } catch (err) {
    details.push(`comment failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    gh("pr", "close", String(pr.number), "--repo", `${ctx.owner}/${ctx.repo}`);
    details.push("closed no-diff PR");
  } catch (err) {
    return {
      number: pr.number,
      title: pr.title,
      status: "error",
      detail: `No-diff guard failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Unassign Copilot from each linked issue via GraphQL removeAssigneesFromAssignable
  // and post an evidence comment. This prevents the re-kick loop: without this step the
  // issue would remain assigned to copilot-swe-agent[bot] with no open PR, causing
  // findStaleIssues to re-kick it on the next pipeline pass, opening another empty PR.
  // Uses GraphQL (not `gh issue edit --remove-assignee`) so the unassign is guaranteed
  // to clear the Copilot bot identity — consistent with all other unassign paths in the factory.
  let botId: string | undefined;
  try {
    botId = lookupCopilotBotId(ctx.owner, ctx.repo);
  } catch (err) {
    details.push(`bot ID lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const issueNum of pr.linkedIssues) {
    if (botId) {
      try {
        const issueNodeId = gh(
          "api", `repos/${ctx.owner}/${ctx.repo}/issues/${issueNum}`,
          "--jq", ".node_id"
        );
        gh(
          "api", "graphql",
          "-H", `GraphQL-Features: ${COPILOT_GQL_FEATURES}`,
          "-f", `query=mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}`,
          "-f", `id=${issueNodeId}`,
          "-f", `botId=${botId}`
        );
        details.push(`unassigned Copilot from issue #${issueNum}`);
      } catch (err) {
        details.push(`unassign issue #${issueNum} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      gh(
        "issue", "comment", String(issueNum),
        "--repo", `${ctx.owner}/${ctx.repo}`,
        "--body", buildLinkedIssueNoDiffComment(pr.number)
      );
      details.push(`commented on issue #${issueNum}`);
    } catch (err) {
      details.push(`comment on issue #${issueNum} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    number: pr.number,
    title: pr.title,
    status: "ok",
    detail: details.join("; "),
  };
}

/**
 * Pure sequential loop: run `handleOne` over each PR in the given order,
 * continuing past any failure so one bad PR never blocks the rest. The order
 * is the caller's responsibility (oldest-first). Kept SDK-free so it is unit
 * testable.
 *
 * `shouldContinue` is checked BEFORE each PR; when it returns false the loop
 * stops starting new PRs (e.g. to reserve time for the assignment phase). The
 * remaining PRs are simply deferred to the next pass — safe because the order
 * is oldest-first, so only the newest (least at-risk) PRs are ever deferred.
 */
export async function runPrLoop(
  prs: PrSnapshot[],
  handleOne: (pr: PrSnapshot) => Promise<PrLoopResult>,
  shouldContinue: () => boolean = () => true
): Promise<PrLoopResult[]> {
  const results: PrLoopResult[] = [];
  for (const pr of prs) {
    if (!shouldContinue()) break;
    try {
      results.push(await handleOne(pr));
    } catch (err) {
      results.push({
        number: pr.number,
        title: pr.title,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** Run prompt handing the agent ONE PR plus its authoritative snapshot. */
export function buildPrPrompt(pr: PrSnapshot): string {
  return [
    `Handle exactly ONE pull request now: #${pr.number} — "${pr.title}" (author: ${pr.author}).`,
    ``,
    `Current state snapshot (authoritative as of moments ago):`,
    "```json",
    JSON.stringify(pr, null, 2),
    "```",
    ``,
    `Work your decision tree for this single PR, take the needed action(s), then stop.`,
    `Re-fetch with \`npx tsx .github/tools/shared/src/pr-snapshot.ts --pr ${pr.number}\` only if you changed the PR or need a detail not in the snapshot.`,
  ].join("\n");
}

export function buildConflictRefreshOutcomes(
  snapshots: PrSnapshot[],
  results: PrLoopResult[],
  skipped: { snapshot: PrSnapshot; reason: string }[],
  deferred: PrSnapshot[],
  detectedAt: string
): ConflictRefreshOutcome[] {
  const handled = new Map(results.map((r) => [r.number, r]));
  const skippedByPr = new Map(skipped.map((s) => [s.snapshot.number, s.reason]));
  const deferredPrs = new Set(deferred.map((d) => d.number));

  return snapshots
    .filter((s) => isCopilotAuthor(s.author) && s.mergeable === "CONFLICTING")
    .sort((a, b) => {
      const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return t !== 0 ? t : a.number - b.number;
    })
    .map((s) => {
      const handledResult = handled.get(s.number);
      if (handledResult) {
        return {
          number: s.number,
          title: s.title,
          detectedAt,
          refreshStatus:
            handledResult.status === "ok"
              ? "✅ refresh triggered (pr-handler session ran)"
              : `${emoji(handledResult.status)} refresh triggered but ${handledResult.status}`,
        };
      }
      const skipReason = skippedByPr.get(s.number);
      if (skipReason) {
        return {
          number: s.number,
          title: s.title,
          detectedAt,
          refreshStatus: `⏭️ intentionally skipped — ${skipReason}`,
        };
      }
      if (deferredPrs.has(s.number)) {
        return {
          number: s.number,
          title: s.title,
          detectedAt,
          refreshStatus: "⏳ refresh not triggered — deferred due to pass budget",
        };
      }
      return {
        number: s.number,
        title: s.title,
        detectedAt,
        refreshStatus: "⚠️ refresh outcome unknown — PR was not handled in this pass",
      };
    });
}

/** Handle one PR via a fresh, focused SDK session with its own timeout + abort-on-timeout. */
async function handlePrWithSession(
  client: CopilotClient,
  model: string | undefined,
  systemPrompt: string,
  workspace: string,
  pr: PrSnapshot,
  ctx: ReturnType<typeof getGitHubContext>,
  defaultBranch: string
): Promise<PrLoopResult> {
  info("PR handler start", { pr: pr.number, title: pr.title });
  const preflight = evaluatePrPreflight(pr);
  if (preflight.autoCloseNoDiff) {
    info("PR handler preflight closed no-diff PR", { pr: pr.number, reason: preflight.reason });
    return closeNoDiffCopilotPr(pr, ctx);
  }
  let session: CopilotSession | undefined;
  try {
    const sessionConfig = buildSessionConfig(model, systemPrompt, workspace);
    session = await client.createSession({
      ...sessionConfig,
      tools: factoryTools(ctx, defaultBranch),
    });
    attachLogger(session as unknown as { on: (l: (e: unknown) => void) => void });
    await session.sendAndWait({ prompt: buildPrPrompt(pr) }, PER_PR_TIMEOUT_MS);
    info("PR handler done", { pr: pr.number });
    return { number: pr.number, title: pr.title, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = msg.startsWith("Timeout");
    // SDK timeout only stops waiting — actively abort the in-flight session so
    // the next PR starts clean.
    if (session) await session.abort().catch(() => undefined);
    warn("PR handler did not complete", { pr: pr.number, status: timedOut ? "timeout" : "error", err: msg });
    return {
      number: pr.number,
      title: pr.title,
      status: timedOut ? "timeout" : "error",
      detail: msg,
    };
  }
}

function emoji(status: PrLoopStatus): string {
  return status === "ok" ? "✅" : status === "timeout" ? "⏱️" : "⚠️";
}

async function main(): Promise<void> {
  const token = process.env["COPILOT_GITHUB_TOKEN"];
  if (!token) {
    writeSummary("## ⚠️ PR pipeline skipped\n\n`COPILOT_TOKEN` is not configured.");
    info("COPILOT_GITHUB_TOKEN not set — skipping PR pipeline");
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
  const { frontmatter, body } = loadAgent(agentsPath, "pr-handler");
  const systemPrompt = interpolate(body, vars);

  const snapshots = fetchPrSnapshots(ctx);
  const { actionable, skipped } = planLoop(snapshots, Date.now());
  info("PR pipeline plan", {
    open: snapshots.length,
    actionable: actionable.length,
    skipped: skipped.length,
    order: actionable.map((s) => s.number),
  });

  const client = createCopilotClient(token);
  // Use the full budget for PR review — assignment runs as a separate step.
  const stopStartingAtMs = Date.now() + PIPELINE_BUDGET_MS;
  const shouldContinue = () => Date.now() < stopStartingAtMs;

  let results: PrLoopResult[] = [];
  const assignStatus: PrLoopStatus = "ok";
  try {
    results = await runPrLoop(
      actionable,
      (pr) => handlePrWithSession(client, frontmatter.model, systemPrompt, ctx.workspace, pr, ctx, defaultBranch),
      shouldContinue
    );
  } finally {
    await client.stop();
  }

  const deferred = actionable.slice(results.length);
  const conflictDetectedAt = new Date().toISOString();
  const conflictOutcomes = buildConflictRefreshOutcomes(
    snapshots,
    results,
    skipped,
    deferred,
    conflictDetectedAt
  );

  // Consolidated summary.
  const lines: string[] = [
    `## PR pipeline pass — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Open PRs: **${snapshots.length}** · handled: **${results.length}** · skipped: **${skipped.length}** · deferred: **${deferred.length}** · assignment: ${emoji(assignStatus)} ${assignStatus}`,
    "",
    "| PR | Result | Notes |",
    "|----|--------|-------|",
  ];
  for (const r of results) {
    lines.push(`| #${r.number} | ${emoji(r.status)} ${r.status} | ${(r.detail ?? r.title).slice(0, 80)} |`);
  }
  for (const s of skipped) {
    lines.push(`| #${s.snapshot.number} | ⏭️ skipped | ${s.reason.slice(0, 80)} |`);
  }
  for (const d of deferred) {
    lines.push(`| #${d.number} | ⏳ deferred | ran out of pass budget — next pass (oldest-first) |`);
  }
  if (conflictOutcomes.length > 0) {
    lines.push(
      "",
      `### Conflict refresh outcomes — ${conflictDetectedAt.slice(0, 16).replace("T", " ")} UTC`,
      "",
      "| PR | Detected At | Refresh status |",
      "|----|-------------|----------------|",
    );
    for (const outcome of conflictOutcomes) {
      lines.push(
        `| #${outcome.number} | ${outcome.detectedAt.slice(0, 19)}Z | ${outcome.refreshStatus.slice(0, 120)} |`,
      );
    }
  }
  writeSummary(lines.join("\n"));
  info("PR pipeline complete", {
    handled: results.length,
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
