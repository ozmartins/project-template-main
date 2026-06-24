import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import type { DSLInput } from "../src/workflows/dsl/interpreter";

let testEnv: TestWorkflowEnvironment;
let worker: Worker;
let workerRunPromise: Promise<void>;

// Sentinel timestamp returned by the record_step stub on "running" calls.
// Using a fixed value (not new Date()) lets tests assert the interpreter
// forwards the exact token — if forwarding breaks, the completed/failed
// assertions below will fail with a clear mismatch.
const SENTINEL_STARTED_AT = "2024-01-01T00:00:00.000Z";

// Captures tracking calls emitted by the interpreter. Cleared per-test in
// the "execution tracing" describe block so tracing assertions stay isolated.
const trackingCapture: {
  record_step: Record<string, unknown>[];
  complete_execution: Record<string, unknown>[];
} = { record_step: [], complete_execution: [] };

// Shared stub activities registered on the one worker for the suite.
const testActivities = {
  stub_activity: async (args: Record<string, unknown>) => ({ ...args, _stub: true }),
  always_fails: async () => {
    throw new Error("activity failed");
  },
  // Stubs capture their args so the "execution tracing" tests can assert on them.
  // Return the fixed SENTINEL_STARTED_AT on "running" calls so tests can verify
  // the interpreter forwards the exact token to subsequent completed/failed calls.
  record_step: async (args: Record<string, unknown>): Promise<string | undefined> => {
    trackingCapture.record_step.push(args);
    return args.status === "running" ? SENTINEL_STARTED_AT : undefined;
  },
  complete_execution: async (args: Record<string, unknown>) => {
    trackingCapture.complete_execution.push(args);
  },
};

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger("WARN") });
  testEnv = await TestWorkflowEnvironment.createLocal();
  const { nativeConnection } = testEnv;
  worker = await Worker.create({
    connection: nativeConnection,
    namespace: "default",
    taskQueue: "test",
    workflowsPath: require.resolve("../src/workflows"),
    activities: testActivities,
  });
  // Start worker in background — keep it alive for all tests.
  workerRunPromise = worker.run();
}, 60_000);

afterAll(async () => {
  await worker?.shutdown();
  await workerRunPromise;
  // suppress the known native-connection teardown race in @temporalio/testing
  await testEnv?.teardown().catch(() => {});
}, 30_000);

async function runDSL(input: DSLInput): Promise<Record<string, unknown>> {
  const { client } = testEnv;
  return client.workflow.execute("DSLWorkflow", {
    args: [input],
    taskQueue: "test",
    workflowId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }) as Promise<Record<string, unknown>>;
}

describe("DSLWorkflow interpreter", () => {
  it("executes a single activity step", async () => {
    const result = await runDSL({
      definition: {
        name: "test-single-activity",
        version: "1.0.0",
        steps: {
          activity: {
            name: "stub_activity",
            args: { entity_type: "$input.type" },
            result: "created",
          },
        },
      },
      input: { type: "customer" },
    });
    expect((result.created as Record<string, unknown>)._stub).toBe(true);
    expect((result.created as Record<string, unknown>).entity_type).toBe("customer");
  });

  it("executes a sequence", async () => {
    const result = await runDSL({
      definition: {
        name: "test-sequence",
        version: "1.0.0",
        steps: {
          sequence: {
            steps: [
              { activity: { name: "stub_activity", args: { n: 1 }, result: "step1" } },
              { activity: { name: "stub_activity", args: { n: 2 }, result: "step2" } },
            ],
          },
        },
      },
      input: {},
    });
    expect((result.step1 as Record<string, unknown>).n).toBe(1);
    expect((result.step2 as Record<string, unknown>).n).toBe(2);
  });

  it("executes condition — true branch", async () => {
    const result = await runDSL({
      definition: {
        name: "test-condition-true",
        version: "1.0.0",
        variables: { flag: true },
        steps: {
          condition: {
            if: "$var.flag == true",
            // biome-ignore lint/suspicious/noThenProperty: DSL keyword, not a thenable
            then: { set_variable: { name: "branch", value: "taken" } },
            else: { set_variable: { name: "branch", value: "not_taken" } },
          },
        },
      },
      input: {},
    });
    expect(result.branch).toBe("taken");
  });

  it("executes condition — false branch", async () => {
    const result = await runDSL({
      definition: {
        name: "test-condition-false",
        version: "1.0.0",
        variables: { flag: false },
        steps: {
          condition: {
            if: "$var.flag == true",
            // biome-ignore lint/suspicious/noThenProperty: DSL keyword, not a thenable
            then: { set_variable: { name: "branch", value: "taken" } },
            else: { set_variable: { name: "branch", value: "not_taken" } },
          },
        },
      },
      input: {},
    });
    expect(result.branch).toBe("not_taken");
  });

  it("executes set_variable", async () => {
    const result = await runDSL({
      definition: {
        name: "test-set-variable",
        version: "1.0.0",
        steps: { set_variable: { name: "status", value: "active" } },
      },
      input: {},
    });
    expect(result.status).toBe("active");
  });

  it("resolves $input references", async () => {
    const result = await runDSL({
      definition: {
        name: "test-input-ref",
        version: "1.0.0",
        steps: { set_variable: { name: "email", value: "$input.user.email" } },
      },
      input: { user: { email: "alice@example.com" } },
    });
    expect(result.email).toBe("alice@example.com");
  });

  it("executes parallel branches", async () => {
    const result = await runDSL({
      definition: {
        name: "test-parallel",
        version: "1.0.0",
        steps: {
          parallel: {
            branches: [
              { activity: { name: "stub_activity", args: { k: "a" }, result: "resultA" } },
              { activity: { name: "stub_activity", args: { k: "b" }, result: "resultB" } },
            ],
          },
        },
      },
      input: {},
    });
    expect((result.resultA as Record<string, unknown>).k).toBe("a");
    expect((result.resultB as Record<string, unknown>).k).toBe("b");
  });

  it("executes try_catch and catches errors", async () => {
    const result = await runDSL({
      definition: {
        name: "test-try-catch",
        version: "1.0.0",
        steps: {
          try_catch: {
            // max_attempts: 1 so the activity fails immediately without retrying
            try: {
              activity: {
                name: "always_fails",
                retry: { max_attempts: 1 },
              },
            },
            catch: {
              error_var: "err",
              body: { set_variable: { name: "caught", value: "yes" } },
            },
          },
        },
      },
      input: {},
    });
    expect(result.caught).toBe("yes");
    expect(typeof result.err).toBe("string");
  });

  it("executes for_each sequentially", async () => {
    const result = await runDSL({
      definition: {
        name: "test-for-each",
        version: "1.0.0",
        steps: {
          for_each: {
            items: "$input.names",
            item_var: "name",
            body: {
              activity: { name: "stub_activity", args: { who: "$var.name" }, result: "last" },
            },
            mode: "sequential",
          },
        },
      },
      input: { names: ["alice", "bob", "carol"] },
    });
    expect((result.last as Record<string, unknown>).who).toBe("carol");
  });

  it("handles wait_signal with immediate signal", async () => {
    const { client } = testEnv;
    const wfId = `signal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const handle = await client.workflow.start("DSLWorkflow", {
      args: [
        {
          definition: {
            name: "test-signal",
            version: "1.0.0",
            steps: {
              sequence: {
                steps: [
                  {
                    wait_signal: {
                      signal: "my_event",
                      result: "payload",
                      timeout: "10s",
                    },
                  },
                  { set_variable: { name: "done", value: "yes" } },
                ],
              },
            },
          },
          input: {},
        },
      ],
      taskQueue: "test",
      workflowId: wfId,
    });

    await handle.signal("my_event", { value: 42 });
    const result = (await handle.result()) as Record<string, unknown>;
    expect(result.done).toBe("yes");
    expect((result.payload as Record<string, unknown>).value).toBe(42);
  });
});

describe("execution tracing", () => {
  beforeEach(() => {
    trackingCapture.record_step = [];
    trackingCapture.complete_execution = [];
  });

  it("emits record_step(running) then record_step(completed) for a successful activity", async () => {
    await runDSL({
      definition: {
        name: "trace-success",
        version: "1.0.0",
        steps: { activity: { name: "stub_activity", args: { x: 1 }, result: "r" } },
      },
      input: {},
    });

    const running = trackingCapture.record_step.filter((c) => c.status === "running");
    const completed = trackingCapture.record_step.filter((c) => c.status === "completed");
    expect(running).toHaveLength(1);
    expect(running[0].step_name).toBe("stub_activity");
    expect(completed).toHaveLength(1);
    expect(completed[0].step_name).toBe("stub_activity");
    // The interpreter must forward the started_at token returned by the "running"
    // call into the "completed" call so the activity can compute duration_ms.
    expect(completed[0].started_at).toBe(SENTINEL_STARTED_AT);
  });

  it("calls complete_execution(completed) on a successful workflow", async () => {
    await runDSL({
      definition: {
        name: "trace-complete",
        version: "1.0.0",
        steps: { activity: { name: "stub_activity", args: {}, result: "r" } },
      },
      input: {},
    });

    expect(trackingCapture.complete_execution).toHaveLength(1);
    expect(trackingCapture.complete_execution[0].status).toBe("completed");
  });

  it("emits record_step(failed) and complete_execution(failed) when activity throws", async () => {
    await expect(
      runDSL({
        definition: {
          name: "trace-failure",
          version: "1.0.0",
          steps: {
            activity: {
              name: "always_fails",
              retry: { max_attempts: 1 },
            },
          },
        },
        input: {},
      })
    ).rejects.toThrow();

    const failed = trackingCapture.record_step.filter((c) => c.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].step_name).toBe("always_fails");
    // The interpreter must forward the started_at token returned by the "running"
    // call into the "failed" call so the activity can compute duration_ms.
    expect(failed[0].started_at).toBe(SENTINEL_STARTED_AT);
    expect(trackingCapture.complete_execution).toHaveLength(1);
    expect(trackingCapture.complete_execution[0].status).toBe("failed");
  });
});
