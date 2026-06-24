/**
 * Vertical-classification end-to-end smoke test.
 *
 * Runs the real vertical-classification DSL against stripe.com using:
 * - real domain probing
 * - real Exa search
 * - real LLM calls
 * - real Supabase writes to the workflow_classifications test table
 *
 * Run from temporal/ after exporting local Supabase envs, for example:
 *   eval "$(../scripts/supabase-env.sh)"
 *   EXA_API_KEY=... ANTHROPIC_API_KEY=... npx ts-node scripts/test-vertical-classification.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import { normalizeAzureOpenAiEnv, resolveAzureDeploymentName } from '../src/azure_openai';
import type { DSLInput } from '../src/workflows/dsl/interpreter';
import {
  DEFAULT_LOCAL_SUPABASE_URL,
  MISSING_SUPABASE_SERVICE_ROLE_KEY,
  UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
} from '../src/config';

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

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
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  return value;
}

export function detectProvider(): { provider: string; model_id: string } {
  normalizeAzureOpenAiEnv();

  if (process.env.PIAGENT_PROVIDER && process.env.PIAGENT_MODEL_ID) {
    return { provider: process.env.PIAGENT_PROVIDER, model_id: process.env.PIAGENT_MODEL_ID };
  }
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_BASE_URL) {
    return {
      provider: 'azure-openai-responses',
      model_id: resolveAzureDeploymentName(process.env),
    };
  }
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model_id: 'claude-sonnet-4-6' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model_id: 'gpt-4o' };
  if (process.env.GROQ_API_KEY) return { provider: 'groq', model_id: 'llama-3.3-70b-versatile' };

  throw new Error(
    'No LLM API key found. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or Azure OpenAI env vars.',
  );
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
    if (name === 'domain_probe') {
      const args = asRecord(activityRecord.args, 'domain_probe args');
      if (!args.url && args.domain) args.url = args.domain;
    }
    if (name === 'llm_agent') {
      const args = asRecord(activityRecord.args, 'llm_agent args');
      args.provider = provider;
      args.model_id = modelId;
    }
    if (name === 'supabase_mutate') {
      const args = asRecord(activityRecord.args, 'supabase_mutate args');
      args.table = 'workflow_classifications';
      const values = asRecord(args.values, 'supabase_mutate values');
      if ('classification_confidence' in values) {
        values.confidence = values.classification_confidence;
        delete values.classification_confidence;
      }
    }
  });

  return clone;
}

async function loadVerticalClassificationDefinition(): Promise<Record<string, unknown>> {
  const definitionPath = path.resolve(__dirname, '../definitions/vertical-classification.json');
  const raw = await fs.readFile(definitionPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

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

async function fetchClassificationRow(id: string): Promise<Record<string, unknown>> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const res = await fetch(
    `${url}/rest/v1/workflow_classifications?id=eq.${encodeURIComponent(id)}&select=*`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch workflow_classifications row ${id}: HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const rows = await res.json() as Array<Record<string, unknown>>;
  assert(rows.length === 1, `Expected exactly one workflow_classifications row for id=${id}, got ${rows.length}`);
  return rows[0];
}

function logLlmStep(name: string, value: unknown) {
  const result = asRecord(value, `${name} result`);
  const parsed = asRecord(result.parsed, `${name}.parsed`);
  requireNumber(result.prompt_tokens, `${name}.prompt_tokens`);
  requireNumber(result.completion_tokens, `${name}.completion_tokens`);

  divider(name);
  log(`${name} parsed output`, parsed);
  log(`${name} tokens`, {
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
    provider: result.provider,
    model: result.model,
    content_filter_blocked: result.content_filter_blocked,
  });

  const toolCalls = result.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    log(`${name} tool calls`, toolCalls);
  }
}

async function createWorker(testEnv: TestWorkflowEnvironment): Promise<Worker> {
  const [
    supabaseCore,
    notifications,
    httpRequest,
    supabaseQuery,
    evaluateDecision,
    transformData,
    webSearch,
    webCrawl,
    domainProbe,
    llmAgent,
  ] = await Promise.all([
    import('../src/activities/supabase_core'),
    import('../src/activities/notifications'),
    import('../src/activities/http_request'),
    import('../src/activities/supabase_query'),
    import('../src/activities/evaluate_decision'),
    import('../src/activities/transform_data'),
    import('../src/activities/web_search'),
    import('../src/activities/web_crawl'),
    import('../src/activities/domain_probe'),
    import('../src/activities/llm_agent'),
  ]);

  return Worker.create({
    connection: testEnv.nativeConnection,
    namespace: 'default',
    taskQueue: 'vertical-classification-smoke',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...supabaseCore,
      ...notifications,
      ...httpRequest,
      ...supabaseQuery,
      ...evaluateDecision,
      ...transformData,
      ...webSearch,
      ...webCrawl,
      ...domainProbe,
      ...llmAgent,
    },
  });
}

export async function main() {
  divider('VERTICAL CLASSIFICATION E2E SMOKE TEST');
  assert(!!process.env.EXA_API_KEY, 'EXA_API_KEY is required for this smoke test');

  process.env.SUPABASE_URL ??= DEFAULT_LOCAL_SUPABASE_URL;

  const { provider, model_id } = detectProvider();
  const { url } = getSupabaseEnv();
  log('Environment', {
    provider,
    model_id,
    supabase_url: url,
    exa: 'real search enabled',
  });

  const rawDefinition = await loadVerticalClassificationDefinition();
  const definition = patchDefinitionForSmoke(rawDefinition, provider, model_id);
  const dslInput: DSLInput = {
    definition,
    input: {
      company_name: 'Stripe',
      domain: 'stripe.com',
      run_at: new Date().toISOString(),
    },
  };

  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const worker = await createWorker(testEnv);
  const workerHandle = worker.run();

  try {
    const startedAt = Date.now();
    const result = await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [dslInput],
      taskQueue: 'vertical-classification-smoke',
      workflowId: `vertical-classification-smoke-${Date.now()}`,
    }) as Record<string, unknown>;

    const elapsedMs = Date.now() - startedAt;
    const probe = asRecord(result.probe, 'probe');
    const searchResults = asRecord(result.search_results, 'search_results');
    const searchItems = requireArray(searchResults.results, 'search_results.results');

    divider('DOMAIN PROBE');
    log('Domain probe result', probe);
    assert(probe.domain_active === true, 'Expected stripe.com to take the active domain branch');

    divider('SEARCH RESULTS');
    log('Search results', searchResults);

    logLlmStep('LIFECYCLE LLM OUTPUT', result.lifecycle_response);
    logLlmStep('BROAD VERTICAL LLM OUTPUT', result.broad_classification_response);
    logLlmStep('SUB-VERTICAL LLM OUTPUT', result.sub_classification_response);

    const persistResult = asRecord(result.persist_result, 'persist_result');
    const rowId = requireString(persistResult.id, 'persist_result.id');
    divider('SUPABASE WRITE');
    log('Supabase write confirmation', { row_id: rowId, persist_result: persistResult });

    const row = await fetchClassificationRow(rowId);
    log('Persisted row', row);

    requireString(row.vertical, 'workflow_classifications.vertical');
    requireString(row.sub_vertical, 'workflow_classifications.sub_vertical');
    requireNumber(row.confidence, 'workflow_classifications.confidence');
    assert(row.domain_active === true, 'Persisted row must confirm the active-domain branch');
    assert(row.lifecycle_stage !== 'defunct', 'Persisted row must not come from the defunct fallback branch');
    assert(searchItems.length > 0, 'Expected real Exa search results');

    divider('SMOKE TEST COMPLETE');
    console.log(`Supabase row ID: ${rowId}`);
    console.log(`Search results returned: ${searchItems.length}`);
    console.log(`Total wall-clock: ${elapsedMs}ms`);
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
