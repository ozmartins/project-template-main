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

describe("user docs lane foundations", () => {
  it("keeps user-docs label in bootstrap wiring", () => {
    const script = readFileSync(BOOTSTRAP_LABELS_PATH, "utf8");
    expect(script).toContain('create_label "user-docs"');
    expect(script).toContain("User Docs Manager");
  });

  it("keeps docs-improver and user-docs-manager prompt boundaries", () => {
    const docsImprover = loadAgent(AGENTS_PATH, "docs-improver");
    const userDocsManager = loadAgent(AGENTS_PATH, "user-docs-manager");
    const userDocsPath = join(AGENTS_PATH, "user-docs-manager.agent.md");
    const userDocsContent = readFileSync(userDocsPath, "utf8");

    expect(docsImprover.body).toContain("Stay out of the user-docs lane");
    expect(docsImprover.body).toContain("Ignore any issue labelled `user-docs`");

    expect(userDocsManager.frontmatter.name).toBe("user-docs-manager");
    expect(userDocsManager.frontmatter.tools).toEqual(["gh"]);
    expect(userDocsManager.body).toContain("ignore any `queue:docs` issue **without** the `user-docs` label");
    expect(userDocsManager.body).toContain("No live-environment / `az` / `kubectl` checks.");
    expect(userDocsManager.body).toContain("Up to **3** new tickets per run during initial backlog; **1/run**");
    expect(userDocsContent.length).toBeLessThan(6000);
  });

  it("keeps pipeline-daily stage order and wiring for user-docs-manager", () => {
    const workflow = loadYamlFile(PIPELINE_DAILY_PATH);
    const jobs = workflow["jobs"] as YamlDocument;
    const pipeline = jobs["pipeline"] as YamlDocument;
    const steps = pipeline["steps"] as YamlDocument[];

    const docsStageIndex = steps.findIndex((step) => step["id"] === "docs_improver");
    const userStageIndex = steps.findIndex((step) => step["id"] === "user_docs_manager");

    expect(docsStageIndex).toBeGreaterThanOrEqual(0);
    expect(userStageIndex).toBeGreaterThan(docsStageIndex);

    const userStage = steps[userStageIndex];
    expect(userStage["name"]).toBe("Stage — User Docs Manager");
    expect(userStage["continue-on-error"]).toBe(true);
    expect(userStage["working-directory"]).toBe(".github/tools/shared");
    expect(userStage["run"]).toBe("npx tsx src/run-agent.ts --agent user-docs-manager");

    const summaryStep = steps.find((step) => step["name"] === "Summarise — User Docs Manager");
    expect(summaryStep).toBeTruthy();
    expect(summaryStep?.["run"]).toContain("| user-docs-manager |");
  });
});
