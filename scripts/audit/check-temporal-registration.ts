/**
 * Audit: every Temporal activity module in temporal/src/activities/ is imported
 * in the worker entry point.
 *
 * The TypeScript worker registers workflows via `workflowsPath` (entire directory)
 * so those are always covered. Activities are registered by importing each module
 * and spreading it into the Worker's activities map. A new activity file that is
 * never imported in worker.ts will silently not run.
 *
 * Heuristic: for each *.ts file in temporal/src/activities/ (excluding index.ts),
 * check that its basename (without extension) appears in an import statement inside
 * temporal/src/worker.ts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CheckResult, Finding } from "./common.js";
import { repoRoot } from "./common.js";

export function findUnregisteredActivities(temporalSrc: string): Finding[] {
  const activitiesDir = join(temporalSrc, "activities");
  const workerPath = join(temporalSrc, "worker.ts");

  if (!existsSync(activitiesDir) || !existsSync(workerPath)) return [];

  const workerText = readFileSync(workerPath, "utf-8");
  const findings: Finding[] = [];

  const activityFiles = readdirSync(activitiesDir)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .sort();

  for (const file of activityFiles) {
    const moduleName = basename(file, ".ts");
    // Check that the module is imported in worker.ts (import ... from '.../activities/moduleName')
    const importPattern = new RegExp(`from\\s+['"].*activities/${moduleName}['"]`, "m");
    if (!importPattern.test(workerText)) {
      findings.push({
        check: "temporal-registration",
        severity: "HIGH",
        location: "temporal/src/worker.ts",
        message: `Activity module \`${file}\` exists in temporal/src/activities/ but is not imported in worker.ts — its activities cannot run.`,
        issue: "#269",
      });
    }
  }

  return findings;
}

export function run(root?: string): CheckResult {
  const r = root ?? repoRoot();
  return {
    name: "temporal-registration",
    findings: findUnregisteredActivities(join(r, "temporal", "src")),
  };
}
