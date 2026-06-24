import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

type YamlDocument = Record<string, unknown>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/pipeline-fast.yml");

function loadWorkflow(): { raw: string; parsed: YamlDocument } {
  const raw = readFileSync(WORKFLOW_PATH, "utf8");
  const parsed = yaml.load(raw);
  expect(parsed).toBeTruthy();
  return { raw, parsed: parsed as YamlDocument };
}

describe("pipeline-fast workflow contract", () => {
  it("keeps Stage 2 split so assignment still runs independently with the intended budget", () => {
    const { parsed } = loadWorkflow();
    const jobs = parsed["jobs"] as YamlDocument;
    const pipeline = jobs["pipeline"] as YamlDocument;
    const steps = pipeline["steps"] as YamlDocument[];

    const prPipeline = steps.find((step) => step["id"] === "pr_pipeline");
    const prSummary = steps.find((step) => step["name"] === "Summarise — PR Handler loop");
    const assignment = steps.find((step) => step["id"] === "assignment");
    const assignmentSummary = steps.find((step) => step["name"] === "Summarise — Project Manager");

    expect(prPipeline?.["name"]).toBe("Stage 2 — PR Handler (per-PR review + merge loop)");
    expect(prPipeline?.["timeout-minutes"]).toBe(22);
    expect(prPipeline?.["run"]).toBe("npx tsx src/run-pr-pipeline.ts");
    expect((prPipeline?.["env"] as YamlDocument)["PR_PIPELINE_BUDGET_MIN"]).toBe("22");
    expect((prPipeline?.["env"] as YamlDocument)["PR_HANDLER_TIMEOUT_MIN"]).toBe("5");
    expect(prSummary?.["run"]).toContain("| 2 — PR review + merge | pr-handler (per-PR loop) | $STATUS |");

    expect(assignment?.["name"]).toBe("Stage 4 — Project Manager (assign new work)");
    expect(assignment?.["if"]).toBe("always()");
    expect(assignment?.["timeout-minutes"]).toBe(10);
    expect(assignment?.["run"]).toBe("npx tsx src/run-assignment.ts");
    expect((assignment?.["env"] as YamlDocument)["ASSIGN_TIMEOUT_MIN"]).toBe("7");
    expect(assignmentSummary?.["run"]).toContain("| 4 — stale cleanup + assign | project-manager | $STATUS |");
  });

  it("documents the linked-PR stale cleanup contract without reintroducing removed label semantics", () => {
    const { raw } = loadWorkflow();

    expect(raw).toContain("Runs whether or not Stage 2 succeeded.");
    expect(raw).not.toContain("assigned-to-copilot");
    expect(raw).not.toContain(">4h");
  });

  it("includes Stage 1b conflict refresh scan before the PR handler loop (ADR-0113)", () => {
    const { parsed } = loadWorkflow();
    const jobs = parsed["jobs"] as YamlDocument;
    const pipeline = jobs["pipeline"] as YamlDocument;
    const steps = pipeline["steps"] as YamlDocument[];

    const conflictScan = steps.find((step) => step["id"] === "conflict_scan");
    const conflictSummary = steps.find(
      (step) => step["name"] === "Summarise — Conflict refresh scan",
    );

    // Stage 1b must exist and run scan-conflict-refresh.ts
    expect(conflictScan).toBeTruthy();
    expect(conflictScan?.["name"]).toBe(
      "Stage 1b — Conflict refresh scan (detect CONFLICTING Copilot PRs)",
    );
    expect(conflictScan?.["run"]).toBe("npx tsx src/scan-conflict-refresh.ts");
    expect(conflictScan?.["continue-on-error"]).toBe(true);
    expect(conflictScan?.["timeout-minutes"]).toBe(5);

    // Stage 1b must appear before Stage 2 (pr_pipeline)
    const conflictScanIndex = steps.indexOf(conflictScan!);
    const prPipelineIndex = steps.findIndex((step) => step["id"] === "pr_pipeline");
    expect(conflictScanIndex).toBeGreaterThanOrEqual(0);
    expect(prPipelineIndex).toBeGreaterThan(conflictScanIndex);

    // Summary step must record the scan outcome
    expect(conflictSummary?.["run"]).toContain(
      "| 1b — conflict refresh scan | scan-conflict-refresh (code) | $STATUS |",
    );
  });
});
