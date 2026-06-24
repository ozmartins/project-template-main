/**
 * factory-tools.ts — typed Copilot SDK tool definitions for pipeline agents.
 *
 * Each tool encapsulates one mechanical GitHub action so agent prompts describe
 * policy (when to act) rather than mechanics (how to call the GraphQL mutation).
 *
 * Tools are split into two categories:
 *   - Investigation: read-only, cheap, required before any terminal action
 *   - Action: mutating, each requires a rationale/evidence string from the agent
 *
 * Wiring: pass `factoryTools(ctx, owner, repo, defaultBranch)` as the `tools`
 * array in `client.createSession(...)`.
 */

import { execFileSync } from "node:child_process";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { fetchPrSnapshots } from "./pr-snapshot.js";
import type { GitHubContext } from "./github-context.js";
import { attributeCiFailures, isCancelledConclusion, isFailureConclusion } from "./ci-baseline.js";

const COPILOT_GQL_FEATURES =
  "issues_copilot_assignment_api_support,coding_agent_model_selection";
const QUEUE_ARCHITECTURE_LABEL = "queue:architecture";
const MERGE_COVERAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ASSIGNMENT_GUARD_PR_SCAN_LIMIT = 200;
const ASSIGNMENT_GUARD_COMMENT_MARKER = "[factory-assignment-guard]";
const issueTokenRegexCache = new Map<number, RegExp>();

function getIssueTokenRegex(issueNumber: number): RegExp {
  const cached = issueTokenRegexCache.get(issueNumber);
  if (cached) return cached;
  const compiled = new RegExp(`(?:^|[/-])${issueNumber}(?:[/-]|$)`);
  issueTokenRegexCache.set(issueNumber, compiled);
  return compiled;
}

function gh(...args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function lookupBotId(owner: string, repo: string): string {
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

function lookupRepoId(owner: string, repo: string): string {
  return gh("api", `repos/${owner}/${repo}`, "--jq", ".node_id");
}

export interface AssignmentGuardrailInput {
  issueNumber: number;
  issueLabels: string[];
  openPrs: Array<{
    number: number;
    title: string;
    body?: string;
    headRefName?: string;
    closingIssuesReferences?: Array<{ number: number }>;
  }>;
  mergedPrs?: Array<{
    number: number;
    title: string;
    body?: string;
    headRefName?: string;
    mergedAt?: string;
    closingIssuesReferences?: Array<{ number: number }>;
  }>;
}

export type AssignmentGuardrailResult =
  | { ok: true; duplicatePrNumbers: number[] }
  | {
      ok: false;
      reason: string;
      duplicatePrNumbers: number[];
      closeIssue?: boolean;
      blockType: "queue_architecture" | "open_pr_duplicate" | "recently_merged_duplicate";
    };

export function extractLinkedIssueNumbers(pr: {
  title: string;
  body?: string;
  closingIssuesReferences?: Array<{ number: number }>;
}): Set<number> {
  const linked = new Set<number>();

  for (const ref of pr.closingIssuesReferences ?? []) {
    linked.add(ref.number);
  }

  const text = `${pr.title ?? ""}\n${pr.body ?? ""}`;
  // Match issue references like "#458" when preceded by start-of-string or a
  // non-word character to avoid accidental matches inside tokens.
  for (const match of text.matchAll(/(?:^|[^\w])#(\d+)\b/g)) {
    linked.add(Number(match[1]));
  }
  // Match fully-qualified references like "owner/repo#458" so assignment
  // guardrails also detect issue linkage when PR templates require that form.
  for (const match of text.matchAll(/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+#(\d+)\b/g)) {
    linked.add(Number(match[1]));
  }

  return linked;
}

// ── Reconciliation gate ───────────────────────────────────────────────────────
// Classifies a PR as implementation_ready, already_satisfied, or hold_no_diff
// before it can proceed through the merge path.  Used by merge_pr to enforce
// guardrails at the tool layer so no-op PRs cannot silently consume capacity.

export type DiffState = "has_diff" | "no_diff";
export type SatisfactionState = "already_satisfied" | "unknown";
export type LinkageState = "has_closing_refs" | "none";
export type ReconciliationDecision =
  | "implementation_ready"
  | "already_satisfied"
  | "hold_no_diff";

export interface ReconciliationResult {
  diff_state: DiffState;
  satisfaction_state: SatisfactionState;
  linkage_state: LinkageState;
  decision: ReconciliationDecision;
  evidence: string;
  actions: string[];
}

/**
 * Classify a PR's merge readiness.
 *
 * Decision rules (in priority order):
 *  1. `hold_no_diff`      — additions + deletions == 0: empty PR, cannot deliver value.
 *  2. `already_satisfied` — caller has positive evidence the issue is resolved on main.
 *  3. `implementation_ready` — has a real diff, not confirmed already done.
 *
 * `already_satisfied` requires **positive** evidence supplied by the caller.
 * An empty diff alone is `hold_no_diff`, not `already_satisfied`.
 */
export function classifyPrDecision({
  additions,
  deletions,
  closingIssuesReferences,
  isAlreadySatisfied = false,
}: {
  additions: number;
  deletions: number;
  closingIssuesReferences: Array<{ number: number }>;
  isAlreadySatisfied?: boolean;
}): ReconciliationResult {
  const diff_state: DiffState = additions + deletions === 0 ? "no_diff" : "has_diff";
  const linkage_state: LinkageState =
    closingIssuesReferences.length > 0 ? "has_closing_refs" : "none";

  if (diff_state === "no_diff") {
    return {
      diff_state,
      satisfaction_state: "unknown",
      linkage_state,
      decision: "hold_no_diff",
      evidence: `PR has no substantive changes (additions: ${additions}, deletions: ${deletions}). Likely a no-op confirmation PR.`,
      actions: ["block_merge", "unassign_copilot", "comment_on_pr"],
    };
  }

  if (isAlreadySatisfied) {
    return {
      diff_state,
      satisfaction_state: "already_satisfied",
      linkage_state,
      decision: "already_satisfied",
      evidence: "Issue requirements are already met on the default branch.",
      actions: ["close_issue", "unassign_copilot"],
    };
  }

  return {
    diff_state,
    satisfaction_state: "unknown",
    linkage_state,
    decision: "implementation_ready",
    evidence: `PR has substantive changes (additions: ${additions}, deletions: ${deletions}).`,
    actions: ["merge_when_approved"],
  };
}

/**
 * Build the covered-issue set from a list of PRs using three linkage signals:
 *  1. Explicit `closingIssuesReferences` (from `Closes #N` keywords)
 *  2. Issue number embedded in the branch name (copilot/<slug>-NNN-)
 *  3. Issue number as `#NNN` in the PR title
 *
 * Only adds branch-name and title numbers that appear in `knownIssueNumbers`
 * to avoid false positives from unrelated numeric tokens.
 */
export function buildCoveredSet(
  prs: Array<{
    headRefName: string;
    title: string;
    closingIssuesReferences: Array<{ number: number }>;
  }>,
  knownIssueNumbers: ReadonlySet<number>
): Set<number> {
  const covered = new Set<number>();
  for (const pr of prs) {
    for (const ref of pr.closingIssuesReferences) {
      covered.add(ref.number);
    }
    const branchNums = pr.headRefName.match(/\d+/g);
    if (branchNums) {
      for (const n of branchNums) {
        const num = parseInt(n, 10);
        if (knownIssueNumbers.has(num)) covered.add(num);
      }
    }
    const titleNums = pr.title.match(/#(\d+)/g);
    if (titleNums) {
      for (const m of titleNums) {
        const num = parseInt(m.slice(1), 10);
        if (knownIssueNumbers.has(num)) covered.add(num);
      }
    }
  }
  return covered;
}

export function evaluateAssignmentGuardrails({
  issueNumber,
  issueLabels,
  openPrs,
  mergedPrs = [],
}: AssignmentGuardrailInput): AssignmentGuardrailResult {
  if (issueLabels.some((label) => label === QUEUE_ARCHITECTURE_LABEL)) {
    return {
      ok: false,
      reason: `Issue is in ${QUEUE_ARCHITECTURE_LABEL} and is not implementation-ready for Copilot assignment.`,
      duplicatePrNumbers: [],
      blockType: "queue_architecture",
    };
  }

  // Match issue numbers as discrete branch-name tokens (e.g. "fix/1079", "feature-1079-desc").
  const issueTokenRegex = getIssueTokenRegex(issueNumber);
  const duplicatePrNumbers = openPrs
    .filter((pr) => {
      const linkedByBodyOrRefs = extractLinkedIssueNumbers(pr).has(issueNumber);
      const linkedByBranch = issueTokenRegex.test(pr.headRefName ?? "");
      return linkedByBodyOrRefs || linkedByBranch;
    })
    .map((pr) => pr.number);

  if (duplicatePrNumbers.length > 0) {
    return {
      ok: false,
      reason: `Issue already has open in-flight PR(s): ${duplicatePrNumbers
        .map((n) => `#${n}`)
        .join(", ")}.`,
      duplicatePrNumbers,
      blockType: "open_pr_duplicate",
    };
  }

  const mergeCoverageWindowStart = Date.now() - MERGE_COVERAGE_WINDOW_MS;
  const mergedCoveragePrNumbers = mergedPrs
    .filter((pr) => {
      if (!pr.mergedAt) return false;
      if (new Date(pr.mergedAt).getTime() < mergeCoverageWindowStart) return false;
      const linkedByBodyOrRefs = extractLinkedIssueNumbers(pr).has(issueNumber);
      const linkedByBranch = issueTokenRegex.test(pr.headRefName ?? "");
      return linkedByBodyOrRefs || linkedByBranch;
    })
    .map((pr) => pr.number);

  if (mergedCoveragePrNumbers.length > 0) {
    return {
      ok: false,
      reason: `Issue appears already covered by recently merged PR(s): ${mergedCoveragePrNumbers
        .map((n) => `#${n}`)
        .join(", ")}.`,
      duplicatePrNumbers: mergedCoveragePrNumbers,
      closeIssue: true,
      blockType: "recently_merged_duplicate",
    };
  }

  return { ok: true, duplicatePrNumbers: [] };
}

// ── CI baseline attribution ───────────────────────────────────────────────────
// Separates PR-introduced CI failures from pre-existing main failures and from
// same-repo action_required gates before agents post review requests or nudges.

/** One CI check entry as returned by `gh pr checks --json name,state,conclusion,link`. */
export interface CiCheck {
  name: string;
  state: string;
  conclusion: string;
  link?: string;
}

/** How a failing or action_required CI check is attributed. */
export type CiClassification =
  | "pre_existing_on_main" // same check is currently failing on main — do NOT ask Copilot to fix
  | "action_required"       // same-repo PR-layer gate, not a real test failure
  | "cancelled"             // PR-layer cancelled run, rerun first (not a code fix)
  | "pr_introduced";        // genuinely new failure on this branch — may need Copilot attention

export interface CiAttributionResult {
  name: string;
  classification: CiClassification;
  link?: string;
}

/**
 * Classify each failing, action_required, or cancelled check on a PR.
 *
 * @param prChecks        - Raw check entries from `gh pr checks --json name,state,conclusion,link`.
 * @param mainFailingNames - Set of workflow/check names currently failing on the default branch.
 * @returns               - One result per classified check with its classification.
 *
 * Matching rule: a PR check is pre_existing_on_main when its name exactly matches
 * a main failing run name, or when it is a job within that workflow
 * (e.g. "Validate - Semgrep / lint" matches main run "Validate - Semgrep").
 *
 * Failure conclusions handled: FAILURE, failure, timed_out, startup_failure.
 * All four are surfaced so agents have full coverage of "genuinely broken" checks.
 * Cancelled checks are surfaced separately as a rerun-first CI irregularity.
 */
export function classifyCiChecks(
  prChecks: CiCheck[],
  mainFailingNames: ReadonlySet<string>
): CiAttributionResult[] {
  const failing = prChecks.filter(
    (c) =>
      c.state === "ACTION_REQUIRED" ||
      isFailureConclusion(c.conclusion) ||
      isFailureConclusion(c.state) ||
      isCancelledConclusion(c.conclusion) ||
      isCancelledConclusion(c.state)
  );

  return failing.map((c) => {
    if (c.state === "ACTION_REQUIRED") {
      return { name: c.name, classification: "action_required", link: c.link };
    }
    if (isCancelledConclusion(c.conclusion) || isCancelledConclusion(c.state)) {
      return { name: c.name, classification: "cancelled", link: c.link };
    }
    const preExisting = [...mainFailingNames].some(
      (mainName) => c.name === mainName || c.name.startsWith(`${mainName} / `)
    );
    const classification: CiClassification = preExisting
      ? "pre_existing_on_main"
      : "pr_introduced";
    return { name: c.name, classification, link: c.link };
  });
}

/**
 * Build the human-readable guidance string from a classified attribution list.
 * Used by both get_ci_baseline and get_pr_investigation for consistent messaging.
 *
 * Pass the optional `options` buckets to include guidance for pre-existing main
 * failures, action_required gates, and cancelled checks in the same message so
 * agents never need to inspect multiple return fields for the bottom-line action.
 */
export function buildCiGuidance(
  prIntroduced: CiAttributionResult[],
  options?: {
    preExistingOnMain?: CiAttributionResult[];
    actionRequired?: CiAttributionResult[];
    cancelled?: CiAttributionResult[];
  }
): string {
  const parts: string[] = [];

  if (prIntroduced.length === 0) {
    parts.push("No PR-introduced CI failures. Do not ask Copilot to fix CI on this branch.");
  } else {
    parts.push(
      `${prIntroduced.length} PR-introduced failure(s) that may need Copilot attention: ${prIntroduced.map((r) => r.name).join(", ")}`
    );
  }

  const preExistingOnMain = options?.preExistingOnMain ?? [];
  if (preExistingOnMain.length > 0) {
    parts.push(
      `${preExistingOnMain.length} pre-existing failure(s) on main — do not ask Copilot to fix: ${preExistingOnMain.map((r) => r.name).join(", ")}`
    );
  }

  const actionRequired = options?.actionRequired ?? [];
  if (actionRequired.length > 0) {
    parts.push(
      `${actionRequired.length} action_required gate(s) — request trusted rerun, not a code change: ${actionRequired.map((r) => r.name).join(", ")}`
    );
  }

  const cancelled = options?.cancelled ?? [];
  if (cancelled.length > 0) {
    parts.push(
      `${cancelled.length} cancelled check(s) — rerun before evaluating CI state: ${cancelled.map((r) => r.name).join(", ")}`
    );
  }

  return parts.join(" | ");
}

/**
 * Conclusions that indicate a workflow run is genuinely broken — all of these
 * should suppress PR-branch fix nudges when the same run name is failing on main.
 *
 * - `failure` / `FAILURE`:   explicit test or step failure
 * - `timed_out`:              consistent timeouts are a real main breakage
 * - `startup_failure`:        runner/environment problem on main, not PR-introduced
 */
const BASELINE_FAILING_CONCLUSIONS = new Set([
  "failure",
  "FAILURE",
  "timed_out",
  "TIMED_OUT",
  "startup_failure",
  "STARTUP_FAILURE",
]);

/**
 * Fetch the names of workflow runs currently failing on the given branch.
 *
 * Returns `{ names, warning }` — if the API call fails, `names` is an empty set
 * and `warning` explains that attribution may be incomplete.
 *
 * Fetches the 50 most recent runs: high enough for active repositories, while
 * staying well within a single API call. Classification for checks not covered
 * in this window defaults conservatively to `pr_introduced`.
 *
 * Treats `failure`, `timed_out`, and `startup_failure` as baseline failures.
 * `cancelled` and `skipped` are not counted — those do not represent a broken check.
 */
export function fetchMainFailingCheckNames(
  ghFn: (...args: string[]) => string,
  owner: string,
  repo: string,
  branch: string
): { names: Set<string>; warning?: string } {
  try {
    const raw = ghFn(
      "run", "list",
      "--repo", `${owner}/${repo}`,
      "--branch", branch,
      "--limit", "50",
      "--json", "name,conclusion"
    );
    const runs = JSON.parse(raw) as Array<{ name: string; conclusion: string }>;
    const names = new Set<string>();
    for (const run of runs) {
      if (BASELINE_FAILING_CONCLUSIONS.has(run.conclusion)) {
        names.add(run.name);
      }
    }
    return { names };
  } catch {
    return {
      names: new Set(),
      warning: `Could not fetch ${branch} branch runs — pre_existing_on_main classification may be incomplete`,
    };
  }
}

/** Build all factory tools for a given repo context. */
export function factoryTools(
  ctx: GitHubContext,
  defaultBranch: string
): Tool<any>[] {
  const { owner, repo } = ctx;

  const getSharedCiBaselineAttribution = (prNumber: number) => {
    const warnings: string[] = [];
    const checksRaw = gh(
      "pr", "checks", String(prNumber),
      "--repo", `${owner}/${repo}`,
      "--json", "name,state,conclusion,link"
    );
    const checks: CiCheck[] = JSON.parse(checksRaw);
    const checkLinks = new Map(checks.map((check) => [check.name, check.link]));
    const failingCheckNames = checks
      .filter((c) => isFailureConclusion(c.conclusion) || isFailureConclusion(c.state))
      .map((c) => c.name);
    const cancelledCheckNames = checks
      .filter((c) => isCancelledConclusion(c.conclusion) || isCancelledConclusion(c.state))
      .map((c) => c.name);

    let actionRequiredCheckNames: string[] = [];
    try {
      const headRef = gh(
        "pr", "view", String(prNumber),
        "--repo", `${owner}/${repo}`,
        "--json", "headRefName",
        "--jq", ".headRefName"
      ).trim();
      if (headRef) {
        const actionRunsRaw = gh(
          "run", "list",
          "--repo", `${owner}/${repo}`,
          "--branch", headRef,
          "--status", "action_required",
          "--limit", "20",
          "--json", "name"
        );
        const actionRuns: Array<{ name: string }> = JSON.parse(actionRunsRaw);
        actionRequiredCheckNames = actionRuns.map((r) => r.name);
      }
    } catch {
      actionRequiredCheckNames = [];
      warnings.push(
        "Could not fetch PR branch action_required runs — action_required classification may be incomplete"
      );
    }

    let mainRuns: Array<{ name: string; conclusion: string; databaseId: number }> = [];
    try {
      const mainRunsRaw = gh(
        "run", "list",
        "--repo", `${owner}/${repo}`,
        "--branch", defaultBranch,
        "--limit", "50",
        "--json", "name,conclusion,databaseId"
      );
      mainRuns = JSON.parse(mainRunsRaw);
    } catch {
      mainRuns = [];
      warnings.push(
        `Could not fetch ${defaultBranch} branch runs — pre_existing_on_main classification may be incomplete`
      );
    }

    const baseline = attributeCiFailures(
      failingCheckNames,
      actionRequiredCheckNames,
      mainRuns,
      defaultBranch,
      cancelledCheckNames
    );

    return { baseline, checkLinks, warnings, mainFailingCheckNames: [...new Set(
      mainRuns.filter((run) => isFailureConclusion(run.conclusion)).map((run) => run.name)
    )] };
  };

  // ── Investigation tools ──────────────────────────────────────────────────

  const getPrTriage = defineTool<{ pr_number: number }>("get_pr_triage", {
    description:
      "Get the fast structured triage state for a single PR: mergeable status, draft flag, " +
      "CI rollup, specialist lane blockers, review state, linked issues, last commit age. " +
      "Use this FIRST to decide which investigation path to take. " +
      "Do NOT make a terminal decision (approve/merge/re-kick) based on triage alone — " +
      "always call get_pr_investigation before acting.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number", description: "PR number to triage" },
      },
      required: ["pr_number"],
    },
    skipPermission: true,
    handler: async ({ pr_number }) => {
      const snapshots = fetchPrSnapshots(ctx);
      const snap = snapshots.find((s) => s.number === pr_number);
      if (!snap) {
        return { error: `PR #${pr_number} not found in open PRs` };
      }
      const BLOCKING_LABELS = new Set([
        "needs-platform-review",
        "needs-security-review",
        "needs-database-review",
      ]);
      const openLanes = snap.labels.filter((l) => BLOCKING_LABELS.has(l));
      const lastCommitAgeMinutes = snap.lastCommitAt
        ? Math.floor((Date.now() - new Date(snap.lastCommitAt).getTime()) / 60000)
        : null;
      return {
        number: snap.number,
        title: snap.title,
        author: snap.author,
        isDraft: snap.isDraft,
        mergeable: snap.mergeable,
        ciState: snap.ciState,
        approved: snap.approved,
        changesRequested: snap.changesRequested,
        openSpecialistLanes: openLanes,
        labels: snap.labels,
        linkedIssues: snap.linkedIssues,
        lastCommitAgeMinutes,
        changedFiles: snap.changedFiles,
      };
    },
  });

  const getPrInvestigation = defineTool<{ pr_number: number }>("get_pr_investigation", {
    description:
      "Deep-read a PR for a terminal decision. Returns: diff (first 300 lines), " +
      "CI failure log excerpts for each failing check (first 80 lines each), " +
      "linked issue body, recent review comment threads, last 5 commit messages. " +
      "REQUIRED before any call to merge_pr, post_review, or rekick_assignment. " +
      "Do not skip this even if triage looks simple — the snapshot cannot tell you " +
      "whether scope is correct, whether CI failure is a flake, or whether review " +
      "feedback was genuinely addressed.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number", description: "PR number to investigate" },
      },
      required: ["pr_number"],
    },
    skipPermission: true,
    handler: async ({ pr_number }) => {
      const result: Record<string, unknown> = {};

      // Diff (truncated)
      try {
        const diff = gh("pr", "diff", String(pr_number), "--repo", `${owner}/${repo}`);
        const lines = diff.split("\n");
        result["diff_lines_total"] = lines.length;
        result["diff"] = lines.slice(0, 300).join("\n");
        if (lines.length > 300) result["diff_truncated"] = true;
      } catch {
        result["diff"] = "unavailable";
      }

      // CI failures with baseline attribution
      try {
        const { baseline, checkLinks, warnings } = getSharedCiBaselineAttribution(pr_number);
        const attribution = Object.entries(baseline.attribution).map(([name, details]) => {
          if (details.is_action_required) return { name, classification: "action_required" as const };
          if (details.is_cancelled) return { name, classification: "cancelled" as const };
          if (details.pre_existing_on_main) {
            return { name, classification: "pre_existing_on_main" as const };
          }
          return { name, classification: "pr_introduced" as const };
        });
        const preExistingOnMain = attribution.filter((r) => r.classification === "pre_existing_on_main");
        const actionRequired = attribution.filter((r) => r.classification === "action_required");
        const cancelledChecks = attribution.filter((r) => r.classification === "cancelled");
        const prIntroduced = attribution.filter((r) => r.classification === "pr_introduced");
        result["ci_baseline"] = {
          pre_existing_on_main: preExistingOnMain,
          action_required: actionRequired,
          cancelled: cancelledChecks,
          pr_introduced: prIntroduced,
          guidance: buildCiGuidance(prIntroduced, {
            preExistingOnMain,
            actionRequired,
            cancelled: cancelledChecks,
          }),
          ...(warnings.length > 0 ? { warnings } : {}),
        };

        const failing = prIntroduced;
        result["failing_checks"] = failing.map((c) => ({ name: c.name, link: checkLinks.get(c.name) }));

        // Fetch log excerpt for up to 3 PR-introduced failing runs
        const logs: Record<string, string> = {};
        for (const check of failing.slice(0, 3)) {
          try {
            const headRef = gh(
              "pr", "view", String(pr_number),
              "--repo", `${owner}/${repo}`,
              "--json", "headRefName",
              "--jq", ".headRefName"
            );
            const runId = gh(
              "run", "list",
              "--repo", `${owner}/${repo}`,
              "--branch", headRef,
              "--status", "failure",
              "--limit", "3",
              "--json", "databaseId,name",
              "--jq", `[.[] | select(.name | test("${check.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"))] | first | .databaseId`
            );
            if (runId && runId !== "null") {
              const log = gh(
                "run", "view", runId,
                "--repo", `${owner}/${repo}`,
                "--log-failed"
              );
              logs[check.name] = log.split("\n").slice(0, 80).join("\n");
            }
          } catch {
            logs[check.name] = "log unavailable";
          }
        }
        result["ci_failure_logs"] = logs;
      } catch {
        result["failing_checks"] = "unavailable";
      }

      // Linked issue body
      try {
        const linkedRaw = gh(
          "pr", "view", String(pr_number),
          "--repo", `${owner}/${repo}`,
          "--json", "closingIssuesReferences",
          "--jq", "[.closingIssuesReferences[].number]"
        );
        const linked: number[] = JSON.parse(linkedRaw);
        const issues: Array<{ number: number; body: string; title: string }> = [];
        for (const n of linked.slice(0, 3)) {
          try {
            const raw = gh(
              "issue", "view", String(n),
              "--repo", `${owner}/${repo}`,
              "--json", "number,title,body"
            );
            issues.push(JSON.parse(raw));
          } catch {
            issues.push({ number: n, title: "unavailable", body: "" });
          }
        }
        result["linked_issues"] = issues;
      } catch {
        result["linked_issues"] = [];
      }

      // Recent review threads
      try {
        const reviewsRaw = gh(
          "pr", "view", String(pr_number),
          "--repo", `${owner}/${repo}`,
          "--json", "reviews,reviewRequests",
          "--jq", "{reviews: [.reviews[] | {author: .author.login, state, body, submittedAt}], reviewRequests: [.reviewRequests[].login // .reviewRequests[].name]}"
        );
        result["reviews"] = JSON.parse(reviewsRaw);
      } catch {
        result["reviews"] = "unavailable";
      }

      // Last 5 commits
      try {
        const commitsRaw = gh(
          "pr", "view", String(pr_number),
          "--repo", `${owner}/${repo}`,
          "--json", "commits",
          "--jq", "[.commits[-5:] | .[] | {sha: .oid[0:7], message: .messageHeadline, author: .authors[0].login, committedDate}]"
        );
        result["recent_commits"] = JSON.parse(commitsRaw);
      } catch {
        result["recent_commits"] = "unavailable";
      }

      return result;
    },
  });

  const getStaleAssignments = defineTool<{ max_open_copilot_prs?: number }>("get_stale_assignments", {
    description:
      "Returns issues assigned to copilot-swe-agent[bot] that have no linked open PR. " +
      "Uses per-issue PR linkage check (not a count heuristic) to reliably identify " +
      "ghost assignments where Copilot's session never started or stalled before opening a PR. " +
      "Only returns issues where re-kicking would be within capacity (open PRs < max_open_copilot_prs). " +
      "Also checks recently-merged Copilot PRs so issues covered by a recent merge are " +
      "returned in 'merged_but_open_issues' for cleanup rather than re-kicked.",
    parameters: {
      type: "object",
      properties: {
        max_open_copilot_prs: {
          type: "number",
          description: "Maximum concurrent open Copilot PRs",
          default: 8,
        },
      },
      required: [],
    },
    skipPermission: true,
    handler: async ({ max_open_copilot_prs = 8 }) => {
      // Fetch all assigned issues
      const issuesRaw = gh(
        "issue", "list",
        "--repo", `${owner}/${repo}`,
        "--state", "open",
        "--assignee", "copilot-swe-agent[bot]",
        "--json", "number,title,createdAt",
        "--limit", "100"
      );
      const issues: Array<{ number: number; title: string; createdAt: string }> =
        JSON.parse(issuesRaw);

      const knownNums = new Set(issues.map((i) => i.number));

      // Fetch all open Copilot PRs with linkage info
      const openPrsRaw = gh(
        "pr", "list",
        "--repo", `${owner}/${repo}`,
        "--author", "copilot-swe-agent[bot]",
        "--state", "open",
        "--json", "number,title,headRefName,closingIssuesReferences",
        "--limit", "500"
      );
      const openPrs: Array<{
        number: number;
        title: string;
        headRefName: string;
        closingIssuesReferences: Array<{ number: number }>;
      }> = JSON.parse(openPrsRaw);

      // Fetch recently-merged Copilot PRs so we don't re-kick issues that
      // already had a PR merged (even if it lacked a Closes #N keyword).
      const mergedPrsRaw = gh(
        "pr", "list",
        "--repo", `${owner}/${repo}`,
        "--author", "copilot-swe-agent[bot]",
        "--state", "merged",
        "--json", "number,title,headRefName,closingIssuesReferences,mergedAt",
        "--limit", "200"
      );
      const mergedPrs: Array<{
        number: number;
        title: string;
        headRefName: string;
        closingIssuesReferences: Array<{ number: number }>;
        mergedAt: string;
      }> = JSON.parse(mergedPrsRaw);

      // Build covered set from open PRs using three linkage signals
      const coveredByOpen = buildCoveredSet(openPrs, knownNums);

      // Build covered set from recently-merged PRs (last 7 days)
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentMergedPrs = mergedPrs.filter(
        (pr) => pr.mergedAt && new Date(pr.mergedAt).getTime() > cutoff
      );
      const coveredByRecentMerge = buildCoveredSet(recentMergedPrs, knownNums);

      // Issues covered only by a recent merge (not by an open PR) need cleanup,
      // not a re-kick — the work was done but the issue wasn't auto-closed.
      const mergedButOpen = issues.filter(
        (i) => !coveredByOpen.has(i.number) && coveredByRecentMerge.has(i.number)
      );

      // Truly stale: no open PR AND no recent merged PR
      const stale = issues.filter(
        (i) => !coveredByOpen.has(i.number) && !coveredByRecentMerge.has(i.number)
      );
      const gap = max_open_copilot_prs - openPrs.length;

      // Find the merged PR number for each merged-but-open issue (for the agent's context)
      const mergedPrByIssue = new Map<number, number>();
      for (const pr of recentMergedPrs) {
        const linked = buildCoveredSet([pr], knownNums);
        for (const n of linked) {
          if (!mergedPrByIssue.has(n)) mergedPrByIssue.set(n, pr.number);
        }
      }

      return {
        open_copilot_prs: openPrs.length,
        max_open_copilot_prs,
        capacity_gap: gap,
        can_rekick: gap > 0,
        stale_count: stale.length,
        stale_issues: stale.map((i) => ({
          number: i.number,
          title: i.title,
          assigned_hours_ago: Math.floor(
            (Date.now() - new Date(i.createdAt).getTime()) / 3600000
          ),
        })),
        merged_but_open_count: mergedButOpen.length,
        merged_but_open_issues: mergedButOpen.map((i) => ({
          number: i.number,
          title: i.title,
          merged_pr: mergedPrByIssue.get(i.number) ?? null,
          assigned_hours_ago: Math.floor(
            (Date.now() - new Date(i.createdAt).getTime()) / 3600000
          ),
        })),
      };
    },
  });

  // ── Action tools ─────────────────────────────────────────────────────────

  const mergePr = defineTool<{ pr_number: number; rationale: string }>("merge_pr", {
    description:
      "Squash-merge a pull request and delete its branch. " +
      "Only call after get_pr_investigation confirms: approved review, green CI, " +
      "MERGEABLE status, no open specialist lanes, and scope is correct. " +
      "The rationale parameter is REQUIRED — state specifically what you verified. " +
      "PRs with no substantive diff are blocked (hold_no_diff guardrail). " +
      "After a successful merge, linked issues are closed and the Copilot assignee " +
      "is removed even when the PR body did not include 'Closes #N'.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number", description: "PR number to merge" },
        rationale: {
          type: "string",
          description:
            "Why this PR meets the merge bar. Must reference what you read: " +
            "e.g. 'approved by ianreay, CI green, MERGEABLE, diff reviewed: only adds X'",
        },
      },
      required: ["pr_number", "rationale"],
    },
    handler: async ({ pr_number, rationale }) => {
      // ── Reconciliation gate: block no-op PRs before merge ────────────────
      let prMeta: {
        additions: number;
        deletions: number;
        headRefName: string;
        title: string;
        closingIssuesReferences: Array<{ number: number }>;
      } | null = null;
      try {
        prMeta = JSON.parse(
          gh(
            "pr", "view", String(pr_number),
            "--repo", `${owner}/${repo}`,
            "--json", "additions,deletions,headRefName,title,closingIssuesReferences"
          )
        );
      } catch {
        // Non-fatal: proceed without gate if metadata is unavailable
      }

      if (prMeta) {
        const reconciliation = classifyPrDecision({
          additions: prMeta.additions,
          deletions: prMeta.deletions,
          closingIssuesReferences: prMeta.closingIssuesReferences,
        });
        if (reconciliation.decision === "hold_no_diff") {
          return {
            merged: false,
            pr: pr_number,
            blocked: true,
            reconciliation,
          };
        }
      }

      // ── Perform the merge ────────────────────────────────────────────────
      try {
        gh("pr", "merge", String(pr_number), "--repo", `${owner}/${repo}`, "--squash", "--delete-branch");
      } catch (err) {
        return { merged: false, pr: pr_number, error: String(err) };
      }

      // ── Post-merge lifecycle cleanup ─────────────────────────────────────
      // Close linked issues and remove the Copilot assignee.  GitHub only
      // auto-closes issues when the PR body includes "Closes #N" on the
      // default branch merge path — Copilot frequently omits this keyword, so
      // we do the cleanup here regardless.
      const closedIssues: number[] = [];
      const unassignedIssues: number[] = [];

      if (prMeta) {
        // Separate authoritative refs from heuristic candidates to prevent
        // false-positive closures:
        //  - Authoritative: explicit closingIssuesReferences — act regardless
        //  - Heuristic: branch name / title numbers — only act if Copilot is
        //    actually assigned to that issue (cross-check prevents closing
        //    unrelated issues whose number coincidentally appears in the branch)
        const authoritativeNums = new Set<number>(
          prMeta.closingIssuesReferences.map((r) => r.number)
        );
        const heuristicNums = new Set<number>();
        const branchNums = prMeta.headRefName.match(/\d+/g);
        if (branchNums) {
          for (const n of branchNums) heuristicNums.add(parseInt(n, 10));
        }
        const titleNums = prMeta.title.match(/#(\d+)/g);
        if (titleNums) {
          for (const m of titleNums) heuristicNums.add(parseInt(m.slice(1), 10));
        }
        const allCandidates = new Set([...authoritativeNums, ...heuristicNums]);

        let botId: string | null = null;
        for (const issueNum of allCandidates) {
          try {
            const issueRaw = gh(
              "issue", "view", String(issueNum),
              "--repo", `${owner}/${repo}`,
              "--json", "number,state,assignees"
            );
            const issue: {
              number: number;
              state: string;
              assignees: Array<{ login: string }>;
            } = JSON.parse(issueRaw);

            const copilotAssigned = issue.assignees.some(
              (a) => a.login === "copilot-swe-agent[bot]" || a.login === "Copilot"
            );
            const isAuthoritative = authoritativeNums.has(issueNum);

            // For heuristic numbers, require that Copilot is actually assigned —
            // this cross-check confirms the number is the correct issue and not
            // an unrelated token in the branch name.
            if (!isAuthoritative && !copilotAssigned) continue;

            // Remove Copilot assignee
            if (copilotAssigned) {
              if (!botId) {
                try { botId = lookupBotId(owner, repo); } catch { /* ignore */ }
              }
              if (botId) {
                try {
                  const issueNodeId = gh(
                    "api", `repos/${owner}/${repo}/issues/${issueNum}`,
                    "--jq", ".node_id"
                  );
                  gh(
                    "api", "graphql",
                    "-H", `GraphQL-Features: ${COPILOT_GQL_FEATURES}`,
                    "-f", `query=mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}`,
                    "-f", `id=${issueNodeId}`,
                    "-f", `botId=${botId}`
                  );
                  unassignedIssues.push(issueNum);
                } catch { /* non-fatal */ }
              }
            }

            // Close the issue if still open (only when authoritative OR Copilot-assigned)
            if (issue.state === "OPEN" && (isAuthoritative || copilotAssigned)) {
              try {
                gh("issue", "close", String(issueNum), "--repo", `${owner}/${repo}`);
                gh(
                  "issue", "comment", String(issueNum),
                  "--repo", `${owner}/${repo}`,
                  "--body",
                  `Closed — delivered by PR #${pr_number} (merged). The PR did not include a \`Closes #${issueNum}\` keyword so GitHub did not auto-close this issue at merge time. Closed now via factory pipeline merge-path cleanup.`
                );
                closedIssues.push(issueNum);
              } catch { /* non-fatal */ }
            }
          } catch { /* issue not found or other error — skip */ }
        }
      }

      return {
        merged: true,
        pr: pr_number,
        rationale,
        closed_issues: closedIssues,
        unassigned_issues: unassignedIssues,
      };
    },
  });

  const postReview = defineTool<{ pr_number: number; action: "approve" | "request_changes"; body: string }>("post_review", {
    description:
      "Approve or request changes on a PR. " +
      "For 'request_changes', body MUST start with '@copilot' to wake the coding agent. " +
      "Built-in dedup guard: will not re-post if an identical review body exists with " +
      "no new commits since — returns {skipped: true} in that case. " +
      "Call get_pr_investigation before using this — the body must reference specific evidence.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number" },
        action: {
          type: "string",
          enum: ["approve", "request_changes"],
        },
        body: {
          type: "string",
          description:
            "For approve: reason. For request_changes: MUST start with '@copilot' and give specific actionable instruction.",
        },
      },
      required: ["pr_number", "action", "body"],
    },
    handler: async ({ pr_number, action, body }) => {
      if (action === "request_changes" && !body.startsWith("@copilot")) {
        return {
          posted: false,
          error: "request_changes body must start with '@copilot' to wake the coding agent",
        };
      }

      // Dedup guard: check for identical recent review with no commits since
      try {
        const recentRaw = gh(
          "pr", "view", String(pr_number),
          "--repo", `${owner}/${repo}`,
          "--json", "reviews,commits",
          "--jq", "{lastReviewBody: (.reviews[-1].body // \"\"), lastReviewAt: (.reviews[-1].submittedAt // \"\"), lastCommitAt: (.commits[-1].committedDate // \"\")}"
        );
        const recent: { lastReviewBody: string; lastReviewAt: string; lastCommitAt: string } =
          JSON.parse(recentRaw);
        if (
          recent.lastReviewBody.trim() === body.trim() &&
          recent.lastReviewAt &&
          recent.lastCommitAt &&
          new Date(recent.lastReviewAt) > new Date(recent.lastCommitAt)
        ) {
          return {
            posted: false,
            skipped: true,
            reason: "Identical review already posted with no new commits since — avoiding busy-loop",
          };
        }
      } catch {
        // Dedup check failed — proceed anyway
      }

      const flag = action === "approve" ? "--approve" : "--request-changes";
      try {
        gh("pr", "review", String(pr_number), "--repo", `${owner}/${repo}`, flag, "--body", body);

        // After approving, enable auto-merge so GitHub merges the PR the moment
        // CI is green and there are no conflicts — no need to wait for the next
        // pipeline pass to call merge_pr.
        let autoMergeEnabled = false;
        if (action === "approve") {
          try {
            gh("pr", "merge", String(pr_number), "--repo", `${owner}/${repo}`, "--auto", "--squash");
            autoMergeEnabled = true;
          } catch {
            // Auto-merge may fail if branch protection rules require more approvals
            // or if the repo doesn't have auto-merge enabled — non-fatal.
          }
        }

        return { posted: true, pr: pr_number, action, auto_merge_enabled: autoMergeEnabled };
      } catch (err) {
        return { posted: false, error: String(err) };
      }
    },
  });

  const assignToCopilot = defineTool<{ issue_number: number; reason: string }>("assign_to_copilot", {
    description:
      "Assign an issue to the Copilot SWE agent to open a new PR. " +
      "Looks up bot ID and repo node ID dynamically (no hardcoded values). " +
      "Only call when open Copilot PRs < max_open_copilot_prs. " +
      "The reason parameter is posted as an assignment comment.",
    parameters: {
      type: "object",
      properties: {
        issue_number: { type: "number", description: "Issue number to assign" },
        reason: { type: "string", description: "Why this issue is being assigned now" },
      },
      required: ["issue_number", "reason"],
    },
    handler: async ({ issue_number, reason }) => {
      try {
        const issueData = JSON.parse(gh(
          "api", `repos/${owner}/${repo}/issues/${issue_number}`
        ));

        // Refuse to assign if Copilot is already assigned — avoids duplicate sessions.
        const alreadyCopilot = (issueData.assignees ?? []).some(
          (a: { login: string }) => a.login === "copilot-swe-agent[bot]" || a.login === "Copilot"
        );
        if (alreadyCopilot) {
          return { assigned: false, issue: issue_number, skipped: true, reason: "Copilot already assigned — skipping to avoid duplicate session" };
        }

        const issue = { number: issueData.number, labels: (issueData.labels ?? []).map((l: { name: string }) => l.name) };

        const openPrsRaw = gh(
          "pr", "list",
          "--repo", `${owner}/${repo}`,
          "--state", "open",
          "--json", "number,title,body,headRefName,closingIssuesReferences",
          "--limit", String(ASSIGNMENT_GUARD_PR_SCAN_LIMIT)
        );
        const openPrs: Array<{
          number: number;
          title: string;
          body?: string;
          headRefName?: string;
          closingIssuesReferences?: Array<{ number: number }>;
        }> = JSON.parse(openPrsRaw);

        const mergedPrsRaw = gh(
          "pr", "list",
          "--repo", `${owner}/${repo}`,
          "--state", "merged",
          "--json", "number,title,body,headRefName,mergedAt,closingIssuesReferences",
          "--limit", String(ASSIGNMENT_GUARD_PR_SCAN_LIMIT)
        );
        const mergedPrs: Array<{
          number: number;
          title: string;
          body?: string;
          headRefName?: string;
          mergedAt?: string;
          closingIssuesReferences?: Array<{ number: number }>;
        }> = JSON.parse(mergedPrsRaw);

        const guardrails = evaluateAssignmentGuardrails({
          issueNumber: issue.number,
          issueLabels: issue.labels,
          openPrs,
          mergedPrs,
        });
        if (!guardrails.ok) {
          if (guardrails.blockType === "recently_merged_duplicate") {
            const issueWithCommentsRaw = gh(
              "issue", "view", String(issue.number),
              "--repo", `${owner}/${repo}`,
              "--json", "comments"
            );
            const issueWithComments: { comments?: Array<{ body?: string }> } =
              JSON.parse(issueWithCommentsRaw);
            const hasGuardComment = (issueWithComments.comments ?? []).some((comment) =>
              (comment.body ?? "").includes(ASSIGNMENT_GUARD_COMMENT_MARKER)
            );
            const shouldCloseIssue = guardrails.closeIssue && issueData.state === "open";
            const guardCommentBody =
              `${ASSIGNMENT_GUARD_COMMENT_MARKER} Assignment skipped — ${guardrails.reason} ` +
              (shouldCloseIssue
                ? `Closing this issue because a recently merged Copilot PR already covers it on ${defaultBranch}, ` +
                  `so no new Copilot implementation PR is needed.`
                : `No new Copilot implementation PR is needed.`);
            if (!hasGuardComment) {
              gh(
                "issue", "comment", String(issue.number),
                "--repo", `${owner}/${repo}`,
                "--body",
                guardCommentBody
              );
            }
            if (shouldCloseIssue) {
              gh("issue", "close", String(issue.number), "--repo", `${owner}/${repo}`);
            }
          }
          return {
            assigned: false,
            blocked: true,
            issue: issue_number,
            reason: guardrails.reason,
            duplicate_prs: guardrails.duplicatePrNumbers,
            issue_closed: Boolean(guardrails.closeIssue),
          };
        }

        const issueId = issueData.node_id;
        const botId = lookupBotId(owner, repo);
        const repoId = lookupRepoId(owner, repo);

        gh(
          "api", "graphql",
          "-H", `GraphQL-Features: ${COPILOT_GQL_FEATURES}`,
          "-f", `query=mutation($id:ID!,$botId:ID!,$repoId:ID!,$base:String!){addAssigneesToAssignable(input:{assignableId:$id,assigneeIds:[$botId],agentAssignment:{targetRepositoryId:$repoId,baseRef:$base}}){assignable{... on Issue{number}}}}`,
          "-f", `id=${issueId}`,
          "-f", `botId=${botId}`,
          "-f", `repoId=${repoId}`,
          "-f", `base=${defaultBranch}`
        );
        gh(
          "issue", "comment", String(issue_number),
          "--repo", `${owner}/${repo}`,
          "--body", `Assigned to Copilot. ${reason}\n\n@copilot — the PR body MUST include \`Closes #${issue_number}\` so GitHub links the PR to this issue and the factory pipeline can track coverage.`
        );
        return { assigned: true, issue: issue_number };
      } catch (err) {
        return { assigned: false, issue: issue_number, error: String(err) };
      }
    },
  });

  const rekickAssignment = defineTool<{ issue_number: number; evidence: string }>("rekick_assignment", {
    description:
      "Unassign then re-assign an issue to Copilot to trigger a fresh SWE agent session. " +
      "Use only when you have verified (via get_stale_assignments or get_pr_investigation) " +
      "that the issue is assigned but has no open PR. " +
      "The evidence parameter is REQUIRED — describe what you observed before re-kicking.",
    parameters: {
      type: "object",
      properties: {
        issue_number: { type: "number" },
        evidence: {
          type: "string",
          description:
            "What you observed that justifies a re-kick. " +
            "e.g. 'assigned 14h ago, no open PR, no copilot/ branch found'",
        },
      },
      required: ["issue_number", "evidence"],
    },
    handler: async ({ issue_number, evidence }) => {
      try {
        const issueId = gh(
          "api", `repos/${owner}/${repo}/issues/${issue_number}`,
          "--jq", ".node_id"
        );
        const botId = lookupBotId(owner, repo);
        const repoId = lookupRepoId(owner, repo);

        // Unassign
        gh(
          "api", "graphql",
          "-H", `GraphQL-Features: ${COPILOT_GQL_FEATURES}`,
          "-f", `query=mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}`,
          "-f", `id=${issueId}`,
          "-f", `botId=${botId}`
        );
        // Re-assign with fresh session trigger
        gh(
          "api", "graphql",
          "-H", `GraphQL-Features: ${COPILOT_GQL_FEATURES}`,
          "-f", `query=mutation($id:ID!,$botId:ID!,$repoId:ID!,$base:String!){addAssigneesToAssignable(input:{assignableId:$id,assigneeIds:[$botId],agentAssignment:{targetRepositoryId:$repoId,baseRef:$base}}){assignable{... on Issue{number}}}}`,
          "-f", `id=${issueId}`,
          "-f", `botId=${botId}`,
          "-f", `repoId=${repoId}`,
          "-f", `base=${defaultBranch}`
        );
        gh(
          "issue", "comment", String(issue_number),
          "--repo", `${owner}/${repo}`,
          "--body", `[factory-rekick] Re-triggered Copilot session. Evidence: ${evidence}\n\n@copilot — the PR body MUST include \`Closes #${issue_number}\` so GitHub links the PR to this issue and the factory pipeline can track coverage.`
        );
        return { rekicked: true, issue: issue_number, evidence };
      } catch (err) {
        return { rekicked: false, issue: issue_number, error: String(err) };
      }
    },
  });

  const updatePrBranch = defineTool<{ pr_number: number; reason: string }>("update_pr_branch", {
    description:
      "Rebase a PR branch onto the current default branch. " +
      "Use for: stale-base CI failures (same check green on main), action_required gates " +
      "(re-triggers CI as trusted actor), or CONFLICTING PRs where you want to help before nudging Copilot. " +
      "Returns whether the branch was already up-to-date.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number" },
        reason: { type: "string", description: "Why you're updating the branch" },
      },
      required: ["pr_number", "reason"],
    },
    handler: async ({ pr_number, reason }) => {
      try {
        const output = gh("pr", "update-branch", String(pr_number), "--repo", `${owner}/${repo}`);
        const alreadyUpToDate = output.toLowerCase().includes("already up to date");
        return { updated: true, already_up_to_date: alreadyUpToDate, pr: pr_number, reason };
      } catch (err) {
        return { updated: false, pr: pr_number, error: String(err) };
      }
    },
  });

  const closeIssue = defineTool<{ issue_number: number; reason: string }>("close_issue", {
    description:
      "Close an issue, remove the Copilot SWE agent assignee, and post an explanatory comment. " +
      "Use when get_stale_assignments returns merged_but_open_issues (work was delivered by a " +
      "merged PR that lacked a 'Closes #N' keyword), or when you have verified the issue is " +
      "already satisfied on the default branch. " +
      "The reason parameter is posted as a comment and MUST describe the evidence: " +
      "e.g. 'delivered by PR #1005 (merged 2h ago, see diff) — closing because PR lacked Closes keyword'.",
    parameters: {
      type: "object",
      properties: {
        issue_number: { type: "number", description: "Issue number to close" },
        reason: {
          type: "string",
          description: "Evidence-based reason for closing. Posted as a comment on the issue.",
        },
      },
      required: ["issue_number", "reason"],
    },
    handler: async ({ issue_number, reason }) => {
      const results: { closed: boolean; unassigned: boolean; commented: boolean; error?: string } = {
        closed: false,
        unassigned: false,
        commented: false,
      };

      try {
        // Remove Copilot assignee first so capacity is freed even if close fails
        const issueNodeId = gh(
          "api", `repos/${owner}/${repo}/issues/${issue_number}`,
          "--jq", ".node_id"
        );
        const botId = lookupBotId(owner, repo);
        gh(
          "api", "graphql",
          "-H", `GraphQL-Features: ${COPILOT_GQL_FEATURES}`,
          "-f", `query=mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}`,
          "-f", `id=${issueNodeId}`,
          "-f", `botId=${botId}`
        );
        results.unassigned = true;
      } catch (err) {
        results.error = `unassign failed: ${String(err)}`;
      }

      try {
        gh("issue", "close", String(issue_number), "--repo", `${owner}/${repo}`);
        results.closed = true;
      } catch (err) {
        results.error = (results.error ? results.error + "; " : "") + `close failed: ${String(err)}`;
      }

      try {
        gh(
          "issue", "comment", String(issue_number),
          "--repo", `${owner}/${repo}`,
          "--body", reason
        );
        results.commented = true;
      } catch { /* non-fatal */ }

      return { issue: issue_number, ...results };
    },
  });

  const getCiBaseline = defineTool<{ pr_number: number }>("get_ci_baseline", {
    description:
      "Classify each failing CI check on a PR by comparing against the current default branch. " +
      "Returns four buckets: " +
      "'pre_existing_on_main' — the check is also currently failing on main (do NOT ask Copilot to fix); " +
      "'action_required' — a same-repo PR-layer gate, not a real test failure; " +
      "'cancelled' — a PR-layer irregularity to rerun before any CI nudge; " +
      "'pr_introduced' — a genuinely new failure on this branch. " +
      "CALL THIS before post_review(request_changes) or any CI nudge to avoid blaming Copilot " +
      "for pre-existing main failures or action_required gates. " +
      "Only 'pr_introduced' failures justify asking a PR author to change code.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number", description: "PR number to classify CI checks for" },
      },
      required: ["pr_number"],
    },
    skipPermission: true,
    handler: async ({ pr_number }) => {
      try {
        const { baseline, checkLinks, mainFailingCheckNames, warnings } = getSharedCiBaselineAttribution(pr_number);
        const attribution = Object.entries(baseline.attribution).map(([name, details]) => {
          const link = checkLinks.get(name);
          if (details.is_action_required)
            return { name, classification: "action_required" as const, ...(link ? { link } : {}) };
          if (details.is_cancelled)
            return { name, classification: "cancelled" as const, ...(link ? { link } : {}) };
          if (details.pre_existing_on_main)
            return { name, classification: "pre_existing_on_main" as const, ...(link ? { link } : {}) };
          return { name, classification: "pr_introduced" as const, ...(link ? { link } : {}) };
        });
        const preExisting = attribution.filter((r) => r.classification === "pre_existing_on_main");
        const actionRequired = attribution.filter((r) => r.classification === "action_required");
        const cancelled = attribution.filter((r) => r.classification === "cancelled");
        const prIntroduced = attribution.filter((r) => r.classification === "pr_introduced");

        return {
          pr_number,
          main_failing_check_names: mainFailingCheckNames,
          pre_existing_on_main: preExisting,
          action_required: actionRequired,
          cancelled,
          pr_introduced: prIntroduced,
          guidance: buildCiGuidance(prIntroduced, {
            preExistingOnMain: preExisting,
            actionRequired,
            cancelled,
          }),
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      } catch {
        return { error: "Could not fetch PR checks — cannot classify CI baseline" };
      }
    },
  });

  // ── CI baseline attribution ──────────────────────────────────────────────

  const getCiBaselineAttribution = defineTool<{
    pr_number: number;
  }>("get_ci_baseline_attribution", {
    description:
      "Classify each failing or action_required check on a PR as: (1) pre-existing on the " +
      "default branch (suppress branch-fix nudges), (2) a PR-layer action_required gate " +
      "(needs trusted rerun, not a code fix), or (3) a genuine PR-introduced failure " +
      "(normal remediation path). " +
      "Call this BEFORE posting review comments or opening incident tickets about CI failures " +
      "so the factory does not ask Copilot branches to fix baseline main failures. " +
      "Returns per-check attribution and a summary breakdown.",
    parameters: {
      type: "object",
      properties: {
        pr_number: { type: "number", description: "PR number whose CI checks to classify" },
      },
      required: ["pr_number"],
    },
    skipPermission: true,
    handler: async ({ pr_number }) => {
      try {
        const { baseline, warnings } = getSharedCiBaselineAttribution(pr_number);
        return warnings.length > 0 ? { ...baseline, warnings } : baseline;
      } catch (err) {
        return { error: `Could not fetch PR #${pr_number} check results: ${String(err)}` };
      }
    },
  });

  return [
    getPrTriage,
    getPrInvestigation,
    getCiBaseline,
    getCiBaselineAttribution,
    getStaleAssignments,
    mergePr,
    postReview,
    assignToCopilot,
    rekickAssignment,
    updatePrBranch,
    closeIssue,
  ];
}
