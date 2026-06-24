/**
 * Invoice-processing end-to-end smoke test.
 *
 * Runs the invoice-processing DSL workflow using:
 * - A stubbed file_extract that reads the checked-in sample invoice fixture
 *   (temporal/tests/fixtures/sample-invoice.txt). When FILE_EXTRACT_URL is set,
 *   the stub fetches that URL instead so a real PDF source can be exercised.
 * - A local data_validate stub that enforces the same business rules the real
 *   activity will enforce (required fields, positive amount, ISO dates).
 * - Real LLM calls for the extraction step.
 * - Stubbed email_send (EMAIL_SEND_ALLOW_STUB=true is set automatically).
 * - Real or stubbed entity persistence via supabase_core.
 *
 * Run from temporal/ after exporting local Supabase envs:
 *   eval "$(../scripts/supabase-env.sh)"
 *   ANTHROPIC_API_KEY=... npx ts-node scripts/test-invoice-processing.ts
 *
 * To test approval routing, run with INVOICE_AMOUNT_OVERRIDE=15000 so the
 * amount exceeds the 10000 threshold. The script sends the approval signal
 * automatically in that mode.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import type { DSLInput } from '../src/workflows/dsl/interpreter';
import {
  DEFAULT_LOCAL_SUPABASE_URL,
  MISSING_SUPABASE_SERVICE_ROLE_KEY,
  UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
} from '../src/config';

// ── Types ─────────────────────────────────────────────────────────────────────

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

interface InvoiceFields {
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  currency: string;
  line_items: Array<{ description: string; amount: number; quantity?: number | null; unit_price?: number | null }>;
}

interface ApprovalPayload {
  decision: 'approve' | 'reject';
  reviewer_id: string;
  note?: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(label: string, data?: unknown) {
  const ts = new Date().toISOString().substring(11, 23);
  const detail = data === undefined ? '' : `\n${JSON.stringify(data, null, 2)}`;
  console.log(`[${ts}] ${label}${detail}`);
}

function divider(title: string) {
  console.log(`\n${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

// ── Provider detection (mirrors test-vertical-classification.ts) ──────────────

export function detectProvider(): { provider: string; model_id: string } {
  if (!process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_API_KEY) {
    process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_API_KEY;
  }
  if (!process.env.AZURE_OPENAI_BASE_URL && process.env.AZURE_API_BASE) {
    process.env.AZURE_OPENAI_BASE_URL = process.env.AZURE_API_BASE;
  }
  if (!process.env.AZURE_OPENAI_API_VERSION) {
    const raw = process.env.AZURE_API_VERSION ?? '';
    process.env.AZURE_OPENAI_API_VERSION = raw && raw >= '2025' ? raw : '2025-03-01-preview';
  }

  if (process.env.PIAGENT_PROVIDER && process.env.PIAGENT_MODEL_ID) {
    return { provider: process.env.PIAGENT_PROVIDER, model_id: process.env.PIAGENT_MODEL_ID };
  }
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_BASE_URL) {
    return {
      provider: 'azure-openai-responses',
      model_id: process.env.AZURE_OPENAI_DEPLOYMENT ?? process.env.AZURE_API_DEPLOYMENT ?? 'gpt-4o',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model_id: 'claude-haiku-4-5-20251001' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model_id: 'gpt-4o' };
  if (process.env.GROQ_API_KEY) return { provider: 'groq', model_id: 'llama-3.3-70b-versatile' };

  throw new Error(
    'No LLM API key found. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or Azure OpenAI env vars.',
  );
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

function getSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL ?? DEFAULT_LOCAL_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert(
    !!serviceRoleKey &&
      serviceRoleKey !== MISSING_SUPABASE_SERVICE_ROLE_KEY &&
      serviceRoleKey !== UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY is required; run eval "$(../scripts/supabase-env.sh)" before this smoke test',
  );

  return { url, serviceRoleKey };
}

// ── Definition loading and patching ────────────────────────────────────────────

function visitJson(node: JsonValue, visitor: (value: JsonObject) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) visitJson(item, visitor);
    return;
  }
  visitor(node);
  for (const value of Object.values(node)) visitJson(value, visitor);
}

export function patchDefinitionForSmoke(
  definition: Record<string, unknown>,
  provider: string,
  modelId: string,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(definition)) as JsonObject;

  visitJson(clone, (value) => {
    const activity = value.activity;
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return;

    const a = activity as JsonObject;
    if (a.name === 'llm_agent') {
      const args = a.args as JsonObject;
      args.provider = provider;
      args.model_id = modelId;
    }
  });

  return clone;
}

async function loadDefinition(): Promise<Record<string, unknown>> {
  const definitionPath = path.resolve(__dirname, '../definitions/invoice-processing.json');
  const raw = await fs.readFile(definitionPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

// ── Stubbed activities ─────────────────────────────────────────────────────────

async function stubFileExtract(args: {
  url?: string | null;
  base64?: string | null;
  mime_type?: string | null;
}): Promise<{ text: string; page_count: number; source_ref: string | null }> {
  const overrideUrl = process.env.FILE_EXTRACT_URL;

  if (overrideUrl) {
    log('file_extract: fetching from FILE_EXTRACT_URL', { url: overrideUrl });
    const response = await fetch(overrideUrl);
    assert(response.ok, `file_extract: HTTP ${response.status} fetching ${overrideUrl}`);
    const text = await response.text();
    return { text, page_count: 1, source_ref: overrideUrl };
  }

  const fixturePath = path.resolve(__dirname, '../tests/fixtures/sample-invoice.txt');
  const text = await fs.readFile(fixturePath, 'utf8');
  log('file_extract: using fixture', { fixturePath });

  return {
    text,
    page_count: 1,
    source_ref: args.url ?? null,
  };
}

function normalizeIsoDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

async function stubDataValidate(args: {
  data: Record<string, unknown>;
  rules: Record<string, unknown>;
}): Promise<{
  valid: boolean;
  errors: string[];
  normalized: InvoiceFields;
}> {
  const data = args.data ?? {};
  const errors: string[] = [];

  const requiredFields = ['vendor', 'invoice_number', 'invoice_date', 'amount', 'currency'];
  for (const field of requiredFields) {
    const v = data[field];
    if (v === undefined || v === null || String(v).trim() === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  const rawAmount = Number(data.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    errors.push(`amount must be a positive number, got: ${JSON.stringify(data.amount)}`);
  }

  const currency = String(data.currency ?? '').trim().toUpperCase();
  if (currency.length !== 3) {
    errors.push(`currency must be a 3-character ISO 4217 code, got: ${JSON.stringify(data.currency)}`);
  }

  if (errors.length > 0) {
    throw new Error(`data_validate: invoice failed validation — ${errors.join('; ')}`);
  }

  const normalized: InvoiceFields = {
    vendor:         String(data.vendor).trim(),
    invoice_number: String(data.invoice_number).trim(),
    invoice_date:   normalizeIsoDate(data.invoice_date) ?? String(data.invoice_date),
    due_date:       normalizeIsoDate(data.due_date),
    amount:         rawAmount,
    currency,
    line_items:     Array.isArray(data.line_items)
      ? (data.line_items as Array<Record<string, unknown>>).map((item) => ({
          description: String(item.description ?? '').trim(),
          quantity:    item.quantity != null ? Number(item.quantity) : null,
          unit_price:  item.unit_price != null ? Number(item.unit_price) : null,
          amount:      Number(item.amount ?? 0),
        }))
      : [],
  };

  return { valid: true, errors: [], normalized };
}

// ── Worker factory ─────────────────────────────────────────────────────────────

async function createWorker(testEnv: TestWorkflowEnvironment): Promise<Worker> {
  const [supabaseCore, supabaseQuery, httpRequest, transformData, evaluateDecision, notifications, llmAgent, emailSend] =
    await Promise.all([
      import('../src/activities/supabase_core'),
      import('../src/activities/supabase_query'),
      import('../src/activities/http_request'),
      import('../src/activities/transform_data'),
      import('../src/activities/evaluate_decision'),
      import('../src/activities/notifications'),
      import('../src/activities/llm_agent'),
      import('../src/activities/email_send'),
    ]);

  return Worker.create({
    connection: testEnv.nativeConnection,
    namespace: 'default',
    taskQueue: 'invoice-processing-smoke',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...supabaseCore,
      ...supabaseQuery,
      ...httpRequest,
      ...transformData,
      ...evaluateDecision,
      ...notifications,
      ...llmAgent,
      ...emailSend,
      file_extract:  stubFileExtract,
      data_validate: stubDataValidate,
    },
  });
}

// ── Main smoke test ────────────────────────────────────────────────────────────

export async function main() {
  divider('INVOICE PROCESSING E2E SMOKE TEST');

  process.env.SUPABASE_URL ??= DEFAULT_LOCAL_SUPABASE_URL;
  process.env.EMAIL_SEND_ALLOW_STUB = 'true';

  const { provider, model_id } = detectProvider();
  const { url: supabaseUrl } = getSupabaseEnv();

  const amountOverride = process.env.INVOICE_AMOUNT_OVERRIDE
    ? Number(process.env.INVOICE_AMOUNT_OVERRIDE)
    : undefined;
  const overThreshold = amountOverride !== undefined && amountOverride > 10000;

  log('Environment', {
    provider,
    model_id,
    supabase_url: supabaseUrl,
    amount_override: amountOverride ?? 'none (use extracted amount)',
    approval_threshold: 10000,
    over_threshold_mode: overThreshold,
  });

  const rawDefinition = await loadDefinition();
  const definition = patchDefinitionForSmoke(rawDefinition, provider, model_id);

  const dslInput: DSLInput = {
    definition,
    input: {
      invoice_url:   process.env.FILE_EXTRACT_URL ?? null,
      file_base64:   null,
      mime_type:     'application/pdf',
      submitted_by:  'smoke-test-runner',
      finance_team_email: 'finance@example.com',
    },
  };

  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const worker = await createWorker(testEnv);
  const workerHandle = worker.run();

  try {
    const startedAt = Date.now();
    const workflowId = `invoice-processing-smoke-${Date.now()}`;

    const workflowHandle = testEnv.client.workflow.getHandle(workflowId);

    const resultPromise = testEnv.client.workflow.execute('DSLWorkflow', {
      args: [dslInput],
      taskQueue: 'invoice-processing-smoke',
      workflowId,
    }) as Promise<Record<string, unknown>>;

    if (overThreshold) {
      // Send the approval signal after a short delay so the workflow
      // has time to reach the wait_signal step.
      divider('OVER-THRESHOLD MODE: will send approval signal in 3s');
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      const approvalPayload: ApprovalPayload = {
        decision:    'approve',
        reviewer_id: 'smoke-reviewer',
        note:        'Auto-approved by smoke test',
      };
      await workflowHandle.signal('approval_decision', approvalPayload);
      log('approval_decision signal sent', approvalPayload);
    }

    const result = await resultPromise;
    const elapsedMs = Date.now() - startedAt;

    // ── Validate file_extract output ─────────────────────────────────────────
    divider('FILE EXTRACT');
    const extractedFile = asRecord(result.extracted_file, 'extracted_file');
    requireString(extractedFile.text, 'extracted_file.text');
    requireNumber(extractedFile.page_count, 'extracted_file.page_count');
    log('Extracted file metadata', {
      page_count:  extractedFile.page_count,
      text_length: (extractedFile.text as string).length,
      source_ref:  extractedFile.source_ref,
    });

    // ── Validate llm_agent output ─────────────────────────────────────────────
    divider('LLM EXTRACTION');
    const llmExtraction = asRecord(result.llm_extraction, 'llm_extraction');
    const llmParsed = asRecord(llmExtraction.parsed, 'llm_extraction.parsed');
    requireNumber(llmExtraction.prompt_tokens as number, 'llm_extraction.prompt_tokens');
    requireNumber(llmExtraction.completion_tokens as number, 'llm_extraction.completion_tokens');
    log('LLM extracted fields', llmParsed);
    log('LLM token usage', {
      prompt_tokens:     llmExtraction.prompt_tokens,
      completion_tokens: llmExtraction.completion_tokens,
      provider:          llmExtraction.provider,
      model:             llmExtraction.model,
    });

    // Assert all required fields were extracted
    for (const field of ['vendor', 'invoice_number', 'invoice_date', 'amount', 'currency']) {
      assert(
        llmParsed[field] !== undefined && llmParsed[field] !== null && llmParsed[field] !== '',
        `llm_extraction.parsed.${field} must be non-empty`,
      );
    }
    requireArray(llmParsed.line_items, 'llm_extraction.parsed.line_items');

    // ── Validate data_validate output ─────────────────────────────────────────
    divider('DATA VALIDATION');
    const validatedInvoice = asRecord(result.validated_invoice, 'validated_invoice');
    assert(validatedInvoice.valid === true, 'validated_invoice.valid must be true for the sample fixture');
    const normalized = asRecord(validatedInvoice.normalized, 'validated_invoice.normalized');
    log('Validated + normalized invoice', normalized);

    requireString(normalized.vendor,         'normalized.vendor');
    requireString(normalized.invoice_number, 'normalized.invoice_number');
    requireString(normalized.invoice_date,   'normalized.invoice_date');
    requireNumber(normalized.amount as number, 'normalized.amount');
    requireString(normalized.currency,       'normalized.currency');
    requireArray(normalized.line_items,      'normalized.line_items');
    assert(
      (normalized.amount as number) > 0,
      `normalized.amount must be positive, got ${normalized.amount}`,
    );
    assert(
      (normalized.currency as string).length === 3,
      `normalized.currency must be a 3-char ISO 4217 code, got "${normalized.currency}"`,
    );

    // ── Validate entity persistence ────────────────────────────────────────────
    divider('ENTITY PERSISTENCE');
    const invoiceEntity = asRecord(result.invoice_entity, 'invoice_entity');
    requireString(invoiceEntity.entity_id as string, 'invoice_entity.entity_id');
    log('Entity created', {
      entity_id:  invoiceEntity.entity_id,
      version_id: invoiceEntity.version_id,
      success:    invoiceEntity.success,
    });

    const invoiceStatus = result.invoice_status as string;
    assert(
      ['approved', 'rejected', 'timed_out', 'pending_validation', 'pending_review'].includes(invoiceStatus),
      `invoice_status must be a known value, got "${invoiceStatus}"`,
    );
    log('Invoice status', { invoice_status: invoiceStatus });

    if (overThreshold) {
      divider('APPROVAL ROUTING');
      const approvalPayload = asRecord(result.approval_payload, 'approval_payload');
      requireString(approvalPayload.decision as string, 'approval_payload.decision');
      requireString(approvalPayload.reviewer_id as string, 'approval_payload.reviewer_id');
      log('Approval payload', approvalPayload);
      const updatedEntity = asRecord(result.updated_entity, 'updated_entity');
      log('Entity updated after approval', {
        entity_id:  updatedEntity.entity_id,
        version_id: updatedEntity.version_id,
      });
    }

    // ── Validate notification ──────────────────────────────────────────────────
    divider('NOTIFICATION');
    const notificationResult = asRecord(result.notification_result, 'notification_result');
    requireString(notificationResult.message_id as string, 'notification_result.message_id');
    requireString(notificationResult.provider as string,   'notification_result.provider');
    log('Email notification', {
      message_id: notificationResult.message_id,
      provider:   notificationResult.provider,
      delivered:  notificationResult.delivered,
    });

    divider('SMOKE TEST COMPLETE');
    console.log(`Vendor extracted:     ${normalized.vendor}`);
    console.log(`Invoice number:       ${normalized.invoice_number}`);
    console.log(`Invoice date:         ${normalized.invoice_date}`);
    console.log(`Amount:               ${normalized.currency} ${normalized.amount}`);
    console.log(`Line items:           ${(normalized.line_items as unknown[]).length}`);
    console.log(`Invoice status:       ${invoiceStatus}`);
    console.log(`Entity ID:            ${invoiceEntity.entity_id}`);
    console.log(`Total wall-clock:     ${elapsedMs}ms`);
  } finally {
    await worker.shutdown();
    await workerHandle;
    await testEnv.teardown();
  }
}

if (require.main === module) {
  main().catch((error) => {
    divider('SMOKE TEST FAILED');
    console.error(error);
    process.exit(1);
  });
}
