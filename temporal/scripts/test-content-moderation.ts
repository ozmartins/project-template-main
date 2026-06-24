/**
 * Content-moderation end-to-end smoke test.
 *
 * Runs the real content-moderation DSL with real LLM calls and real Supabase
 * writes against three fixtures:
 * - safe URL content (automatic approval + crawl path)
 * - borderline text content (human-review wait_signal path)
 * - clearly violating text content (automatic rejection path)
 *
 * Run from temporal/ after exporting local Supabase envs, for example:
 *   eval "$(../scripts/supabase-env.sh)"
 *   EXA_API_KEY=... ANTHROPIC_API_KEY=... npx ts-node scripts/test-content-moderation.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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

type DecisionStatus = 'approved' | 'rejected';

type ReviewSignal = {
  decision: 'approve' | 'reject';
  reviewer_id: string;
  note?: string;
};

type Fixture = {
  name: string;
  input: {
    content_text?: string;
    content_url?: string;
    submission_id: string;
    submitted_by: string;
    policy_version: string;
  };
  expectedDecision: DecisionStatus;
  expectHumanReview: boolean;
  expectCrawl: boolean;
  reviewSignal?: ReviewSignal;
};

function divider(title: string) {
  console.log(`\n${'─'.repeat(72)}\n  ${title}\n${'─'.repeat(72)}`);
}

function log(label: string, value?: unknown) {
  if (value === undefined) {
    console.log(label);
    return;
  }
  console.log(`${label}\n${JSON.stringify(value, null, 2)}`);
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

function patchDefinitionForLiveSmoke(
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

/**
 * Patch the definition for CI-friendly smoke verification:
 * - inject an explicit LLM provider/model
 * - route entity persistence into workflow_classifications so tests can assert
 *   on a simple relational row without depending on the entity SCD2 model
 */
export function patchDefinitionForSmoke(
  definition: Record<string, unknown>,
  provider: string,
  modelId: string,
): Record<string, unknown> {
  const clone = patchDefinitionForLiveSmoke(definition, provider, modelId) as JsonObject;

  visitJson(clone, (value) => {
    const activity = value.activity;
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return;

    const activityRecord = activity as JsonObject;
    if (activityRecord.name !== 'supabase_mutate') return;

    const args = asRecord(activityRecord.args, 'supabase_mutate args');
    if (!('entity_type' in args)) return;

    delete args.entity_type;
    delete args.source_record_id;
    delete args.created_by;
    delete args.data;
    args.table = 'workflow_classifications';
    args.operation = 'upsert';
    args.match = { domain: '$input.submission_id' };
    args.values = {
      domain: '$input.submission_id',
      name: 'content-moderation-smoke',
      confidence: '$var.classification.confidence',
      vertical: '$var.decision_status',
      sub_vertical: '$var.classification.category',
      lifecycle_stage: '$var.classification.severity',
      domain_active: true,
      classified_at: new Date().toISOString(),
    };
  });

  return clone;
}

async function loadDefinition(): Promise<Record<string, unknown>> {
  const definitionPath = path.resolve(__dirname, '../definitions/content-moderation.json');
  return JSON.parse(await fs.readFile(definitionPath, 'utf8')) as Record<string, unknown>;
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

async function fetchJsonArray(url: string, serviceRoleKey: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: 'Bearer ' + serviceRoleKey,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase fetch failed: HTTP ${response.status}: ${text.slice(0, 400)}`);
  }

  return (await response.json()) as Array<Record<string, unknown>>;
}

async function fetchEntity(entityId: string): Promise<Record<string, unknown>> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const rows = await fetchJsonArray(
    `${url}/rest/v1/entities?id=eq.${encodeURIComponent(entityId)}&select=id,entity_type,source_record_id`,
    serviceRoleKey,
  );
  assert(rows.length === 1, `Expected exactly one entity row for ${entityId}, got ${rows.length}`);
  return rows[0];
}

async function fetchCurrentVersion(entityId: string): Promise<Record<string, unknown>> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const rows = await fetchJsonArray(
    `${url}/rest/v1/entity_versions?entity_id=eq.${encodeURIComponent(entityId)}&is_current=eq.true&select=id,entity_id,version_number,data`,
    serviceRoleKey,
  );
  assert(rows.length === 1, `Expected exactly one current entity_version row for ${entityId}, got ${rows.length}`);
  return rows[0];
}

async function createWorker(testEnv: TestWorkflowEnvironment): Promise<Worker> {
  const [supabaseQuery, notifications, webCrawl, llmAgent] = await Promise.all([
    import('../src/activities/supabase_query'),
    import('../src/activities/notifications'),
    import('../src/activities/web_crawl'),
    import('../src/activities/llm_agent'),
  ]);

  return Worker.create({
    connection: testEnv.nativeConnection,
    namespace: 'default',
    taskQueue: 'content-moderation-smoke',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...supabaseQuery,
      ...notifications,
      ...webCrawl,
      ...llmAgent,
    },
  });
}

function buildFixtures(): Fixture[] {
  return [
    {
      name: 'safe-url',
      input: {
        content_url: 'https://example.com',
        content_text: 'Reference documentation page for a harmless example website.',
        submission_id: 'content-moderation-safe-url',
        submitted_by: 'safe-user',
        policy_version: '2026-06-21',
      },
      expectedDecision: 'approved',
      expectHumanReview: false,
      expectCrawl: true,
    },
    {
      name: 'borderline-human-review',
      input: {
        content_text:
          'Please review this ambiguous user post: "A friend says this herbal tonic might cure every illness instantly, but I am not sure whether it is satire, misinformation, or a personal testimonial. Should I repost it?"',
        submission_id: 'content-moderation-borderline',
        submitted_by: 'borderline-user',
        policy_version: '2026-06-21',
      },
      expectedDecision: 'approved',
      expectHumanReview: true,
      expectCrawl: false,
      reviewSignal: {
        decision: 'approve',
        reviewer_id: 'trust-safety-reviewer',
        note: 'Ambiguous claim kept after human review.',
      },
    },
    {
      name: 'violating-text',
      input: {
        content_text:
          'Hot explicit nude content and free porn access here now — click immediately to unlock uncensored videos and spam every friend you know.',
        submission_id: 'content-moderation-violating',
        submitted_by: 'violating-user',
        policy_version: '2026-06-21',
      },
      expectedDecision: 'rejected',
      expectHumanReview: false,
      expectCrawl: false,
    },
  ];
}

function getClassification(result: Record<string, unknown>): Record<string, unknown> {
  if (result.moderation && typeof result.moderation === 'object' && !Array.isArray(result.moderation)) {
    return asRecord(result.moderation, 'moderation');
  }
  if (result.classification && typeof result.classification === 'object' && !Array.isArray(result.classification)) {
    return asRecord(result.classification, 'classification');
  }
  if (
    result.classification_result &&
    typeof result.classification_result === 'object' &&
    !Array.isArray(result.classification_result)
  ) {
    const classificationResult = asRecord(result.classification_result, 'classification_result');
    return asRecord(classificationResult.parsed, 'classification_result.parsed');
  }

  throw new Error('Expected workflow result to expose moderation or classification output');
}

function assertClassificationShape(result: Record<string, unknown>) {
  const classification = getClassification(result);
  assert(typeof classification.safe === 'boolean', 'classification.safe must be a boolean');
  requireString(classification.category, 'classification.category');
  requireString(classification.severity, 'classification.severity');
  requireString(classification.reasoning, 'classification.reasoning');
  requireNumber(classification.confidence, 'classification.confidence');
}

async function runAutomaticFixture(
  testEnv: TestWorkflowEnvironment,
  definition: Record<string, unknown>,
  fixture: Fixture,
): Promise<void> {
  divider(`AUTOMATIC ROUTING — ${fixture.name}`);

  const result = (await testEnv.client.workflow.execute('DSLWorkflow', {
    args: [{ definition, input: fixture.input } satisfies DSLInput],
    taskQueue: 'content-moderation-smoke',
    workflowId: `content-moderation-${fixture.name}-${Date.now()}`,
  })) as Record<string, unknown>;

  assertClassificationShape(result);
  assert(result.decision_status === fixture.expectedDecision, `${fixture.name} expected ${fixture.expectedDecision}`);

  if (fixture.expectCrawl) {
    const crawlResult = asRecord(result.crawl_result, 'crawl_result');
    const pages = crawlResult.pages;
    assert(Array.isArray(pages) && pages.length > 0, `${fixture.name} expected crawled pages from web_crawl`);
  }

  const persistResult = asRecord(result.persist_result, 'persist_result');
  const entityId = requireString(persistResult.entity_id, 'persist_result.entity_id');
  const entity = await fetchEntity(entityId);
  const version = await fetchCurrentVersion(entityId);
  const data = asRecord(version.data, 'entity_versions.data');
  const moderation = asRecord(data.moderation, 'entity_versions.data.moderation');
  const classification = getClassification(result);

  assert(entity.entity_type === 'content_submission', 'Persisted entity_type must be content_submission');
  assert(entity.source_record_id === fixture.input.submission_id, 'Persisted source_record_id must match submission_id');
  assert(data.decision_status === fixture.expectedDecision, `Persisted decision_status must be ${fixture.expectedDecision}`);
  assert(data.policy_version === fixture.input.policy_version, 'Persisted policy_version must match input');
  assert(moderation.category === classification.category, 'Persisted moderation must match workflow output');

  log('Persisted current version', version);
}

async function runHumanReviewFixture(
  testEnv: TestWorkflowEnvironment,
  definition: Record<string, unknown>,
  fixture: Fixture,
): Promise<void> {
  divider(`HUMAN REVIEW PATH — ${fixture.name}`);
  assert(fixture.reviewSignal, `${fixture.name} requires a review signal payload`);

  const handle = await testEnv.client.workflow.start('DSLWorkflow', {
    args: [{ definition, input: fixture.input } satisfies DSLInput],
    taskQueue: 'content-moderation-smoke',
    workflowId: `content-moderation-${fixture.name}-${Date.now()}`,
  });

  let completed = false;
  const resultPromise = handle.result().then((result) => {
    completed = true;
    return result as Record<string, unknown>;
  });

  await delay(1500);
  assert(!completed, `${fixture.name} should still be blocked on wait_signal before review`);

  log('Sending review signal', fixture.reviewSignal);
  await handle.signal('review_decision', fixture.reviewSignal);

  const result = await resultPromise;
  assertClassificationShape(result);
  assert(result.decision_status === fixture.expectedDecision, `${fixture.name} expected ${fixture.expectedDecision}`);

  const classification = getClassification(result);
  assert(
    typeof classification.confidence === 'number' && classification.confidence < 0.7,
    `${fixture.name} expected a low-confidence classification that routes to human review`,
  );

  const reviewPayload = asRecord(result.review_payload ?? result.review_signal, 'review payload');
  assert(reviewPayload.decision === fixture.reviewSignal.decision, 'Workflow should retain the review payload');
  assert(reviewPayload.reviewer_id === fixture.reviewSignal.reviewer_id, 'Workflow should retain reviewer_id');

  const persistResult = asRecord(result.persist_result, 'persist_result');
  const entityId = requireString(persistResult.entity_id, 'persist_result.entity_id');
  const version = await fetchCurrentVersion(entityId);
  const data = asRecord(version.data, 'entity_versions.data');
  const review = asRecord(data.review, 'entity_versions.data.review');

  assert(data.decision_status === fixture.expectedDecision, `Persisted decision_status must be ${fixture.expectedDecision}`);
  assert(review.decision === fixture.reviewSignal.decision, 'Persisted review decision must match signal payload');
  assert(review.reviewer_id === fixture.reviewSignal.reviewer_id, 'Persisted reviewer_id must match signal payload');
  if (fixture.reviewSignal.note) {
    assert(review.note === fixture.reviewSignal.note, 'Persisted review note must match signal payload');
  }

  log('Persisted current version', version);
}

export async function main() {
  divider('CONTENT MODERATION E2E SMOKE TEST');
  assert(!!process.env.EXA_API_KEY, 'EXA_API_KEY is required for the URL crawl fixture in this smoke test');

  process.env.SUPABASE_URL ??= DEFAULT_LOCAL_SUPABASE_URL;

  const { provider, model_id } = detectProvider();
  const { url } = getSupabaseEnv();
  const rawDefinition = await loadDefinition();
  const definition = patchDefinitionForLiveSmoke(rawDefinition, provider, model_id);
  const fixtures = buildFixtures();

  log('Environment', {
    provider,
    model_id,
    supabase_url: url,
    fixtures: fixtures.map((fixture) => fixture.name),
  });

  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  const worker = await createWorker(testEnv);
  const workerHandle = worker.run();

  try {
    await runAutomaticFixture(testEnv, definition, fixtures[0]);
    await runHumanReviewFixture(testEnv, definition, fixtures[1]);
    await runAutomaticFixture(testEnv, definition, fixtures[2]);

    divider('SMOKE TEST COMPLETE');
    console.log('All content moderation fixtures routed as expected.');
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
