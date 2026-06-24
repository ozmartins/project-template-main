import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

type YamlDocument = Record<string, unknown>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/pr-trusted-rerun.yml");

function loadWorkflow(): { raw: string; parsed: YamlDocument } {
  const raw = readFileSync(WORKFLOW_PATH, "utf8");
  const parsed = yaml.load(raw);
  expect(parsed).toBeTruthy();
  return { raw, parsed: parsed as YamlDocument };
}

describe("pr-trusted-rerun workflow contract", () => {
  it("stays manual-only and scoped to the requested PR number", () => {
    const { parsed } = loadWorkflow();
    const on = parsed["on"] as YamlDocument;
    const dispatch = on["workflow_dispatch"] as YamlDocument;
    const inputs = dispatch["inputs"] as YamlDocument;
    const prNumber = inputs["pull_request_number"] as YamlDocument;
    const concurrency = parsed["concurrency"] as YamlDocument;

    expect(Object.keys(on)).toEqual(["workflow_dispatch"]);
    expect(prNumber["required"]).toBe(true);
    expect(prNumber["type"]).toBe("number");
    expect(concurrency["group"]).toBe("pr-trusted-rerun-${{ inputs.pull_request_number }}");
    expect(concurrency["cancel-in-progress"]).toBe(false);
  });

  it("uses least-privilege github.token access and the workflow rerun API", () => {
    const { parsed, raw } = loadWorkflow();
    const permissions = parsed["permissions"] as YamlDocument;
    const jobs = parsed["jobs"] as YamlDocument;
    const rerunJob = jobs["rerun"] as YamlDocument;
    const steps = rerunJob["steps"] as YamlDocument[];
    const rerunStep = steps.find((step) => step["id"] === "rerun") as YamlDocument | undefined;
    const summaryStep = steps.find(
      (step) => step["name"] === "Summarise rerun request"
    ) as YamlDocument | undefined;

    expect(permissions).toEqual({
      actions: "write",
      contents: "read",
      "pull-requests": "read",
    });
    expect(rerunStep?.["uses"]).toBe("actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3");
    expect(raw).toContain('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun');
    expect(raw).toContain("this backstop only handles same-repo PRs");
    expect(raw).not.toContain("secrets.PROJECT_MANAGER_PAT");
    expect(summaryStep?.["if"]).toBe("always()");
    expect(summaryStep?.["run"]).toContain("$GITHUB_STEP_SUMMARY");
    expect(summaryStep?.["run"]).toContain("Trusted rerun for Copilot gate");
  });
});
