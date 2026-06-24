#!/usr/bin/env node
/**
 * run-assignment.ts — dedicated assignment phase.
 *
 * Stale re-kick is done programmatically (fast, reliable, no LLM token burn):
 *   1. List ALL issues assigned to copilot-swe-agent[bot].
 *   2. For each: check linkedPullRequests via GraphQL.
 *   3. If no open linked PR: unassign + re-assign with agentAssignment (the ONLY
 *      reliable trigger for a new SWE agent session).
 *
 * New-work assignment is then handled by the project-manager agent (requires
 * judgment on which issues to pick and priority ordering).
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import { loadAgent, interpolate } from "./agent-loader.js";
import { loadFactoryConfig } from "./factory-config.js";
import { getGitHubContext } from "./github-context.js";
import { factoryTools, buildCoveredSet } from "./factory-tools.js";
import {
  createCopilotClient,
  buildSessionConfig,
  buildTemplateVars,
} from "./run-agent.js";
import { attachLogger, info, warn, writeSummary } from "./logging.js";

const ASSIGN_TIMEOUT_MS =
  (Number(process.env["ASSIGN_TIMEOUT_MIN"]) || 7) * 60 * 1000;

const COPILOT_GQL_HEADERS = "issues_copilot_assignment_api_support,coding_agent_model_selection";

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function lookupBotId(owner: string, repo: string): string {
  // Copilot is a bot — not queryable via user(). Instead, find it from an issue
  // where it's already assigned, or fall back to listing repo assignees.
  const result = gh("api", "graphql",
    "-f", `query=query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){assignableUsers(first:100,query:"Copilot"){nodes{id,login}}}}`,
    "-f", `owner=${owner}`,
    "-f", `repo=${repo}`,
    "--jq", '.data.repository.assignableUsers.nodes[] | select(.login == "Copilot") | .id'
  );
  if (result) return result;
  // Fallback: read from an issue already assigned to Copilot
  const fromIssue = gh("api", "graphql",
    "-f", `query=query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){issues(first:10,states:[OPEN],filterBy:{assignee:"copilot-swe-agent[bot]"}){nodes{assignees(first:5){nodes{id,login}}}}}}`,
    "-f", `owner=${owner}`,
    "-f", `repo=${repo}`,
    "--jq", '[.data.repository.issues.nodes[].assignees.nodes[] | select(.login == "Copilot")] | first | .id'
  );
  if (fromIssue && fromIssue !== "null") return fromIssue;
  throw new Error("Could not look up Copilot bot node ID");
}

function lookupRepoId(owner: string, repo: string): string {
  return gh("api", `repos/${owner}/${repo}`, "--jq", ".node_id");
}

interface StaleIssue {
  number: number;
  title: string;
  nodeId: string;
}

/** Outcome written to the Stage 2b summary: completed, timed out non-fatally, or failed. */
type AssignmentPhaseStatus = "ok" | "timeout" | "error";

/** Inputs needed to build the Stage 2b project-manager prompt after Stage 0 re-kicks. */
interface AssignmentPromptOptions {
  defaultBranch: string;
  maxOpenCopilotPrs: number;
  rekickedCount: number;
}

/** Inputs needed to render the Stage 2b summary, including optional failure detail text. */
interface AssignmentSummaryOptions {
  status: AssignmentPhaseStatus;
  maxOpenCopilotPrs: number;
  staleIssues: StaleIssue[];
  rekickedCount: number;
  detail?: string;
}

/** Build the assignment-only prompt for Stage 4. */
export function buildAssignmentPrompt({
  defaultBranch: _defaultBranch,
  maxOpenCopilotPrs,
  rekickedCount,
}: AssignmentPromptOptions): string {
  return [
    `Stage 2b assignment pass must still run even when Stage 2a fails or times out — this step always runs.`,
    `Stage 2 (PR handler loop) has already run this pass and handled per-PR review, CI unblocking, conflict nudges, and merges.`,
    `Stage 0 already ran programmatic stale re-kicks earlier this pass (re-kicked ${rekickedCount} issues).`,
    ``,
    `Your job in this Stage 4 pass is ONLY:`,
    ``,
    `1. Check for remaining stale assignments using the get_stale_assignments tool.`,
    `   - Stale detection: use issue assignees plus linkedPullRequests to determine if an issue has no open PR.`,
    `   - An assignment is stale if the issue has been assigned for 30 minutes old or more with no linked open PR.`,
    `   - If any stale issues exist AND capacity_gap > 0, call rekick_assignment for each one`,
    `     (up to capacity_gap). You MUST pass an evidence string describing what you observed.`,
    `   - Do not re-kick issues that Stage 0 already re-kicked this pass (check for a`,
    `     "[factory-rekick]" comment posted in the last 30 minutes).`,
    ``,
    `2. Assign new ready-for-dev issues to refill capacity up to ${maxOpenCopilotPrs} open Copilot PRs.`,
    `   - Use: gh issue list --state open --label "queue:development" --label "ready-for-dev" --json number,title,labels --limit 10`,
    `   - Skip issues with: needs-design, needs-security-review, needs-database-review, needs-platform-review, needs-info, blocked`,
    `   - Use assign_to_copilot tool for each eligible issue (up to the capacity gap).`,
    `   - When assigning, post this comment on the issue: "@copilot please open a draft PR for this issue from main. The PR body MUST include 'Closes #<issue-number>' so the pipeline can track it. Do not expand scope."`,
    ``,
    `Do NOT review open PRs. Do NOT merge PRs. Do NOT re-do Stage 2 work.`,
    `Write a brief summary: stale re-kicks performed, new issues assigned, capacity remaining.`,
  ].join("\n");
}

/** Build the Stage 2b summary shown on success, timeout, or hard error. */
export function buildAssignmentSummary({
  status,
  maxOpenCopilotPrs,
  staleIssues,
  rekickedCount,
  detail,
}: AssignmentSummaryOptions): string {
  const heading =
    status === "ok"
      ? "## Assignment phase ✅"
      : `## Assignment phase ${status === "timeout" ? "⏱️ timed out" : "⚠️ error"}`;

  return [
    heading,
    "",
    `**Stage contract**: stale cleanup uses issue assignees plus linkedPullRequests, gives @copilot a 30-minute grace nudge before unassigning, and then refills capacity up to ${maxOpenCopilotPrs} open Copilot PRs.`,
    `**Stage 0 re-kicks**: ${rekickedCount} of ${staleIssues.length} stale issues re-kicked earlier in this pass.`,
    staleIssues.length > 0
      ? `Re-kicked earlier this pass: ${staleIssues.map((issue) => `#${issue.number}`).join(", ")}`
      : `No stage 0 re-kicks were needed.`,
    "",
    status === "ok"
      ? `Assignment outcome: see agent output above.`
      : `Assignment outcome: ${detail ?? "unknown error"}`,
  ].join("\n");
}

/** Get all issues assigned to copilot-swe-agent[bot] with no open copilot/ branch. */
function findStaleIssues(owner: string, repo: string, botId: string): StaleIssue[] {
  info("Fetching issues assigned to copilot-swe-agent[bot]...");
  const raw = gh(
    "issue", "list",
    "--repo", `${owner}/${repo}`,
    "--state", "open",
    "--assignee", "copilot-swe-agent[bot]",
    "--json", "number,title",
    "--limit", "100"
  );
  const issues: Array<{ number: number; title: string }> = JSON.parse(raw);
  info(`Found ${issues.length} issues assigned to copilot-swe-agent[bot]`);

  // Get open Copilot branches — a copilot/ branch means Copilot is working on it.
  // --paginate outputs one JSON array per page per line; parse each line and flatten.
  const branchesRaw = gh(
    "api", `repos/${owner}/${repo}/branches`,
    "--jq", '[.[] | select(.name | startswith("copilot/")) | .name]',
    "-X", "GET",
    "--paginate"
  );
  const copilotBranches: string[] = branchesRaw
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line) as string[]);
  info(`Open Copilot branches: ${copilotBranches.length}`);

  // Get open Copilot PRs with closing-issue references so we can determine
  // which assigned issues are genuinely covered.
  const openPrRaw = gh(
    "pr", "list",
    "--repo", `${owner}/${repo}`,
    "--author", "copilot-swe-agent[bot]",
    "--state", "open",
    "--json", "headRefName,number,title,closingIssuesReferences",
    "--limit", "200"
  );
  const openPrs: Array<{
    headRefName: string;
    number: number;
    title: string;
    closingIssuesReferences: Array<{ number: number }>;
  }> = JSON.parse(openPrRaw);
  info(`Open Copilot PRs: ${openPrs.length}`);

  // Only re-kick when open PRs are WELL below max capacity (8).
  // If there are already >=8 open Copilot PRs the pipeline is full — no re-kick needed.
  // This prevents the re-kick flood that happened when 99 PRs were already open.
  const MAX_COPILOT_PRS = 8; // matches factory.yml max_open_copilot_prs
  if (openPrs.length >= MAX_COPILOT_PRS) {
    info(`Open Copilot PRs (${openPrs.length}) >= max (${MAX_COPILOT_PRS}) — no re-kicks needed`);
    return [];
  }

  const knownNums = new Set(issues.map((i) => i.number));

  // Build the set of issue numbers covered by an open PR using the shared
  // three-signal logic from factory-tools (closingIssuesReferences, branch
  // number, title #N).  Keeping this in sync with buildCoveredSet is the whole
  // point of using the shared function here.
  const coveredByOpenPr = buildCoveredSet(openPrs, knownNums);
  info(`Issues covered by an open PR: ${coveredByOpenPr.size}`);

  // Also check recently-merged Copilot PRs (last 7 days).
  // Issues covered by a recently-merged PR should NOT be re-kicked — the work
  // was done. Instead, we clean them up (close + unassign) below.
  const mergedPrRaw = gh(
    "pr", "list",
    "--repo", `${owner}/${repo}`,
    "--author", "copilot-swe-agent[bot]",
    "--state", "merged",
    "--json", "headRefName,number,title,closingIssuesReferences,mergedAt",
    "--limit", "200"
  );
  const allMergedPrs: Array<{
    headRefName: string;
    number: number;
    title: string;
    closingIssuesReferences: Array<{ number: number }>;
    mergedAt: string;
  }> = JSON.parse(mergedPrRaw);

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentMergedPrs = allMergedPrs.filter(
    (pr) => pr.mergedAt && new Date(pr.mergedAt).getTime() > cutoff
  );
  info(`Recently-merged Copilot PRs (last 7 days): ${recentMergedPrs.length}`);

  const coveredByRecentMerge = buildCoveredSet(recentMergedPrs, knownNums);
  info(`Issues covered by a recently-merged PR: ${coveredByRecentMerge.size}`);

  // Cleanup: issues covered by a recently-merged PR (but not by an open PR)
  // need close + unassign, not a re-kick.
  const needsCleanup = issues.filter(
    (i) => !coveredByOpenPr.has(i.number) && coveredByRecentMerge.has(i.number)
  );
  if (needsCleanup.length > 0) {
    info(`Cleaning up ${needsCleanup.length} issue(s) covered by recently-merged PRs...`);
    for (const issue of needsCleanup) {
      try {
        const issueNodeId = gh(
          "api", `repos/${owner}/${repo}/issues/${issue.number}`,
          "--jq", ".node_id"
        );
        // Remove Copilot assignee
        gh(
          "api", "graphql",
          "-H", `GraphQL-Features: ${COPILOT_GQL_HEADERS}`,
          "-f", `query=mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}`,
          "-f", `id=${issueNodeId}`,
          "-f", `botId=${botId}`
        );
        // Close the issue if still open
        const issueState = JSON.parse(
          gh("issue", "view", String(issue.number), "--repo", `${owner}/${repo}`, "--json", "state")
        );
        if (issueState.state !== "CLOSED") {
          // Find which merged PR covered this issue (for the comment)
          const coveringPr = recentMergedPrs.find(
            (pr) => buildCoveredSet([pr], knownNums).has(issue.number)
          );
          const prRef = coveringPr ? `PR #${coveringPr.number}` : "a recently merged Copilot PR";
          gh("issue", "close", String(issue.number), "--repo", `${owner}/${repo}`);
          gh(
            "issue", "comment", String(issue.number),
            "--repo", `${owner}/${repo}`,
            "--body",
            `Closed — delivered by ${prRef} (merged). The PR did not include a \`Closes #${issue.number}\` keyword so GitHub did not auto-close this issue. Closed now via factory pipeline stale-cleanup pass.`
          );
        }
        info(`Cleaned up #${issue.number}: ${issue.title}`);
      } catch (err) {
        warn(`Failed to clean up #${issue.number}`, { err: String(err) });
      }
    }
  }

  // Re-kick only enough issues to fill the gap to max capacity, and only those
  // not already covered by an open PR or a recently-merged PR.
  const gap = MAX_COPILOT_PRS - openPrs.length;
  info(`Gap: ${gap} re-kicks needed (${openPrs.length} open PRs, max ${MAX_COPILOT_PRS})`);

  const genuinelyStale = issues.filter(
    (i) => !coveredByOpenPr.has(i.number) && !coveredByRecentMerge.has(i.number)
  );
  info(`Issues assigned but not covered by any PR (open or recent merge): ${genuinelyStale.length}`);

  const stale: StaleIssue[] = [];
  for (const issue of genuinelyStale.slice(0, gap)) {
    const nodeId = gh(
      "api", `repos/${owner}/${repo}/issues/${issue.number}`,
      "--jq", ".node_id"
    );
    stale.push({ number: issue.number, title: issue.title, nodeId });
  }
  info(`Stale issues to re-kick: ${stale.length}`);
  return stale;
}

/** Unassign then re-assign copilot-swe-agent[bot] to trigger a fresh SWE agent session. */
function rekickIssue(issue: StaleIssue, owner: string, repo: string, botId: string, repoId: string, defaultBranch: string): boolean {
  try {
    gh(
      "api", "graphql",
      "-H", `GraphQL-Features: ${COPILOT_GQL_HEADERS}`,
      "-f", `query=mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}`,
      "-f", `id=${issue.nodeId}`,
      "-f", `botId=${botId}`
    );
    gh(
      "api", "graphql",
      "-H", `GraphQL-Features: ${COPILOT_GQL_HEADERS}`,
      "-f", `query=mutation($id:ID!,$botId:ID!,$repoId:ID!,$base:String!){addAssigneesToAssignable(input:{assignableId:$id,assigneeIds:[$botId],agentAssignment:{targetRepositoryId:$repoId,baseRef:$base}}){assignable{... on Issue{number}}}}`,
      "-f", `id=${issue.nodeId}`,
      "-f", `botId=${botId}`,
      "-f", `repoId=${repoId}`,
      "-f", `base=${defaultBranch}`
    );
    gh(
      "issue", "comment", String(issue.number),
      "--repo", `${owner}/${repo}`,
      "--body", `[factory-rekick] Re-kicked Copilot assignment — unassigned and re-assigned to trigger a fresh SWE agent session from \`${defaultBranch}\`. @copilot — the PR body MUST include \`Closes #${issue.number}\` so the factory pipeline can track the linkage and avoid re-kicking this issue again.`
    );
    info(`Re-kicked #${issue.number}: ${issue.title}`);
    return true;
  } catch (err) {
    warn(`Failed to re-kick #${issue.number}`, { err: String(err) });
    return false;
  }
}

async function main(): Promise<void> {
  const token = process.env["COPILOT_GITHUB_TOKEN"];
  if (!token) {
    writeSummary("## ⚠️ Assignment skipped\n\n`COPILOT_TOKEN` is not configured.");
    info("COPILOT_GITHUB_TOKEN not set — skipping assignment");
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
  const maxPrs = Number(vars["max_open_copilot_prs"] ?? 8);

  const rekickOnly = process.env["REKICK_ONLY"] === "true";

  // ── Phase 1: Programmatic stale re-kick (fast, deterministic) ───────────────
  info(rekickOnly ? "Mode: re-kick only (no agent)" : "Phase 1: stale re-kick");
  info("Looking up Copilot bot ID and repo node ID...");
  const botId = lookupBotId(ctx.owner, ctx.repo);
  const repoId = lookupRepoId(ctx.owner, ctx.repo);
  info(`botId=${botId} repoId=${repoId}`);

  const staleIssues = findStaleIssues(ctx.owner, ctx.repo, botId);

  let rekicked = 0;
  for (const issue of staleIssues) {
    if (rekickIssue(issue, ctx.owner, ctx.repo, botId, repoId, defaultBranch)) {
      rekicked++;
    }
  }
  info(`Stale re-kick complete: ${rekicked}/${staleIssues.length} re-kicked`);

  if (rekickOnly) {
    writeSummary([
      `## Stale re-kick ✅`,
      `Re-kicked **${rekicked}** of **${staleIssues.length}** stale issues.`,
      staleIssues.length > 0 ? `Issues: ${staleIssues.map(i => `#${i.number}`).join(", ")}` : "",
    ].join("\n"));
    return;
  }

  // ── Phase 2: Agent assigns new work (requires judgment) ──────────────────────
  info("Phase 2: assign new work via project-manager agent");
  const { frontmatter, body } = loadAgent(agentsPath, "project-manager");
  const systemPrompt = interpolate(body, vars);

  const client = createCopilotClient(token);
  let session: CopilotSession | undefined;
  try {
    const sessionConfig = buildSessionConfig(frontmatter.model, systemPrompt, ctx.workspace);
    session = await client.createSession({
      ...sessionConfig,
      tools: factoryTools(ctx, defaultBranch),
    });
    attachLogger(session as unknown as { on: (l: (e: unknown) => void) => void });
    await session.sendAndWait(
      {
        prompt: buildAssignmentPrompt({
          defaultBranch,
          maxOpenCopilotPrs: maxPrs,
          rekickedCount: rekicked,
        }),
      },
      ASSIGN_TIMEOUT_MS
    );
    info("New-work assignment complete");
    writeSummary(
      buildAssignmentSummary({
        status: "ok",
        maxOpenCopilotPrs: maxPrs,
        staleIssues,
        rekickedCount: rekicked,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (session) await session.abort().catch(() => undefined);
    const timedOut = msg.startsWith("Timeout");
    warn("New-work assignment did not complete", { err: msg });
    writeSummary(
      buildAssignmentSummary({
        status: timedOut ? "timeout" : "error",
        maxOpenCopilotPrs: maxPrs,
        staleIssues,
        rekickedCount: rekicked,
        detail: msg,
      })
    );
    process.exit(timedOut ? 0 : 1);
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
