/**
 * Lead-enrichment end-to-end smoke test.
 *
 * Runs the real lead-enrichment DSL against a stable public example
 * (Patrick Collison at Stripe) using:
 * - real Exa search
 * - real Exa crawl
 * - real LLM extraction
 * - real Supabase writes to core entities/entity_versions
 *
 * Run from temporal/ after exporting local Supabase envs:
 *   eval "$(../scripts/supabase-env.sh)"
 *   EXA_API_KEY=... ANTHROPIC_API_KEY=... npx ts-node scripts/test-lead-enrichment.ts
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
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

function inferProvider(): { provider: string; model_id: string } {
  if (process.env.PIAGENT_PROVIDER && process.env.PIAGENT_MODEL_ID) {
    return { provider: process.env.PIAGENT_PROVIDER, model_id: process.env.PIAGENT_MODEL_ID };
  }
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model_id: 'claude-sonnet-4-6' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model_id: 'gpt-4o' };
  if (process.env.GROQ_API_KEY) return { provider: 'groq', model_id: 'llama-3.3-70b-versatile' };

  throw new Error(
    'No LLM API key found. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or PIAGENT_PROVIDER/PIAGENT_MODEL_ID.',
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
    if (activityRecord.name !== 'llm_agent') return;

    const args = asRecord(activityRecord.args, 'llm_agent args');
    args.provider = provider;
    args.model_id = modelId;
  });

  return clone;
}

async function loadLeadEnrichmentDefinition(): Promise<Record<string, unknown>> {
  const definitionPath = path.resolve(__dirname, '../definitions/lead-enrichment.json');
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

async function fetchEntityVersionRow(entityId: string): Promise<Record<string, unknown>> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const res = await fetch(
    `${url}/rest/v1/entity_versions?entity_id=eq.${encodeURIComponent(entityId)}&is_current=eq.true&select=*`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: 'Bearer ' + serviceRoleKey,
      },
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch entity_versions row for entity ${entityId}: HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  assert(rows.length >= 1, `Expected at least one current entity_versions row for entity_id=${entityId}`);
  return rows[0];
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
    taskQueue: 'lead-enrichment-smoke',
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
  divider('LEAD ENRICHMENT E2E SMOKE TEST');
  assert(!!process.env.EXA_API_KEY, 'EXA_API_KEY is required for this smoke test');

  process.env.SUPABASE_URL ??= DEFAULT_LOCAL_SUPABASE_URL;

  const { provider, model_id } = inferProvider();
  const { url } = getSupabaseEnv();
  log('Environment', {
    provider,
    model_id,
    supabase_url: url,
    exa: 'real search/crawl enabled',
  });

  const rawDefinition = await loadLeadEnrichmentDefinition();
  const definition = patchDefinitionForSmoke(rawDefinition, provider, model_id);
  const dslInput: DSLInput = {
    definition,
    input: {
      person_name: 'Patrick Collison',
      company_name: 'Stripe',
      company_domain: 'stripe.com',
      source_id: 'person:patrick-collison|company:stripe',
    },
  };

  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const worker = await createWorker(testEnv);
  const workerHandle = worker.run();

  try {
    const startedAt = Date.now();
    const result = (await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [dslInput],
      taskQueue: 'lead-enrichment-smoke',
      workflowId: `lead-enrichment-smoke-${Date.now()}`,
    })) as Record<string, unknown>;

    const elapsedMs = Date.now() - startedAt;

    const linkedinSearch = asRecord(result.linkedin_search, 'linkedin_search');
    const companyNews = asRecord(result.company_news, 'company_news');
    const companyCrawl = asRecord(result.company_crawl, 'company_crawl');
    const extraction = asRecord(asRecord(result.enrichment_extraction, 'enrichment_extraction').parsed, 'enrichment_extraction.parsed');

    divider('SEARCH HITS');
    log('LinkedIn-oriented hits', linkedinSearch);
    log('Company news/funding hits', companyNews);

    divider('CRAWL SUMMARY');
    const crawlPages = requireArray(companyCrawl.pages, 'company_crawl.pages');
    log('Crawled pages summary', {
      url: companyCrawl.url,
      page_count: crawlPages.length,
      sample_titles: crawlPages
        .slice(0, 3)
        .map((page) => asRecord(page, 'company_crawl.page').title)
        .filter((title) => typeof title === 'string' && title.length > 0),
    });

    divider('EXTRACTED PAYLOAD');
    log('Lead enrichment payload', extraction);

    const jobTitle = requireString(extraction.job_title, 'parsed.job_title');
    const company = requireString(extraction.company, 'parsed.company');
    const seniority = requireString(extraction.seniority, 'parsed.seniority');
    const confidence = requireNumber(extraction.confidence, 'parsed.confidence');
    const sources = requireArray(extraction.sources, 'parsed.sources');
    assert(confidence >= 0 && confidence <= 1, 'parsed.confidence must be between 0 and 1');
    assert(/stripe/i.test(company), `Expected extracted company to mention Stripe, got: ${company}`);
    assert(jobTitle.length > 0, 'parsed.job_title must be non-empty');
    assert(seniority.length > 0, 'parsed.seniority must be non-empty');
    assert(sources.length > 0, 'parsed.sources must include at least one citation');

    const entityId = requireString(result.entity_id, 'result.entity_id');
    const reviewStatus = requireString(result.review_status, 'result.review_status');
    assert(
      reviewStatus === 'ready' || reviewStatus === 'review_needed',
      `result.review_status must be ready or review_needed, got ${reviewStatus}`,
    );

    divider('FINAL WRITE RESULT');
    log('Workflow write outputs', {
      entity_id: entityId,
      confidence: result.confidence,
      review_status: reviewStatus,
      contact_entity: result.contact_entity,
      contact_version: result.contact_version,
    });

    const persistedVersion = await fetchEntityVersionRow(entityId);
    const persistedData = asRecord(persistedVersion.data, 'entity_versions.data');
    const persistedProvenance = asRecord(persistedData.provenance, 'entity_versions.data.provenance');

    log('Persisted current entity version', persistedVersion);
    assert(persistedVersion.is_current === true, 'Persisted entity version must be current');
    requireString(persistedData.job_title, 'persisted data.job_title');
    requireString(persistedData.company, 'persisted data.company');
    requireString(persistedData.seniority, 'persisted data.seniority');
    requireNumber(persistedData.confidence, 'persisted data.confidence');
    requireArray(persistedProvenance.sources, 'persisted data.provenance.sources');
    requireString(persistedProvenance.model, 'persisted data.provenance.model');
    requireString(persistedProvenance.observed_at, 'persisted data.provenance.observed_at');

    divider('SMOKE TEST COMPLETE');
    console.log(`Entity ID: ${entityId}`);
    console.log(`Confidence: ${confidence}`);
    console.log(`Review status: ${reviewStatus}`);
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
