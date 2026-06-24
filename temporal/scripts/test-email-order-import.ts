/**
 * email-order-import end-to-end smoke test (deterministic, no external services).
 *
 * Runs the email-order-import DSL workflow in a TestWorkflowEnvironment with:
 * - A stubbed `http_request` that emulates the Gmail MCP tools
 *   (search_pending / download_attachment / mark_imported / mark_ignored) and the
 *   ERP `POST /orders/import` endpoint, routing by URL path.
 * - A stubbed `file_extract` that returns structured order JSON per message
 *   (so no real PDF/Storage/LLM is needed).
 * - The REAL `data_validate` activity (pure, no I/O).
 * - A stubbed `supabase_mutate` that captures email_imports writes in memory.
 *
 * It exercises three messages: a valid PO (-> imported), a message with no PDF
 * (-> ignored), and a PDF that is not an order (-> ignored), and asserts the
 * Gmail label calls, the /orders/import call, and the email_imports tracking.
 *
 * Run from temporal/:  npx ts-node scripts/test-email-order-import.ts
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, Runtime, DefaultLogger } from "@temporalio/worker";
import type { DSLInput } from "../src/workflows/dsl/interpreter";

// ── tiny test utils ───────────────────────────────────────────────────────────
function divider(t: string) {
  console.log(`\n${"─".repeat(70)}\n  ${t}\n${"─".repeat(70)}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ── captured side effects ──────────────────────────────────────────────────────
interface Tracked {
  message_id: string;
  status: string;
  ignore_reason?: string | null;
  error_message?: string | null;
}
const labelCalls: Array<{ tool: string; message_id: string; reason?: string }> = [];
const orderImports: Array<Record<string, unknown>> = [];
const tracking: Tracked[] = [];

// ── stubbed activities ──────────────────────────────────────────────────────────

// Three fixtures: a valid PO, a message with no PDF, a PDF that is not an order.
const MESSAGES = [
  { message_id: "m-po", subject: "PO #1001", has_pdf: true },
  { message_id: "m-nopdf", subject: "Just saying hi", has_pdf: false },
  { message_id: "m-notorder", subject: "Newsletter", has_pdf: true },
];

async function stubHttpRequest(args: {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  const { url, body = {} } = args;
  const messageId = String(body.message_id ?? "");

  if (url.endsWith("/tools/search_pending")) {
    return { messages: MESSAGES, count: MESSAGES.length };
  }
  if (url.endsWith("/tools/download_attachment")) {
    const has_pdf = messageId !== "m-nopdf";
    return {
      has_pdf,
      filename: has_pdf ? "order.pdf" : null,
      // Encode the message id in the signed URL so the file_extract stub can branch.
      signed_url: has_pdf ? `stub://pdf/${messageId}` : null,
    };
  }
  if (url.endsWith("/tools/mark_imported")) {
    labelCalls.push({ tool: "mark_imported", message_id: messageId });
    return { success: true };
  }
  if (url.endsWith("/tools/mark_ignored")) {
    labelCalls.push({ tool: "mark_ignored", message_id: messageId, reason: String(body.reason ?? "") });
    return { success: true };
  }
  if (url.endsWith("/orders/import")) {
    orderImports.push(body);
    return { id: `order-${orderImports.length}`, success: true };
  }
  throw new Error(`stubHttpRequest: unexpected url ${url}`);
}

async function stubFileExtract(args: { url: string }): Promise<{ text: string; extracted: unknown }> {
  const messageId = args.url.split("/").pop() ?? "";
  if (messageId === "m-notorder") {
    return {
      text: "Monthly newsletter — no order here.",
      extracted: { is_order: false, ignore_reason: "document is a newsletter, not a purchase order", order: null },
    };
  }
  return {
    text: "PURCHASE ORDER PO-1001 ...",
    extracted: {
      is_order: true,
      ignore_reason: null,
      order: {
        customer: { name: "Acme Components Ltda", document_number: "12.345.678/0001-90" },
        order_date: "2026-06-20",
        lines: [
          { sku: "WID-001", description: "Widget, blue, large", quantity: 10, unit_price: 12.5, total: 125.0 },
          { sku: "GZM-220", description: "Gizmo mounting kit", quantity: 4, unit_price: 30.0, total: 120.0 },
        ],
      },
    },
  };
}

async function stubSupabaseMutate(args: {
  table: string;
  match?: Record<string, unknown>;
  values?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (args.table === "email_imports") {
    tracking.push({
      message_id: String(args.match?.message_id ?? ""),
      status: String(args.values?.status ?? ""),
      ignore_reason: (args.values?.ignore_reason as string | null) ?? null,
      error_message: (args.values?.error_message as string | null) ?? null,
    });
  }
  return { id: "track-row", success: true };
}

// ── worker factory ───────────────────────────────────────────────────────────
async function createWorker(testEnv: TestWorkflowEnvironment): Promise<Worker> {
  const [dataValidate] = await Promise.all([import("../src/activities/data_validate")]);
  return Worker.create({
    connection: testEnv.nativeConnection,
    namespace: "default",
    taskQueue: "email-order-import-smoke",
    workflowsPath: require.resolve("../src/workflows"),
    activities: {
      ...dataValidate, // real
      http_request: stubHttpRequest,
      file_extract: stubFileExtract,
      supabase_mutate: stubSupabaseMutate,
      // Best-effort execution tracking the interpreter calls; no-op in the harness.
      record_step: async () => ({ ok: true }),
    },
  });
}

async function loadDefinition(): Promise<Record<string, unknown>> {
  const p = path.resolve(__dirname, "../definitions/email-order-import.json");
  return JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
}

export async function main() {
  divider("EMAIL ORDER IMPORT E2E SMOKE TEST");

  const definition = await loadDefinition();
  const dslInput: DSLInput = {
    definition,
    input: { gmail_account: "orders@example.com", max_messages: 20 },
  };

  Runtime.install({ logger: new DefaultLogger("WARN") });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const worker = await createWorker(testEnv);
  const workerHandle = worker.run();

  try {
    await testEnv.client.workflow.execute("DSLWorkflow", {
      args: [dslInput],
      taskQueue: "email-order-import-smoke",
      workflowId: `email-order-import-smoke-${Date.now()}`,
    });

    divider("RESULTS");
    console.log("label calls:", JSON.stringify(labelCalls));
    console.log("orders imported:", JSON.stringify(orderImports.map((o) => Object.keys(o)), null, 0));
    console.log("tracking:", JSON.stringify(tracking, null, 2));

    // ── Assertions ──────────────────────────────────────────────────────────
    // Valid PO -> one /orders/import call, mark_imported, tracked imported.
    assert(orderImports.length === 1, `expected exactly 1 order import, got ${orderImports.length}`);
    const order = orderImports[0] as { customer?: { name?: string }; lines?: unknown[] };
    assert(order.customer?.name === "Acme Components Ltda", "imported order has wrong customer");
    assert(Array.isArray(order.lines) && order.lines.length === 2, "imported order should have 2 lines");
    assert(
      labelCalls.some((c) => c.tool === "mark_imported" && c.message_id === "m-po"),
      "m-po should be marked imported",
    );
    assert(
      tracking.some((t) => t.message_id === "m-po" && t.status === "imported"),
      "m-po should be tracked as imported",
    );

    // No-PDF message -> mark_ignored + tracked ignored (reason: no PDF).
    assert(
      labelCalls.some((c) => c.tool === "mark_ignored" && c.message_id === "m-nopdf"),
      "m-nopdf should be marked ignored",
    );
    assert(
      tracking.some((t) => t.message_id === "m-nopdf" && t.status === "ignored"),
      "m-nopdf should be tracked as ignored",
    );

    // Not-an-order PDF -> mark_ignored + tracked ignored (reason from model).
    assert(
      labelCalls.some((c) => c.tool === "mark_ignored" && c.message_id === "m-notorder"),
      "m-notorder should be marked ignored",
    );
    assert(
      tracking.some(
        (t) => t.message_id === "m-notorder" && t.status === "ignored" && /newsletter/i.test(t.ignore_reason ?? ""),
      ),
      "m-notorder should be tracked as ignored with the model's reason",
    );

    // No errors expected.
    assert(!tracking.some((t) => t.status === "error"), "no message should have errored");

    divider("SMOKE TEST PASSED");
    console.log("imported: 1 (m-po)  |  ignored: 2 (m-nopdf, m-notorder)  |  errors: 0");
  } finally {
    await worker.shutdown();
    await workerHandle;
    await testEnv.teardown();
  }
}

if (require.main === module) {
  main().catch((error) => {
    divider("SMOKE TEST FAILED");
    console.error(error);
    process.exit(1);
  });
}
