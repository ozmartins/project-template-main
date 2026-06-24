import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

type YamlDocument = Record<string, unknown>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/pipeline-weekly-diary.yml");

function loadWorkflow(): { raw: string; parsed: YamlDocument } {
  const raw = readFileSync(WORKFLOW_PATH, "utf8");
  const parsed = yaml.load(raw);
  expect(parsed).toBeTruthy();
  return { raw, parsed: parsed as YamlDocument };
}

describe("pipeline-weekly-diary workflow contract", () => {
  it("keeps the documented Friday cadence and dedicated concurrency group", () => {
    const { parsed } = loadWorkflow();
    const on = parsed["on"] as YamlDocument;
    const schedule = on["schedule"] as YamlDocument[];
    const concurrency = parsed["concurrency"] as YamlDocument;

    expect(Array.isArray(schedule)).toBe(true);
    expect(schedule.length).toBeGreaterThan(0);
    expect((schedule[0] as YamlDocument)["cron"]).toBe("0 18 * * 5");
    expect(Object.prototype.hasOwnProperty.call(on, "workflow_dispatch")).toBe(true);
    expect(concurrency["group"]).toBe("pipeline-weekly-diary");
    expect(concurrency["cancel-in-progress"]).toBe(false);
  });

  it("keeps least-privilege runtime identity and stage summary output", () => {
    const { parsed, raw } = loadWorkflow();
    const permissions = parsed["permissions"] as YamlDocument;
    const jobs = parsed["jobs"] as YamlDocument;
    const pipeline = jobs["pipeline"] as YamlDocument;
    const steps = pipeline["steps"] as YamlDocument[];
    const stage = steps.find((step) => step["id"] === "diary_agent") as YamlDocument | undefined;
    const summary = steps.find(
      (step) => step["name"] === "Summarise — Diary Agent"
    ) as YamlDocument | undefined;
    expect(stage).toBeTruthy();
    expect(summary).toBeTruthy();
    const stageEnv = stage?.["env"] as YamlDocument;

    expect(permissions).toEqual({
      contents: "write",
      issues: "read",
      "pull-requests": "read",
    });
    expect(stageEnv["GH_TOKEN"]).toBe("${{ github.token }}");
    expect(stageEnv["COPILOT_GITHUB_TOKEN"]).toBe("${{ secrets.COPILOT_TOKEN }}");
    expect(stageEnv["PROJECT_MANAGER_PAT"]).toBeUndefined();
    expect(raw).not.toContain("secrets.PROJECT_MANAGER_PAT");

    expect(summary?.["if"]).toBe("always()");
    expect(summary?.["run"]).toContain('| diary-agent | $STATUS |');
    expect(summary?.["run"]).toContain("$GITHUB_STEP_SUMMARY");
  });

  it("keeps diary writes scoped to docs/diary and avoids issue-filing mutations", () => {
    const { raw } = loadWorkflow();

    expect(raw).toContain("writes docs/diary/YYYY-WXX.md");
    expect(raw).toContain("never files issues");
    expect(raw).toContain("npx tsx src/run-agent.ts --agent diary-agent");
    expect(raw).not.toContain("gh issue");
    expect(raw).not.toContain("src/run-pr-pipeline.ts");
    expect(raw).not.toContain("src/run-assignment.ts");
  });
});
