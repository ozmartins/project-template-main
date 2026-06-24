import * as fs from "node:fs";
import * as path from "node:path";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import type { DSLInput } from "../src/workflows/dsl/interpreter";

// ── Constants ─────────────────────────────────────────────────────────────────

const VENDOR = "Acme Office Supplies";
const INVOICE_NUMBER = "INV-2024-0042";
const INVOICE_DATE = "2024-03-15";
const DUE_DATE = "2024-04-15";
const CURRENCY = "USD";
const ENTITY_ID = "test-invoice-entity-001";

const LINE_ITEMS = [
  { description: "Premium A4 Copy Paper", amount: 85.0, quantity: 10, unit_price: 8.5 },
  { description: "Stapler, Heavy-Duty", amount: 34.99, quantity: null, unit_price: null },
];

function makeNormalizedInvoice(amount: number) {
  return {
    vendor: VENDOR,
    invoice_number: INVOICE_NUMBER,
    invoice_date: INVOICE_DATE,
    due_date: DUE_DATE,
    amount,
    currency: CURRENCY,
    line_items: LINE_ITEMS,
  };
}

// ── Stub activity factories ───────────────────────────────────────────────────

function makeActivities(amount: number) {
  return {
    // file_extract: return inline fixture text (no I/O)
    file_extract: async () => ({
      text: `INVOICE\nVendor: Acme Office Supplies\nAmount: $${String(amount)}`,
      pages: 1,
    }),

    // llm_agent: return pre-extracted invoice fields
    llm_agent: async () => ({
      parsed: makeNormalizedInvoice(amount),
      content_filter_blocked: false,
      prompt_tokens: 100,
      completion_tokens: 50,
    }),

    // data_validate: success path — mirrors real rules-based validation output
    data_validate: async () => ({
      valid: true,
      errors: [] as string[],
      normalized: makeNormalizedInvoice(amount),
    }),

    // Supabase entity activities
    create_entity: async () => ({ entity_id: ENTITY_ID }),
    update_entity_scd2: async (...args: unknown[]) => {
      const firstArg = args[0] as Record<string, unknown> | undefined;
      const attributes = (firstArg?.attributes ?? {}) as Record<string, unknown>;
      return { entity_id: ENTITY_ID, ...attributes };
    },

    // Notification
    email_send: async () => ({
      message_id: "msg-stub-001",
      provider: "stub",
      delivered: true,
    }),

    // Execution tracking — no-ops so they do not interfere with assertions
    record_step: async () => undefined as string | undefined,
    complete_execution: async () => undefined,
  };
}

function makeFailingValidateActivities(amount: number) {
  const base = makeActivities(amount);
  return {
    ...base,
    data_validate: async (): Promise<never> => {
      throw new Error("data_validate: validation failed — Missing required field: vendor");
    },
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger("WARN") });
  testEnv = await TestWorkflowEnvironment.createLocal();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
}, 30_000);

function loadDefinition(): Record<string, unknown> {
  const definitionPath = path.resolve(__dirname, "../definitions/invoice-processing.json");
  return JSON.parse(fs.readFileSync(definitionPath, "utf8")) as Record<string, unknown>;
}

function baseInput(): Record<string, unknown> {
  return {
    invoice_url: "https://example.com/stub-invoice.txt",
    mime_type: "text/plain",
    submitted_by: "test-runner",
    finance_team_email: "finance@example.com",
  };
}

async function runWithWorker(
  activities: Record<string, (...a: unknown[]) => unknown>,
  run: (env: TestWorkflowEnvironment) => Promise<void>
): Promise<void> {
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    namespace: "default",
    taskQueue: "invoice-processing-test",
    workflowsPath: require.resolve("../src/workflows"),
    activities,
  });
  const workerHandle = worker.run();
  try {
    await run(testEnv);
  } finally {
    await worker.shutdown();
    await workerHandle;
  }
}

// ── Under-threshold: auto-approve (amount < 10 000) ───────────────────────────

describe("invoice-processing — under threshold (auto-approve)", () => {
  it("completes with invoice_status=approved and creates an entity without waiting for a signal", async () => {
    const AMOUNT = 3512.18;

    await runWithWorker(makeActivities(AMOUNT), async (env) => {
      const dslInput: DSLInput = {
        definition: loadDefinition(),
        input: baseInput(),
      };

      const result = await env.client.workflow.execute("DSLWorkflow", {
        args: [dslInput],
        taskQueue: "invoice-processing-test",
        workflowId: `invoice-under-${Date.now()}`,
      });

      const vars = result as Record<string, unknown>;

      expect(vars.invoice_status).toBe("approved");
      expect(vars.invoice_amount).toBe(AMOUNT);
      expect(vars.invoice_currency).toBe(CURRENCY);
      expect(vars.invoice_entity_id).toBe(ENTITY_ID);

      // email_send result should be present
      const notification = vars.notification_result as Record<string, unknown>;
      expect(notification.delivered).toBe(true);
    });
  }, 30_000);
});

// ── Over-threshold + approve ──────────────────────────────────────────────────

describe("invoice-processing — over threshold with approval", () => {
  it("waits for approval_decision signal and sets invoice_status=approved", async () => {
    const AMOUNT = 15_000;

    await runWithWorker(makeActivities(AMOUNT), async (env) => {
      const workflowId = `invoice-over-approve-${Date.now()}`;

      const dslInput: DSLInput = {
        definition: loadDefinition(),
        input: baseInput(),
      };

      const handle = await env.client.workflow.start("DSLWorkflow", {
        args: [dslInput],
        taskQueue: "invoice-processing-test",
        workflowId,
      });

      // Send the approval signal after a short delay so the workflow has time
      // to reach wait_signal (create_entity needs to complete first).
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      await handle.signal("approval_decision", {
        decision: "approve",
        reviewer_id: "reviewer-001",
        note: "Looks good",
        reviewed_at: new Date().toISOString(),
      });

      const result = (await handle.result()) as Record<string, unknown>;

      expect(result.invoice_status).toBe("approved");
      expect(result.invoice_entity_id).toBe(ENTITY_ID);
    });
  }, 30_000);
});

// ── Over-threshold + reject ───────────────────────────────────────────────────

describe("invoice-processing — over threshold with rejection", () => {
  it("waits for approval_decision signal and sets invoice_status=rejected", async () => {
    const AMOUNT = 20_000;

    await runWithWorker(makeActivities(AMOUNT), async (env) => {
      const workflowId = `invoice-over-reject-${Date.now()}`;

      const dslInput: DSLInput = {
        definition: loadDefinition(),
        input: baseInput(),
      };

      const handle = await env.client.workflow.start("DSLWorkflow", {
        args: [dslInput],
        taskQueue: "invoice-processing-test",
        workflowId,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      await handle.signal("approval_decision", {
        decision: "reject",
        reviewer_id: "reviewer-002",
        note: "Exceeds budget",
        reviewed_at: new Date().toISOString(),
      });

      const result = (await handle.result()) as Record<string, unknown>;

      expect(result.invoice_status).toBe("rejected");
      expect(result.invoice_entity_id).toBe(ENTITY_ID);
    });
  }, 30_000);
});

// ── Validation failure ────────────────────────────────────────────────────────

describe("invoice-processing — validation failure", () => {
  it("fails the workflow when data_validate throws", async () => {
    const AMOUNT = 100;

    await runWithWorker(makeFailingValidateActivities(AMOUNT), async (env) => {
      const dslInput: DSLInput = {
        definition: loadDefinition(),
        input: baseInput(),
      };

      await expect(
        env.client.workflow.execute("DSLWorkflow", {
          args: [dslInput],
          taskQueue: "invoice-processing-test",
          workflowId: `invoice-validate-fail-${Date.now()}`,
        })
      ).rejects.toThrow();
    });
  }, 30_000);
});
