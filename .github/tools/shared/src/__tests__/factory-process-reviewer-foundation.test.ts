import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadAgent } from "../agent-loader.js";

type YamlDocument = Record<string, unknown>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const AGENTS_PATH = join(REPO_ROOT, ".github", "agents");
const PIPELINE_DAILY_PATH = join(REPO_ROOT, ".github", "workflows", "pipeline-daily.yml");
const BOOTSTRAP_LABELS_PATH = join(REPO_ROOT, "scripts", "bootstrap-labels.sh");

function loadYamlFile(path: string): YamlDocument {
  const parsed = yaml.load(readFileSync(path, "utf8"));
  expect(parsed).toBeTruthy();
  return parsed as YamlDocument;
}

describe("factory process reviewer foundations", () => {
  it("keeps auto:process bootstrap wiring", () => {
    const script = readFileSync(BOOTSTRAP_LABELS_PATH, "utf8");
    expect(script).toContain('create_label "auto:process"');
    expect(script).toContain("Factory process pattern roll-up from nightly PR review");
  });

  it("loads the agent prompt with expected guardrails", () => {
    const agent = loadAgent(AGENTS_PATH, "factory-process-reviewer");
    const agentPath = join(AGENTS_PATH, "factory-process-reviewer.agent.md");
    const content = readFileSync(agentPath, "utf8");

    expect(agent.frontmatter.name).toBe("factory-process-reviewer");
    expect(agent.frontmatter.tools).toEqual(["gh"]);
    expect(agent.body).toContain("pattern analysis");
    expect(agent.body).toContain("file per-PR process issues");
    expect(agent.body).toContain("Max 2 new rules per run");
    expect(agent.body).toContain("no changes needed");
    expect(agent.body).toContain('gh run rerun <run-id> --repo {{ owner }}/{{ repo }}');
    // Regression signal: no-diff Copilot PR guardrail (ADR-0115) must be in the monitored categories
    expect(agent.body).toContain("[factory-reconciliation-guard]");
    expect(content.length).toBeLessThan(8000);
  });

  it("keeps the daily pipeline read-only and isolates reviewer write access", () => {
    const workflow = loadYamlFile(PIPELINE_DAILY_PATH);
    const jobs = workflow["jobs"] as YamlDocument;
    const pipeline = jobs["pipeline"] as YamlDocument;
    const pipelinePermissions = pipeline["permissions"] as YamlDocument;
    const pipelineSteps = pipeline["steps"] as YamlDocument[];
    const reviewerJob = jobs["factory_process_reviewer"] as YamlDocument;
    const reviewerPermissions = reviewerJob["permissions"] as YamlDocument;
    const reviewerSteps = reviewerJob["steps"] as YamlDocument[];

    expect(workflow["permissions"]).toEqual({});
    expect(pipelinePermissions["contents"]).toBe("read");
    expect(reviewerPermissions["contents"]).toBe("write");
    expect(reviewerJob["needs"]).toBe("pipeline");
    expect(reviewerJob["if"]).toBe("${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}");

    const docsStage = pipelineSteps.find((step) => step["id"] === "docs_improver");
    const userStageIndex = pipelineSteps.findIndex((step) => step["id"] === "user_docs_manager");
    const processStageIndex = reviewerSteps.findIndex((step) => step["id"] === "factory_process_reviewer");

    expect((docsStage?.["env"] as YamlDocument)["GH_TOKEN"]).toBe("${{ github.token }}");
    expect(userStageIndex).toBeGreaterThanOrEqual(0);
    expect((pipelineSteps[userStageIndex]?.["env"] as YamlDocument)["GH_TOKEN"]).toBe("${{ github.token }}");
    expect(processStageIndex).toBeGreaterThanOrEqual(0);

    const processStage = reviewerSteps[processStageIndex];
    expect(processStage["name"]).toBe("Stage — Factory Process Reviewer");
    expect(processStage["continue-on-error"]).toBe(true);
    expect(processStage["working-directory"]).toBe(".github/tools/shared");
    expect(processStage["run"]).toBe("npx tsx src/run-agent.ts --agent factory-process-reviewer");
    expect((processStage["env"] as YamlDocument)["GH_TOKEN"]).toBe("${{ secrets.PROJECT_MANAGER_PAT }}");

    const summaryStep = reviewerSteps.find((step) => step["name"] === "Summarise — Factory Process Reviewer");
    expect(summaryStep).toBeTruthy();
    expect(summaryStep?.["run"]).toContain("| factory-process-reviewer |");
  });
});
