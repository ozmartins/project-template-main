/**
 * Research-report smoke test.
 *
 * Real mode:
 *   eval "$(../scripts/supabase-env.sh)"
 *   EXA_API_KEY=... ANTHROPIC_API_KEY=... npx ts-node scripts/test-research-report.ts
 *
 * Stub mode (CI-friendly, no external APIs):
 *   npx ts-node scripts/test-research-report.ts --stub
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import type { DSLInput } from '../src/workflows/dsl/interpreter';
import { detectProvider } from './test-vertical-classification';

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

const SMOKE_QUESTION = 'What is Temporal.io and how does it compare to Apache Airflow?';

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

function requireArray(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

function divider(title: string) {
  console.log(`\n${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`);
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
    if (activityRecord.name === 'llm_agent') {
      const args = asRecord(activityRecord.args, 'llm_agent args');
      args.provider = provider;
      args.model_id = modelId;
    }
  });

  return clone;
}

async function loadDefinition(): Promise<Record<string, unknown>> {
  const definitionPath = path.resolve(__dirname, '../definitions/research-report.json');
  return JSON.parse(await fs.readFile(definitionPath, 'utf8')) as Record<string, unknown>;
}

function stubLlmForDecomposition(): Record<string, unknown> {
  return {
    parsed: {
      queries: [
        'Temporal workflow orchestration overview',
        'Apache Airflow architecture and scheduling model',
        'Temporal vs Airflow reliability and developer experience comparison',
      ],
    },
    tool_calls: [],
    provider: 'stub',
    model: 'stub-llm',
    prompt_tokens: 100,
    completion_tokens: 40,
    content_filter_blocked: false,
  };
}

function stubLlmForSynthesis(): Record<string, unknown> {
  return {
    parsed: {
      summary:
        'Temporal is a durable workflow platform with code-native stateful execution, while Airflow is a DAG scheduler focused on batch data pipelines.',
      key_points: [
        'Temporal persists workflow state and retries transparently in application code.',
        'Airflow models orchestration as scheduled DAG tasks and is strongest for ETL-style jobs.',
        'Temporal fits long-running, event-driven business workflows better than Airflow.',
      ],
      sources: ['https://temporal.io/', 'https://airflow.apache.org/'],
    },
    tool_calls: [
      {
        name: 'search_web',
        arguments: { query: 'Temporal vs Airflow' },
        result: {
          query: 'Temporal vs Airflow',
          results: [
            {
              title: 'Temporal Documentation',
              url: 'https://temporal.io/',
              snippet: 'Temporal is a durable execution platform for workflows.',
            },
          ],
        },
      },
    ],
    provider: 'stub',
    model: 'stub-llm',
    prompt_tokens: 220,
    completion_tokens: 120,
    content_filter_blocked: false,
  };
}

function createStubActivities() {
  return {
    llm_agent: async (args: Record<string, unknown>) => {
      const schemaName = String(args.schema_name ?? '');
      if (schemaName === 'research_query_decomposition') return stubLlmForDecomposition();
      if (schemaName === 'research_report') return stubLlmForSynthesis();
      throw new Error(`Unexpected llm_agent schema_name in stub mode: ${schemaName}`);
    },
    web_search: async (args: Record<string, unknown>) => ({
      query: String(args.query ?? ''),
      results: [
        {
          title: `Stub result for ${String(args.query ?? '')}`,
          url: 'https://example.com/stub-search-result',
          snippet: 'Stubbed search result for CI-safe workflow execution.',
        },
      ],
    }),
    supabase_mutate: async () => ({ id: 'stub-research-report-row', upserted: true }),
  };
}

async function createRealActivities() {
  const [supabaseQuery, webSearch, llmAgent] = await Promise.all([
    import('../src/activities/supabase_query'),
    import('../src/activities/web_search'),
    import('../src/activities/llm_agent'),
  ]);

  return {
    ...supabaseQuery,
    ...webSearch,
    ...llmAgent,
  };
}

async function runSmoke(stubMode: boolean): Promise<void> {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const activities = stubMode ? createStubActivities() : await createRealActivities();
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    namespace: 'default',
    taskQueue: 'research-report-smoke',
    workflowsPath: require.resolve('../src/workflows'),
    activities,
  });
  const workerHandle = worker.run();

  try {
    const providerModel = stubMode ? { provider: 'openai', model_id: 'gpt-4o' } : detectProvider();
    const rawDefinition = await loadDefinition();
    const definition = patchDefinitionForSmoke(rawDefinition, providerModel.provider, providerModel.model_id);

    const dslInput: DSLInput = {
      definition,
      input: {
        question: SMOKE_QUESTION,
        report_key: `research-report-${Date.now()}`,
        run_at: new Date().toISOString(),
      },
    };

    const result = await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [dslInput],
      taskQueue: 'research-report-smoke',
      workflowId: `research-report-smoke-${Date.now()}`,
    }) as Record<string, unknown>;

    const decomposition = asRecord(result.decomposition_response, 'decomposition_response');
    const decompositionParsed = asRecord(decomposition.parsed, 'decomposition_response.parsed');
    const queries = requireArray(decompositionParsed.queries, 'decomposition_response.parsed.queries');
    assert(queries.length === 3, `Expected exactly 3 search queries, got ${queries.length}`);
    const searchContext = requireString(result.search_context, 'search_context');
    for (const [index, query] of queries.entries()) {
      const queryText = requireString(query, `decomposition_response.parsed.queries[${index}]`);
      assert(
        searchContext.includes(`Search angle ${index}: ${queryText}`),
        `Expected search_context to include Search angle ${index} for "${queryText}"`,
      );
    }

    const reportResponse = asRecord(result.report_response, 'report_response');
    const reportParsed = asRecord(reportResponse.parsed, 'report_response.parsed');
    const summary = requireString(reportParsed.summary, 'report_response.parsed.summary');
    const keyPoints = requireArray(reportParsed.key_points, 'report_response.parsed.key_points');
    const sources = requireArray(reportParsed.sources, 'report_response.parsed.sources');
    assert(keyPoints.length > 0, 'Expected report_response.parsed.key_points to be non-empty');
    assert(sources.length > 0, 'Expected report_response.parsed.sources to be non-empty');

    const toolCalls = requireArray(reportResponse.tool_calls, 'report_response.tool_calls');
    const exaCallWithResults = toolCalls.find((call) => {
      if (!call || typeof call !== 'object' || Array.isArray(call)) return false;
      const record = call as Record<string, unknown>;
      if (record.name !== 'search_web') return false;
      if (!record.result || typeof record.result !== 'object' || Array.isArray(record.result)) return false;
      const resultRecord = record.result as Record<string, unknown>;
      return Array.isArray(resultRecord.results) && resultRecord.results.length > 0;
    });
    assert(
      !!exaCallWithResults,
      'Expected synthesis llm_agent tool_call trace to include a search_web call with non-empty results',
    );

    const persisted = asRecord(result.persist_result, 'persist_result');
    requireString(persisted.id, 'persist_result.id');

    divider('RESEARCH REPORT SMOKE TEST COMPLETE');
    console.log(`Mode: ${stubMode ? 'stub' : 'real'}`);
    console.log(`Question: ${SMOKE_QUESTION}`);
    console.log(`Summary: ${summary}`);
    console.log(`Key points: ${keyPoints.length}`);
    console.log(`Sources: ${sources.length}`);
  } finally {
    await worker.shutdown();
    await workerHandle;
    await testEnv.teardown();
  }
}

export async function main(): Promise<void> {
  const forceStub = process.argv.includes('--stub');
  const realCapable =
    !!process.env.EXA_API_KEY &&
    (!!process.env.ANTHROPIC_API_KEY ||
      !!process.env.OPENAI_API_KEY ||
      !!process.env.GROQ_API_KEY ||
      !!process.env.PIAGENT_PROVIDER);

  const stubMode = forceStub || !realCapable;
  divider('RESEARCH REPORT SMOKE TEST');
  console.log(`Mode selected: ${stubMode ? 'stub' : 'real'}`);
  await runSmoke(stubMode);
}

if (require.main === module) {
  main().catch((error) => {
    divider('SMOKE TEST FAILED');
    console.error(error);
    process.exit(1);
  });
}
