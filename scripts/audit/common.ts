/**
 * Shared Finding type, CheckResult, and reporting helpers for architecture-audit checks.
 */
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Finding {
  check: string;
  /** CRITICAL | HIGH | MEDIUM | LOW */
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  /** file path or file:line */
  location: string;
  message: string;
  /** related tracking issue, e.g. "#269" */
  issue?: string;
}

export interface CheckResult {
  name: string;
  findings: Finding[];
}

/** Resolve the repository root from this file's location (scripts/audit/ is two levels down). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function renderMarkdown(results: CheckResult[]): string {
  const lines: string[] = ["## Architecture Audit", ""];
  const total = results.reduce((sum, r) => sum + r.findings.length, 0);

  if (total === 0) {
    lines.push("✅ No findings — all checks clean.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Found **${total}** finding(s) across ${results.length} check(s).`);
  lines.push("");
  lines.push("| Check | Severity | Location | Finding | Issue |");
  lines.push("|---|---|---|---|---|");

  for (const result of results) {
    const sorted = [...result.findings].sort((a, b) => a.severity.localeCompare(b.severity));
    for (const f of sorted) {
      const msg = f.message.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      lines.push(`| ${f.check} | ${f.severity} | \`${f.location}\` | ${msg} | ${f.issue ?? ""} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/** Print the markdown report to stdout and append to $GITHUB_STEP_SUMMARY when present. */
export function emit(results: CheckResult[]): void {
  const report = renderMarkdown(results);
  process.stdout.write(report);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, report, "utf-8");
  }
}
