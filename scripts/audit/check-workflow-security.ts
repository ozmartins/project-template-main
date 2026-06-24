/**
 * Audit: GitHub Actions workflows do not expose secrets to fork-influenced runs.
 *
 * Heuristic (textual): flag a workflow that triggers on `pull_request_target`
 * AND references `secrets.` anywhere. Also flag `permissions: write-all`.
 *
 * Blind spot this closes: the security reviewer is label-gated and does not scan
 * .github/workflows/** holistically, so an unsafe pull_request_target-with-secrets
 * pattern can ship in the factory's own workflows (see #274).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, Finding } from "./common.js";
import { repoRoot } from "./common.js";

const PR_TARGET = /^\s*pull_request_target\s*:?/m;
const SECRETS = /secrets\.[A-Za-z_][A-Za-z0-9_]*/g;
const WRITE_ALL = /^\s*permissions:\s*write-all\s*$/m;

export function scanWorkflows(workflowsDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(workflowsDir)) return findings;

  const files = readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    const text = readFileSync(join(workflowsDir, file), "utf-8");
    const rel = `.github/workflows/${file}`;

    if (PR_TARGET.test(text)) {
      const secretMatches = [...text.matchAll(SECRETS)].map((m) => m[0]);
      const uniqueSecrets = [...new Set(secretMatches)].slice(0, 5);
      if (uniqueSecrets.length > 0) {
        findings.push({
          check: "workflow-security",
          severity: "CRITICAL",
          location: rel,
          message: `Uses \`pull_request_target\` AND references secrets (${uniqueSecrets.join(", ")}) — exposes write-scoped creds to fork-influenced runs (prompt-injection-to-write path).`,
          issue: "#274",
        });
      }
    }

    if (WRITE_ALL.test(text)) {
      findings.push({
        check: "workflow-security",
        severity: "HIGH",
        location: rel,
        message: "Grants `permissions: write-all` — use least-privilege explicit scopes instead.",
      });
    }
  }

  return findings;
}

export function run(root?: string): CheckResult {
  const r = root ?? repoRoot();
  return {
    name: "workflow-security",
    findings: scanWorkflows(join(r, ".github", "workflows")),
  };
}
