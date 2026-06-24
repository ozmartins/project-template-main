import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { Worker } from "@temporalio/worker";
import { validateDefinitions } from "../scripts/validate-definitions";

describe("validate-definitions script", () => {
  it("exits non-zero for an invalid definition fixture", () => {
    const temporalRoot = resolve(__dirname, "..");
    const result = spawnSync(
      "npx",
      ["ts-node", "scripts/validate-definitions.ts", "tests/fixtures/invalid-definition.json"],
      {
        cwd: temporalRoot,
        encoding: "utf8",
      }
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("invalid-definition.json");
  });

  it("returns non-zero for a schema-valid fixture that fails in interpreter execution", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => void 0);
    try {
      const fakeTestEnv = {
        nativeConnection: {},
        teardown: async () => {},
      } as unknown as TestWorkflowEnvironment;
      const fakeWorker = {
        run: async () => {},
        shutdown: async () => {},
      } as unknown as Worker;
      const installRuntime = jest.fn();

      const exitCode = await validateDefinitions(
        ["tests/fixtures/interpreter-failure-definition.json"],
        {
          installRuntime,
          createTestEnvironment: async () => fakeTestEnv,
          createWorker: async () => fakeWorker,
          executeWorkflow: async () => {
            throw new Error("forced interpreter failure");
          },
        }
      );

      expect(exitCode).not.toBe(0);
      expect(installRuntime).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("interpreter-failure-definition.json failed interpreter execution")
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
