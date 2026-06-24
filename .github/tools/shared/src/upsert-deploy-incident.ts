#!/usr/bin/env node
/**
 * upsert-deploy-incident.ts
 *
 * Pre-deduplication step for the monitor-deploy workflow.
 *
 * Given a failed GitHub Actions workflow run, this script:
 *  1. Maps the workflow name to a stable family fingerprint ID.
 *  2. Lists ALL open `auto:deploy` issues (up to 500) using the LIST API
 *     (not search, which lags and strips HTML-comment punctuation).
 *  3. Finds the OLDEST open `auto:deploy` incident that matches the current
 *     failure family — first by stable fingerprint in the body, then by
 *     title-keyword fallback (for issues created before this script existed).
 *  4a. If an existing incident is found: adds a "still failing" comment
 *      (embedding the stable fingerprint so future runs match on fingerprint),
 *      then prints `issue_number=<N>` to stdout so the workflow can skip the
 *      full deploy-sentinel agent invocation.
 *  4b. If no existing incident is found: prints `issue_number=` (empty) and
 *      exits 0 so the workflow proceeds to the deploy-sentinel agent, which
 *      performs root-cause analysis and creates the first incident.
 *
 * Environment variables (required):
 *   FAILED_WORKFLOW     – display name of the failed workflow run
 *   FAILED_RUN_URL      – HTML URL of the failed run (for the comment body)
 *   GH_TOKEN            – GitHub token with `issues: write` permission
 *   GITHUB_REPOSITORY   – "owner/repo" string
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deployFamilyFingerprintId,
  fingerprintComment,
} from "./dedupe.js";

// ---------------------------------------------------------------------------
// Helpers (exported so tests can import the real implementation)
// ---------------------------------------------------------------------------

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

export function titleKeywordsForWorkflow(workflowName: string): string[] {
  const lower = workflowName.toLowerCase();
  if (lower.includes("deploy") && lower.includes("dev")) {
    return ["Deploy Dev", "deploy dev", "Deploy - Dev"];
  }
  if (lower.includes("e2e") || (lower.includes("test") && lower.includes("dev"))) {
    return ["E2E dev", "e2e dev", "E2E smoke", "Test - E2E"];
  }
  return [workflowName];
}

export interface Issue {
  number: number;
  title: string;
  body: string;
}

export function findOldestMatch(
  issues: Issue[],
  stableFpComment: string,
  titleKeywords: string[],
): Issue | null {
  // Primary: exact stable fingerprint comment in body
  const byFp = issues.filter((i) => i.body.includes(stableFpComment));
  if (byFp.length > 0) {
    return byFp.reduce((a, b) => (a.number < b.number ? a : b));
  }

  // Fallback: title keyword matching (handles agent-created issues that
  // predate this script and may carry a different fingerprint string)
  const lower = titleKeywords.map((k) => k.toLowerCase());
  const byTitle = issues.filter((i) =>
    lower.some((kw) => i.title.toLowerCase().includes(kw)),
  );
  if (byTitle.length > 0) {
    return byTitle.reduce((a, b) => (a.number < b.number ? a : b));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main (guarded so the module can be imported without side effects)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const failedWorkflow = process.env.FAILED_WORKFLOW ?? "";
  const failedRunUrl = process.env.FAILED_RUN_URL ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";

  if (!failedWorkflow || !repo) {
    console.error(
      "upsert-deploy-incident: FAILED_WORKFLOW and GITHUB_REPOSITORY must be set",
    );
    process.exit(1);
  }

  const familyId = deployFamilyFingerprintId(failedWorkflow);
  const stableFingerprintComment = fingerprintComment(familyId);
  const titleKeywords = titleKeywordsForWorkflow(failedWorkflow);

  // Use the LIST API (strongly consistent) with a high limit so we never miss
  // an existing incident due to truncation.
  const raw = gh(
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--label",
    "auto:deploy",
    "--limit",
    "500",
    "--json",
    "number,title,body",
  );

  let issues: Issue[] = [];
  try {
    issues = JSON.parse(raw) as Issue[];
  } catch {
    console.error("upsert-deploy-incident: failed to parse issue list JSON");
    process.exit(1);
  }

  const existing = findOldestMatch(issues, stableFingerprintComment, titleKeywords);

  if (!existing) {
    // No existing incident — let the deploy-sentinel agent run
    console.log("issue_number=");
    process.exit(0);
  }

  // Existing incident found — add a "still failing" comment that embeds the
  // stable fingerprint so future invocations match on fingerprint, not title.
  const commentBody = [
    `Still failing as of ${failedRunUrl || "(no run URL)"}`,
    "",
    `Failure family: **${failedWorkflow}**`,
    "",
    stableFingerprintComment,
  ].join("\n");

  const tmpFile = join(tmpdir(), `deploy-comment-${randomBytes(16).toString("hex")}.txt`);
  try {
    writeFileSync(tmpFile, commentBody, "utf8");
    gh("issue", "comment", String(existing.number), "--repo", repo, "--body-file", tmpFile);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`upsert-deploy-incident: failed to clean up temp file ${tmpFile}: ${code}`);
      }
    }
  }
  console.log(`issue_number=${existing.number}`);
}
