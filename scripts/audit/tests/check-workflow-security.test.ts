import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, scanWorkflows } from "../check-workflow-security.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-workflow-security", () => {
  it("flags pull_request_target with secrets and write-all permissions", () => {
    const root = makeTempDir("workflow-security-");
    const workflowsDir = join(root, ".github", "workflows");
    mkdirSync(workflowsDir, { recursive: true });

    writeFileSync(
      join(workflowsDir, "unsafe.yml"),
      `on:\n  pull_request_target:\njobs:\n  audit:\n    steps:\n      - run: echo "\${{ secrets.COPILOT_TOKEN }} \${{ secrets.COPILOT_TOKEN }} \${{ secrets.PROJECT_MANAGER_PAT }}"\npermissions: write-all\n`,
      "utf-8"
    );

    const findings = scanWorkflows(workflowsDir);
    assert.equal(findings.length, 2);

    const critical = findings.find((f) => f.severity === "CRITICAL");
    assert.ok(critical);
    assert.equal(critical.location, ".github/workflows/unsafe.yml");
    assert.match(critical.message, /pull_request_target/);
    assert.match(critical.message, /secrets.COPILOT_TOKEN/);
    assert.match(critical.message, /secrets.PROJECT_MANAGER_PAT/);

    const high = findings.find((f) => f.severity === "HIGH");
    assert.ok(high);
    assert.equal(high.location, ".github/workflows/unsafe.yml");
    assert.match(high.message, /permissions: write-all/);

    const result = run(root);
    assert.equal(result.name, "workflow-security");
    assert.equal(result.findings.length, 2);
  });

  it("does not flag secrets usage without pull_request_target", () => {
    const root = makeTempDir("workflow-security-safe-");
    const workflowsDir = join(root, ".github", "workflows");
    mkdirSync(workflowsDir, { recursive: true });

    writeFileSync(
      join(workflowsDir, "safe.yml"),
      `on:\n  pull_request:\njobs:\n  lint:\n    steps:\n      - run: echo "\${{ secrets.COPILOT_TOKEN }}"\npermissions:\n  contents: read\n`,
      "utf-8"
    );

    assert.deepEqual(scanWorkflows(workflowsDir), []);
  });

  it("does not flag pull_request_target with no secrets as CRITICAL", () => {
    const root = makeTempDir("workflow-security-no-secrets-");
    const workflowsDir = join(root, ".github", "workflows");
    mkdirSync(workflowsDir, { recursive: true });

    writeFileSync(
      join(workflowsDir, "no-secrets.yml"),
      `on:
  pull_request_target:
jobs:
  build:
    steps:
      - run: echo "hello"
permissions:
  contents: read
`,
      "utf-8"
    );

    const findings = scanWorkflows(workflowsDir);
    assert.ok(
      findings.every((f) => f.severity !== "CRITICAL"),
      "pull_request_target without secrets must not produce a CRITICAL finding"
    );
  });

  it("flags write-all without pull_request_target as HIGH (independent rule)", () => {
    const root = makeTempDir("workflow-security-write-all-only-");
    const workflowsDir = join(root, ".github", "workflows");
    mkdirSync(workflowsDir, { recursive: true });

    writeFileSync(
      join(workflowsDir, "write-all.yml"),
      `on:
  push:
jobs:
  build:
    steps:
      - run: echo "hello"
permissions: write-all
`,
      "utf-8"
    );

    const findings = scanWorkflows(workflowsDir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "HIGH");
    assert.match(findings[0].message, /write-all/);
  });

  it("returns empty findings when the workflows directory does not exist", () => {
    assert.deepEqual(scanWorkflows("/nonexistent/path/.github/workflows"), []);
  });
});
