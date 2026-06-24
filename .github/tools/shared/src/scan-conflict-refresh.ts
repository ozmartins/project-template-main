#!/usr/bin/env node
/**
 * scan-conflict-refresh.ts — detect open Copilot-authored PRs that are
 * CONFLICTING with main and emit a detection record to the step summary.
 *
 * This module is purely observational (no LLM, no PR comments). It scans
 * all open Copilot PRs, records which ones are CONFLICTING, and writes a
 * visible detection log to $GITHUB_STEP_SUMMARY.
 *
 * The actual conflict nudge is handled by the PR handler loop (Stage 2 of
 * pipeline-fast), which treats CONFLICTING PRs as priority-1 work. Keeping
 * detection and response separate avoids creating a second conflict-resolution
 * flow and satisfies the recording requirement for the 7-day regression check.
 *
 * Detection record schema (per CONFLICTING PR):
 *   number      — PR number
 *   title       — PR title (truncated at 60 chars in summary)
 *   author      — PR author login
 *   detectedAt  — ISO timestamp when this scan ran
 *   action      — what the pipeline will do ("pr-handler will nudge" | "no action — skipped reason")
 */

import { pathToFileURL } from "node:url";
import { getGitHubContext } from "./github-context.js";
import { fetchPrSnapshots, type PrSnapshot } from "./pr-snapshot.js";
import { writeSummary, info } from "./logging.js";

/** Login of the GitHub Copilot coding agent bot. */
export const COPILOT_BOT = "copilot-swe-agent[bot]";

/** A single detected-conflict record, emitted once per CONFLICTING Copilot PR per scan. */
export interface ConflictRecord {
  /** PR number. */
  number: number;
  /** PR title (verbatim, full length). */
  title: string;
  /** PR author login. */
  author: string;
  /** ISO timestamp when this scan detected the CONFLICTING state. */
  detectedAt: string;
  /**
   * What the pipeline will do.
   * "pr-handler will nudge" — the PR handler loop has this as priority-1 work this pass.
   * Any other value is an explicit skip reason.
   */
  action: string;
}

/**
 * Pure function: filter `snapshots` for CONFLICTING Copilot PRs and build
 * detection records. Exported for unit testing without network I/O.
 *
 * @param snapshots - all open PR snapshots
 * @param detectedAt - ISO timestamp to stamp each record with (caller's "now")
 */
export function scanConflictingPrs(snapshots: PrSnapshot[], detectedAt: string): ConflictRecord[] {
  return snapshots
    .filter((s) => s.author === COPILOT_BOT && s.mergeable === "CONFLICTING")
    .map((s) => ({
      number: s.number,
      title: s.title,
      author: s.author,
      detectedAt,
      action: "queued for pr-handler conflict refresh; Stage 2 summary records triggered/skipped outcome",
    }));
}

/**
 * Pure function: build a markdown step-summary for the detection results.
 * Exported for unit testing without I/O.
 *
 * @param records   - conflicts returned by scanConflictingPrs
 * @param detectedAt - ISO timestamp used in the section heading
 * @param totalCopilotPrs - total open Copilot PRs seen (for context)
 */
export function formatConflictSummary(
  records: ConflictRecord[],
  detectedAt: string,
  totalCopilotPrs: number
): string {
  const lines: string[] = [
    `## Conflict refresh scan — ${detectedAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Open Copilot PRs scanned: **${totalCopilotPrs}**`,
    "",
  ];

  if (records.length === 0) {
    lines.push("✅ No open Copilot PRs are currently CONFLICTING.");
  } else {
    lines.push(
      `⚡ **${records.length} Copilot PR(s) detected as CONFLICTING** — queued for priority-1 handling in the PR handler loop.`,
      "",
      "| PR | Title | Detected At | Action |",
      "|----|-------|-------------|--------|",
    );
    for (const r of records) {
      lines.push(
        `| #${r.number} | ${r.title.slice(0, 60)} | ${r.detectedAt.slice(0, 19)}Z | ${r.action} |`,
      );
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const ctx = getGitHubContext();
  const snapshots = fetchPrSnapshots(ctx);
  const detectedAt = new Date().toISOString();

  const copilotPrs = snapshots.filter((s) => s.author === COPILOT_BOT);
  const records = scanConflictingPrs(snapshots, detectedAt);

  info("conflict refresh scan complete", {
    open_prs: snapshots.length,
    open_copilot_prs: copilotPrs.length,
    conflicting: records.length,
    prs: records.map((r) => r.number),
  });

  writeSummary(formatConflictSummary(records, detectedAt, copilotPrs.length));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
