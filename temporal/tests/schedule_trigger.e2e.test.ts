import { Client } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { schedule_trigger } from "../src/activities/schedule_trigger";
import { config } from "../src/config";

describe.skip("schedule_trigger e2e (requires local Temporal server — run locally only)", () => {
  it("schedules a short-delay workflow and it fires", async () => {
    const connection = await NativeConnection.connect({ address: config.temporalAddress });
    const client = new Client({ connection, namespace: config.temporalNamespace });

    const worker = await Worker.create({
      connection,
      namespace: config.temporalNamespace,
      taskQueue: config.temporalTaskQueue,
      workflowsPath: require.resolve("../src/workflows"),
      activities: {},
    });
    const workerRunPromise = worker.run();

    try {
      const scheduled = await schedule_trigger({
        workflow_id: "schedule-trigger-e2e",
        workflow_input: {
          definition: {
            name: "schedule-trigger-e2e",
            version: "1.0.0",
            steps: {
              set_variable: {
                name: "status",
                value: "fired",
              },
            },
          },
          input: {},
        },
        run_at: "2s",
        _idempotency_key: `e2e-${Date.now()}`,
      });

      const handle = client.workflow.getHandle(scheduled.scheduled_workflow_id);
      const result = (await handle.result()) as Record<string, unknown>;
      expect(result.status).toBe("fired");
    } finally {
      await worker.shutdown();
      await workerRunPromise;
      await connection.close();
    }
  }, 30_000);
});
