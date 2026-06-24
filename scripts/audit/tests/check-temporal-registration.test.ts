import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { findUnregisteredActivities, run } from "../check-temporal-registration.js";

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

describe("check-temporal-registration", () => {
  it("flags activity modules that are not imported in worker.ts", () => {
    const root = makeTempDir("temporal-registration-");
    const temporalSrc = join(root, "temporal", "src");
    const activitiesDir = join(temporalSrc, "activities");
    mkdirSync(activitiesDir, { recursive: true });

    writeFileSync(join(activitiesDir, "index.ts"), "export * from './email-send';\n", "utf-8");
    writeFileSync(join(activitiesDir, "email-send.ts"), "export const run = () => null;\n", "utf-8");
    writeFileSync(join(activitiesDir, "notify.ts"), "export const notify = () => null;\n", "utf-8");
    writeFileSync(
      join(temporalSrc, "worker.ts"),
      "import * as emailSend from './activities/email-send';\nexport const activities = { ...emailSend };\n",
      "utf-8"
    );

    const findings = findUnregisteredActivities(temporalSrc);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, "temporal-registration");
    assert.equal(findings[0].severity, "HIGH");
    assert.match(findings[0].message, /notify\.ts/);

    const result = run(root);
    assert.equal(result.name, "temporal-registration");
    assert.equal(result.findings.length, 1);
  });

  it("returns no findings when all activity modules are imported", () => {
    const root = makeTempDir("temporal-registration-clean-");
    const temporalSrc = join(root, "temporal", "src");
    const activitiesDir = join(temporalSrc, "activities");
    mkdirSync(activitiesDir, { recursive: true });

    writeFileSync(join(activitiesDir, "billing.ts"), "export const bill = () => null;\n", "utf-8");
    writeFileSync(
      join(temporalSrc, "worker.ts"),
      "import * as billing from './activities/billing';\nexport const activities = { ...billing };\n",
      "utf-8"
    );

    assert.deepEqual(findUnregisteredActivities(temporalSrc), []);
  });

  it("does not flag index.ts files inside the activities directory", () => {
    const root = makeTempDir("temporal-registration-index-");
    const temporalSrc = join(root, "temporal", "src");
    const activitiesDir = join(temporalSrc, "activities");
    mkdirSync(activitiesDir, { recursive: true });

    // index.ts is a barrel re-export and must be excluded from the check
    writeFileSync(join(activitiesDir, "index.ts"), "export * from './email-send';\n", "utf-8");
    writeFileSync(join(activitiesDir, "email-send.ts"), "export const run = () => null;\n", "utf-8");
    writeFileSync(
      join(temporalSrc, "worker.ts"),
      "import * as emailSend from './activities/email-send';\nexport const activities = { ...emailSend };\n",
      "utf-8"
    );

    assert.deepEqual(findUnregisteredActivities(temporalSrc), []);
  });

  it("returns empty findings when activities directory is absent", () => {
    const root = makeTempDir("temporal-registration-no-dir-");
    const temporalSrc = join(root, "temporal", "src");
    mkdirSync(temporalSrc, { recursive: true });
    writeFileSync(join(temporalSrc, "worker.ts"), "export const worker = {};\n", "utf-8");

    // activities/ does not exist — should not throw
    assert.deepEqual(findUnregisteredActivities(temporalSrc), []);
  });
});
