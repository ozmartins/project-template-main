import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const SCRIPT_PATH = join(REPO_ROOT, ".github/scripts/test-history-record.mjs");

describe("test-history-record parser recovery", () => {
  it("records temporal vitest/jest JSON even with npm stdout preamble", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-history-record-"));
    const resultsPath = join(tempDir, "temporal-results.json");

    writeFileSync(
      resultsPath,
      `\n> temporal@1.0.0 test\n> jest --json --outputFile=temporal-results.json\n\n${JSON.stringify({
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        numTodoTests: 0,
        startTime: 1730476800000,
        testResults: [
          {
            name: "temporal/tests/example.test.ts",
            assertionResults: [
              { fullName: "suite passes", status: "passed", duration: 12 },
              { fullName: "suite fails", status: "failed", duration: 8 },
            ],
          },
        ],
      })}`
    );

    const result = spawnSync(
      "node",
      [SCRIPT_PATH, "--suite", "temporal", "--format", "vitest", "--results", resultsPath],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );

    rmSync(tempDir, { recursive: true, force: true });

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record.suite).toBe("temporal");
    expect(record.outcome).toBe("failed");
    expect(record.stats).toMatchObject({
      expected: 1,
      unexpected: 1,
      flaky: 0,
      skipped: 0,
      total: 2,
      duration_ms: 20,
    });
    expect(record.pass_rate).toBe(0.5);
    expect(record.tests).toEqual([
      expect.objectContaining({
        title: "suite passes",
        file: "temporal/tests/example.test.ts",
        status: "passed",
      }),
      expect.objectContaining({
        title: "suite fails",
        file: "temporal/tests/example.test.ts",
        status: "failed",
      }),
    ]);
    expect(record.error).toBeUndefined();
  });
});
