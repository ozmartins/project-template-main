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

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function divider(title: string) {
  console.log(`\n${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`);
}

function log(label: string, data?: unknown) {
  const ts = new Date().toISOString().substring(11, 23);
  const detail = data === undefined ? '' : `\n${JSON.stringify(data, null, 2)}`;
  console.log(`[${ts}] ${label}${detail}`);
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

function requireStringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  assert(value.every((item) => typeof item === 'string' && item.trim().length > 0), `${label} must contain non-empty strings`);
  return value as string[];
}

function detectProvider(): { provider: string; model_id: string } {
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
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model_id: 'claude-sonnet-4-6' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model_id: 'gpt-4o' };
  if (process.env.GROQ_API_KEY) return { provider: 'groq', model_id: 'llama-3.3-70b-versatile' };

  throw new Error('No LLM API key found. Set provider credentials or run with DOC_EXTRACTION_USE_STUBS=1');
}

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

    const activityRecord = activity as JsonObject;
    const name = activityRecord.name;

    if (name === 'llm_agent') {
      const args = asRecord(activityRecord.args, 'llm_agent args');
      args.provider = provider;
      args.model_id = modelId;
    }

    if (name === 'supabase_mutate') {
      const args = asRecord(activityRecord.args, 'supabase_mutate args');
      args.table = 'workflow_executions';
      args.match = { workflow_id: '$input.workflow_id' };
      args.values = {
        workflow_id: '$input.workflow_id',
        run_id: '$input.workflow_id',
        definition_name: 'doc-extraction',
        definition_version: '1.0.0',
        status: 'completed',
        completed_at: '$input.run_at',
        input_payload: {
          source_url: '$input.source_url',
        },
        output_payload: {
          extracted_fields: '$var.extraction_response.parsed',
          confidence: '$var.extraction_response.parsed.confidence',
        },
      };
    }
  });

  return clone;
}

async function loadDefinition(): Promise<Record<string, unknown>> {
  const definitionPath = path.resolve(__dirname, '../definitions/doc-extraction.json');
  const raw = await fs.readFile(definitionPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function shouldUseStubs(): boolean {
  if (process.env.DOC_EXTRACTION_USE_STUBS === '1') return true;
  if (process.env.CI === 'true') return true;

  const hasLlmKey =
    !!process.env.PIAGENT_PROVIDER ||
    !!process.env.ANTHROPIC_API_KEY ||
    !!process.env.OPENAI_API_KEY ||
    !!process.env.GROQ_API_KEY ||
    (!!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_BASE_URL) ||
    (!!process.env.AZURE_API_KEY && !!process.env.AZURE_API_BASE);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasSupabase =
    !!serviceRoleKey &&
    serviceRoleKey !== MISSING_SUPABASE_SERVICE_ROLE_KEY &&
    serviceRoleKey !== UNINJECTED_SUPABASE_SERVICE_ROLE_KEY;

  return !(hasLlmKey && hasSupabase);
}

function getSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL ?? DEFAULT_LOCAL_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(
    !!serviceRoleKey &&
      serviceRoleKey !== MISSING_SUPABASE_SERVICE_ROLE_KEY &&
      serviceRoleKey !== UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY is required for real mode; run eval "$(../scripts/supabase-env.sh)"',
  );
  return { url, serviceRoleKey };
}

async function fetchWorkflowExecutionRow(id: string): Promise<Record<string, unknown>> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const res = await fetch(`${url}/rest/v1/workflow_executions?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: {
      apikey: serviceRoleKey,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch workflow_executions row ${id}: HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  assert(rows.length === 1, `Expected exactly one workflow_executions row for id=${id}, got ${rows.length}`);
  return rows[0];
}

async function createWorker(
  testEnv: TestWorkflowEnvironment,
  useStubs: boolean,
  captures: { stubWrite?: Record<string, unknown> },
): Promise<Worker> {
  if (useStubs) {
    const { transform_data } = await import('../src/activities/transform_data');
    return Worker.create({
      connection: testEnv.nativeConnection,
      namespace: 'default',
      taskQueue: 'doc-extraction-smoke',
      workflowsPath: require.resolve('../src/workflows'),
      activities: {
        http_request: async (args: Record<string, unknown>) => {
          return {
            source: String(args.url ?? ''),
            body: [
              'Attention Is All You Need',
              'Authors: Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin',
              'Abstract: The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...',
              'Year: 2017',
            ].join('\n'),
          };
        },
        transform_data,
        llm_agent: async () => ({
          parsed: {
            title: 'Attention Is All You Need',
            authors: [
              'Ashish Vaswani',
              'Noam Shazeer',
              'Niki Parmar',
              'Jakob Uszkoreit',
              'Llion Jones',
              'Aidan N. Gomez',
              'Lukasz Kaiser',
              'Illia Polosukhin',
            ],
            abstract:
              'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...',
            year: 2017,
            confidence: 0.95,
          },
          tool_calls: [],
          provider: 'stub',
          model: 'stub-model',
          prompt_tokens: 0,
          completion_tokens: 0,
          content_filter_blocked: false,
        }),
        supabase_mutate: async (args: Record<string, unknown>) => {
          const values = asRecord(args.values, 'supabase_mutate args.values');
          captures.stubWrite = {
            source_url: values.source_url,
            extracted_fields: values.extracted_fields,
          };
          return { id: 'stub-doc-extraction-row', ...values };
        },
        send_notification: async () => true,
      },
    });
  }

  const [notifications, httpRequest, transformData, llmAgent, supabaseQuery] = await Promise.all([
    import('../src/activities/notifications'),
    import('../src/activities/http_request'),
    import('../src/activities/transform_data'),
    import('../src/activities/llm_agent'),
    import('../src/activities/supabase_query'),
  ]);

  return Worker.create({
    connection: testEnv.nativeConnection,
    namespace: 'default',
    taskQueue: 'doc-extraction-smoke',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...notifications,
      ...httpRequest,
      ...transformData,
      ...llmAgent,
      ...supabaseQuery,
    },
  });
}

export async function main() {
  divider('DOCUMENT EXTRACTION E2E SMOKE TEST');

  const useStubs = shouldUseStubs();
  const sourceUrl = 'https://arxiv.org/abs/1706.03762';

  let provider = 'stub';
  let model_id = 'stub-model';
  if (!useStubs) {
    ({ provider, model_id } = detectProvider());
    process.env.SUPABASE_URL ??= DEFAULT_LOCAL_SUPABASE_URL;
  }

  log('Mode', {
    use_stubs: useStubs,
    provider,
    model_id,
    source_url: sourceUrl,
  });

  const rawDefinition = await loadDefinition();
  const definition = useStubs
    ? rawDefinition
    : patchDefinitionForSmoke(rawDefinition, provider, model_id);

  const captures: { stubWrite?: Record<string, unknown> } = {};
  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const worker = await createWorker(testEnv, useStubs, captures);
  const workerHandle = worker.run();

  const workflowId = `doc-extraction-smoke-${Date.now()}`;

  try {
    const result = (await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [
        {
          definition,
          input: {
            source_url: sourceUrl,
            run_at: new Date().toISOString(),
            alert_user_id: 'ops-doc-extraction',
            workflow_id: workflowId,
          },
        } as DSLInput,
      ],
      taskQueue: 'doc-extraction-smoke',
      workflowId,
    })) as Record<string, unknown>;

    divider('FULL TRACE');
    console.log(JSON.stringify(result, null, 2));

    const extraction = asRecord(result.extraction_response, 'extraction_response');
    const parsed = asRecord(extraction.parsed, 'extraction_response.parsed');
    const confidence = requireNumber(parsed.confidence, 'extraction_response.parsed.confidence');

    divider('EXTRACTED JSON');
    console.log(JSON.stringify(parsed, null, 2));

    requireString(parsed.title, 'extraction_response.parsed.title');
    requireString(parsed.abstract, 'extraction_response.parsed.abstract');
    requireStringArray(parsed.authors, 'extraction_response.parsed.authors');
    requireNumber(parsed.year, 'extraction_response.parsed.year');
    assert(confidence >= 0.7, 'Expected extraction confidence to be >= 0.7');

    if (useStubs) {
      const stubWrite = asRecord(captures.stubWrite, 'stubWrite');
      requireString(stubWrite.source_url, 'stubWrite.source_url');
      assert(
        !!stubWrite.extracted_fields && typeof stubWrite.extracted_fields === 'object',
        'stubWrite.extracted_fields must be an object',
      );
    } else {
      const persistResult = asRecord(result.persist_result, 'persist_result');
      const rowId = requireString(persistResult.id, 'persist_result.id');
      const row = await fetchWorkflowExecutionRow(rowId);

      const inputPayload = asRecord(row.input_payload, 'workflow_executions.input_payload');
      const outputPayload = asRecord(row.output_payload, 'workflow_executions.output_payload');
      const extractedFields = asRecord(outputPayload.extracted_fields, 'workflow_executions.output_payload.extracted_fields');

      requireString(inputPayload.source_url, 'workflow_executions.input_payload.source_url');
      requireString(extractedFields.title, 'workflow_executions.output_payload.extracted_fields.title');
    }

    divider('SMOKE TEST COMPLETE');
    console.log(`workflow_id=${workflowId}`);
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
