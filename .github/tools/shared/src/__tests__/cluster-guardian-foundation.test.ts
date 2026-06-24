import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

type YamlDocument = Record<string, unknown>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");

const FACTORY_CONFIG_PATH = join(REPO_ROOT, ".github/factory.yml");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/pipeline-hourly.yml");
const AGENT_PROMPT_PATH = join(REPO_ROOT, ".github/agents/cluster-guardian.agent.md");
const REMEDIATOR_PROMPT_PATH = join(REPO_ROOT, ".github/agents/cluster-remediator.agent.md");

function loadYamlFile(path: string): YamlDocument {
  const parsed = yaml.load(readFileSync(path, "utf8"));
  expect(parsed).toBeTruthy();
  return parsed as YamlDocument;
}

describe("cluster guardian foundations", () => {
  it("enables kubernetes-app and defines <NAMESPACE_PREFIX>* namespace scope in factory config", () => {
    const config = loadYamlFile(FACTORY_CONFIG_PATH);
    const stack = config["stack"] as YamlDocument;
    const profiles = stack["deployment_profiles"] as string[];
    const guardian = config["cluster_guardian"] as YamlDocument;
    const allowedNamespaces = guardian["allowed_namespaces"] as string[];
    const runnerLabels = ((config["runners"] as YamlDocument)["self_hosted"] as YamlDocument)[
      "cluster_guardian"
    ] as string[];

    expect(profiles).toContain("kubernetes-app");
    expect(allowedNamespaces).toEqual(["<NAMESPACE_PREFIX>-dev", "<NAMESPACE_PREFIX>-test"]);
    expect(runnerLabels).toContain("factory-cluster-guardian");
  });

  it("runs cluster guardian as an isolated hourly stage", () => {
    const workflow = loadYamlFile(WORKFLOW_PATH);
    const jobs = workflow["jobs"] as YamlDocument;
    const pipeline = jobs["hourly_readonly_stages"] as YamlDocument;
    const steps = pipeline["steps"] as YamlDocument[];
    const clusterGuardianStep = steps.find((step) => step["id"] === "cluster_guardian");

    expect(workflow["name"]).toBe("Pipeline - Hourly");
    expect(pipeline["runs-on"]).toBe("ubuntu-latest");
    expect(clusterGuardianStep?.["continue-on-error"]).toBe(true);
    expect(clusterGuardianStep?.["timeout-minutes"]).toBe(18);
    expect(clusterGuardianStep?.["working-directory"]).toBe(".github/tools/shared");
    expect(clusterGuardianStep?.["run"]).toBe("npx tsx src/run-agent.ts --agent cluster-guardian");
  });

  it("keeps scheduled guardian prompt read-only and isolates mutating guidance to remediator", () => {
    const prompt = readFileSync(AGENT_PROMPT_PATH, "utf8");
    const remediatorPrompt = readFileSync(REMEDIATOR_PROMPT_PATH, "utf8");

    expect(prompt).toContain("Supabase self-hosted");
    expect(prompt).toContain("Temporal Python worker");
    expect(prompt).toContain("Vite frontend");
    expect(prompt).toContain("Do not copy signatures from `other repositories`");
    expect(prompt).toContain("Detection-only mode");
    expect(prompt).toContain("No Helm rollback.");
    expect(prompt).toContain("No pod force-delete.");
    expect(prompt).toContain("No scale actions (up or down).");
    expect(prompt).toContain("fingerprint-cli.ts");
    expect(prompt).toContain("search before create");

    expect(remediatorPrompt).toContain("Roll back a Helm release");
    expect(remediatorPrompt).toContain("Force-delete a clearly stuck `Terminating` pod");
    expect(remediatorPrompt).toContain("Scale a crashlooping deployment **down to 0 only**");
    expect(remediatorPrompt).toContain("No scale-up actions.");
  });
});
