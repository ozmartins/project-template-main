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
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "pipeline-nightly-devdocs.yml");
const DEV_DOCS_INDEX_PATH = join(REPO_ROOT, "docs", "developer", "README.md");

function loadYamlFile(path: string): YamlDocument {
  const parsed = yaml.load(readFileSync(path, "utf8"));
  expect(parsed).toBeTruthy();
  return parsed as YamlDocument;
}

describe("developer docs lane foundations", () => {
  it("keeps developer-docs-manager prompt contract for bootstrap and steady-state", () => {
    const agent = loadAgent(AGENTS_PATH, "developer-docs-manager");
    const agentPath = join(AGENTS_PATH, "developer-docs-manager.agent.md");
    const content = readFileSync(agentPath, "utf8");

    expect(agent.frontmatter.name).toBe("developer-docs-manager");
    expect(agent.frontmatter.tools).toEqual(["gh"]);

    expect(agent.body).toContain("getting-started");
    expect(agent.body).toContain("deployment");
    expect(agent.body).toContain("security-and-quality");
    expect(agent.body).toContain("Docker Desktop local, Azure AKS, and AWS EKS");
    expect(agent.body).toContain("frontend/src/");
    expect(agent.body).toContain("temporal/");
    expect(agent.body).toContain("supabase/migrations/");
    expect(agent.body).toContain("charts/");
    expect(agent.body).toContain("terraform/");
    expect(agent.body).toContain("documentation");
    expect(agent.body).toContain("queue:docs");
    expect(agent.body).toContain("developer-docs");
    expect(agent.body).toContain("<!-- fingerprint:developer-docs-<area> -->");
    expect(content.length).toBeLessThan(6000);
  });

  it("keeps nightly dev-docs workflow schedule and stage wiring", () => {
    const workflow = loadYamlFile(WORKFLOW_PATH);

    const on = workflow["on"] as YamlDocument;
    const schedule = on["schedule"] as Array<YamlDocument>;
    expect(schedule[0]?.["cron"]).toBe("0 22 * * *");
    expect(on).toHaveProperty("workflow_dispatch");

    const jobs = workflow["jobs"] as YamlDocument;
    const pipeline = jobs["pipeline"] as YamlDocument;
    const steps = pipeline["steps"] as YamlDocument[];

    const stage = steps.find((step) => step["id"] === "developer_docs_manager");
    expect(stage).toBeTruthy();
    expect(stage?.["name"]).toBe("Stage — Developer Docs Manager");
    expect(stage?.["run"]).toBe("npx tsx src/run-agent.ts --agent developer-docs-manager");

    const summary = steps.find((step) => step["name"] === "Summarise — Developer Docs Manager");
    expect(summary).toBeTruthy();
    expect(summary?.["run"]).toContain("| developer-docs-manager |");
  });

  it("keeps docs/developer index at 11 guide areas", () => {
    const index = readFileSync(DEV_DOCS_INDEX_PATH, "utf8");
    const rows = index
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .filter((line) => !line.startsWith("| Area |") && !line.startsWith("|---|"));

    expect(rows).toHaveLength(11);
  });
});
