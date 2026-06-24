/**
 * Real end-to-end smoke test.
 *
 * Starts a local Temporal TestWorkflowEnvironment, registers the REAL activities
 * (including real llm_agent), runs a DSL workflow that makes a genuine LLM call,
 * and dumps the full execution trace to stdout.
 *
 * Prerequisites: set one provider credential path, for example:
 *   - AZURE_API_KEY + AZURE_API_BASE (+ PIAGENT_MODEL_ID as deployment name)
 *   - OPENAI_API_KEY
 *   - ANTHROPIC_API_KEY
 *
 * Run from temporal/:
 *   npx ts-node --project tsconfig.test.json scripts/smoke-test.ts
 */

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import { normalizeAzureOpenAiEnv, resolveAzureDeploymentName } from '../src/azure_openai';
import type { DSLInput } from '../src/workflows/dsl/interpreter';

// ── Real activities (no stubs) ────────────────────────────────────────────
import * as supabaseCore    from '../src/activities/supabase_core';
import * as notifications   from '../src/activities/notifications';
import * as httpRequest     from '../src/activities/http_request';
import * as supabaseQuery   from '../src/activities/supabase_query';
import * as evaluateDecision from '../src/activities/evaluate_decision';
import * as transformData   from '../src/activities/transform_data';
import * as webSearch       from '../src/activities/web_search';
import * as webCrawl        from '../src/activities/web_crawl';
import * as domainProbe     from '../src/activities/domain_probe';
import * as llmAgent        from '../src/activities/llm_agent';

// ── Logger ────────────────────────────────────────────────────────────────

function log(label: string, data?: unknown) {
  const ts = new Date().toISOString().substring(11, 23);
  const indent = data !== undefined ? '\n' + JSON.stringify(data, null, 2) : '';
  console.log(`[${ts}] ${label}${indent}`);
}

function divider(title: string) {
  console.log(`\n${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`);
}

// ── Detect provider ───────────────────────────────────────────────────────

function detectProvider(): { provider: string; model_id: string } {
  normalizeAzureOpenAiEnv();

  // Priority: explicit override, then Azure (mna-app), then Anthropic, OpenAI, Groq
  if (process.env.PIAGENT_PROVIDER && process.env.PIAGENT_MODEL_ID) {
    return { provider: process.env.PIAGENT_PROVIDER, model_id: process.env.PIAGENT_MODEL_ID };
  }
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_BASE_URL) {
    return {
      provider: 'azure-openai-responses',
      model_id: resolveAzureDeploymentName(process.env),
    };
  }
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model_id: 'claude-haiku-4-5-20251001' };
  if (process.env.OPENAI_API_KEY)    return { provider: 'openai',    model_id: 'gpt-4o-mini' };
  if (process.env.GROQ_API_KEY)      return { provider: 'groq',      model_id: 'llama-3.3-70b-versatile' };
  throw new Error(
    'No LLM API key found. Set one of:\n' +
    '  AZURE_API_KEY + AZURE_API_BASE (mna-app style)\n' +
    '  ANTHROPIC_API_KEY\n' +
    '  OPENAI_API_KEY\n' +
    '  GROQ_API_KEY',
  );
}

// ── Smoke test definitions ────────────────────────────────────────────────

/**
 * Test 1: simple structured output, no tools.
 * Asks the LLM to classify a company into a vertical.
 */
function makeSingleShotDSL(provider: string, model_id: string): DSLInput {
  return {
    definition: {
      name: 'smoke-classification', version: '1.0.0',
      description: 'Single-shot company classification with structured output',
      steps: {
        sequence: {
          steps: [
            {
              activity: {
                name: 'llm_agent',
                args: {
                  provider,
                  model_id,
                  system_prompt:
                    'You are a company industry analyst. Classify companies accurately and concisely.',
                  user_prompt:
                    'Classify Stripe Inc (stripe.com) into an industry vertical.',
                  response_schema: {
                    type: 'object',
                    required: ['vertical', 'sub_vertical', 'reasoning', 'confidence'],
                    properties: {
                      vertical:     { type: 'string', description: 'Broad industry (e.g. financial_services, technology)' },
                      sub_vertical: { type: 'string', description: 'Specific niche (e.g. payments, developer_tools)' },
                      reasoning:    { type: 'string' },
                      confidence:   { type: 'number', minimum: 0, maximum: 1 },
                    },
                    additionalProperties: false,
                  },
                  schema_name: 'company_classification',
                  temperature: 0,
                  max_tokens: 400,
                },
                result: 'classification',
                start_to_close_timeout: '60s',
                retry: { max_attempts: 2 },
                output_schema: {
                  type: 'object',
                  required: ['parsed'],
                  properties: {
                    parsed: {
                      type: 'object',
                      required: ['vertical', 'sub_vertical'],
                    },
                    content_filter_blocked: { type: 'boolean' },
                  },
                },
              },
            },
            {
              set_variable: {
                name: 'summary',
                value: 'Classified $input.company_name as $var.classification.parsed.vertical / $var.classification.parsed.sub_vertical',
              },
            },
          ],
        },
      },
    },
    input: { company_name: 'Stripe Inc', domain: 'stripe.com' },
  };
}

/**
 * Test 2: tool-use loop — model can call search_web before classifying.
 * With EXA_API_KEY set this hits real Exa; without it the built-in stub returns [].
 */
function makeToolUseDSL(provider: string, model_id: string): DSLInput {
  return {
    definition: {
      name: 'smoke-tool-use', version: '1.0.0',
      description: 'Classification with web search tool available',
      steps: {
        activity: {
          name: 'llm_agent',
          args: {
            provider,
            model_id,
            system_prompt:
              'You are a company analyst. You may search the web to find more information before classifying. Always call submit_response when done.',
            user_prompt:
              'Classify Linear (linear.app) — the project management tool. Use search_web if you need more context.',
            tools: [
              {
                name: 'search_web',
                description: 'Search the web for information about a company.',
                parameters: {
                  type: 'object',
                  required: ['query'],
                  properties: {
                    query: { type: 'string' },
                    count: { type: 'number' },
                  },
                },
              },
            ],
            response_schema: {
              type: 'object',
              required: ['vertical', 'sub_vertical', 'confidence'],
              properties: {
                vertical:     { type: 'string' },
                sub_vertical: { type: 'string' },
                confidence:   { type: 'number', minimum: 0, maximum: 1 },
                used_search:  { type: 'boolean' },
              },
              additionalProperties: false,
            },
            schema_name: 'classification_with_search',
            temperature: 0,
            max_tokens: 600,
            max_tool_rounds: 3,
          },
          result: 'linear_classification',
          start_to_close_timeout: '90s',
          retry: { max_attempts: 2 },
        },
      },
    },
    input: {},
  };
}

/**
 * Test 3: crawl_site verification — model crawls a real page and summarises content.
 * With EXA_API_KEY set this fetches live page content; without it pages returns [].
 */
function makeCrawlSiteDSL(provider: string, model_id: string): DSLInput {
  return {
    definition: {
      name: 'smoke-crawl-site', version: '1.0.0',
      description: 'Verify crawl_site returns real page content',
      steps: {
        activity: {
          name: 'llm_agent',
          args: {
            provider,
            model_id,
            system_prompt:
              'You are a research assistant. Use crawl_site to fetch page content, then summarise what the company does based on what you read.',
            user_prompt:
              'Crawl stripe.com and summarise what Stripe does based on the page content you retrieve.',
            tools: [
              {
                name: 'crawl_site',
                description: 'Crawl a website and return its page content.',
                parameters: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string' },
                    subpages: { type: 'number' },
                  },
                },
              },
            ],
            response_schema: {
              type: 'object',
              required: ['summary', 'pages_crawled'],
              properties: {
                summary:       { type: 'string', description: 'What the company does, based on crawled content.' },
                pages_crawled: { type: 'number', description: 'Number of pages returned by crawl_site.' },
              },
              additionalProperties: false,
            },
            schema_name: 'crawl_summary',
            temperature: 0,
            max_tokens: 400,
            max_tool_rounds: 2,
          },
          result: 'crawl_result',
          start_to_close_timeout: '90s',
          retry: { max_attempts: 2 },
        },
      },
    },
    input: {},
  };
}

// ── Assertions ────────────────────────────────────────────────────────────

/** Throws with a clear message if condition is false — makes the smoke test exit non-zero. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// ── Tool result display ───────────────────────────────────────────────────

/**
 * Print a tool call result with first-result details for search_web / crawl_site,
 * so real web data is visible in the trace when EXA_API_KEY is set.
 */
function printToolResult(toolName: string, result: Record<string, unknown>) {
  const exaSet = Boolean(process.env.EXA_API_KEY);
  const stubSuffix = exaSet ? '' : '  [stub — EXA_API_KEY not set]';

  if (toolName === 'search_web') {
    const results = Array.isArray(result.results)
      ? (result.results as Array<Record<string, unknown>>)
      : [];
    console.log(`        result: ${results.length} result(s)${stubSuffix}`);
    results.slice(0, 3).forEach((r, j) => {
      console.log(`          [${j + 1}] ${r.title ?? '(no title)'} — ${r.url ?? ''}`);
      if (r.text) console.log(`               ${String(r.text).slice(0, 120)}...`);
    });
    return;
  }

  if (toolName === 'crawl_site') {
    const pages = Array.isArray(result.pages)
      ? (result.pages as Array<Record<string, unknown>>)
      : [];
    console.log(`        result: ${pages.length} page(s)${stubSuffix}`);
    pages.slice(0, 3).forEach((p, j) => {
      console.log(`          [${j + 1}] ${p.title ?? '(no title)'} — ${p.url ?? ''}`);
      if (p.content) console.log(`               ${String(p.content).slice(0, 120)}...`);
    });
    return;
  }

  console.log(`        result: ${JSON.stringify(result).slice(0, 120)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  divider('TEMPORAL DSL SMOKE TEST — real LLM calls');

  const { provider, model_id } = detectProvider();
  log(`Provider: ${provider}  |  Model: ${model_id}`);
  log(`EXA_API_KEY: ${process.env.EXA_API_KEY ? 'set (real web search)' : 'not set (search returns stub [])'}`);

  // ── Boot Temporal test env ────────────────────────────────────────────
  divider('Booting Temporal TestWorkflowEnvironment...');
  Runtime.install({ logger: new DefaultLogger('WARN') });
  const testEnv = await TestWorkflowEnvironment.createLocal();
  log('TestWorkflowEnvironment ready');

  const worker = await Worker.create({
    connection:    testEnv.nativeConnection,
    namespace:     'default',
    taskQueue:     'smoke',
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
  const workerHandle = worker.run();
  log('Worker running');

  try {
    // ── Test 1: single-shot structured output ───────────────────────────
    divider('TEST 1: Single-shot structured output (Stripe classification)');

    const t1start = Date.now();
    const t1result = await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [makeSingleShotDSL(provider, model_id)],
      taskQueue:  'smoke',
      workflowId: `smoke-single-${Date.now()}`,
    }) as Record<string, unknown>;
    const t1ms = Date.now() - t1start;

    const classification = t1result.classification as Record<string, unknown>;
    log(`Completed in ${t1ms}ms`);
    log('Raw LlmAgentResult:', classification);

    if (classification?.parsed) {
      const parsed = classification.parsed as Record<string, unknown>;
      log('── Parsed classification output ──');
      console.log(`  vertical:     ${parsed.vertical}`);
      console.log(`  sub_vertical: ${parsed.sub_vertical}`);
      console.log(`  confidence:   ${parsed.confidence}`);
      console.log(`  reasoning:    ${parsed.reasoning}`);
    }
    log(`  provider: ${classification?.provider}  model: ${classification?.model}`);
    log(`  tokens: ${classification?.prompt_tokens} in / ${classification?.completion_tokens} out`);
    log(`  content_filter_blocked: ${classification?.content_filter_blocked}`);
    log(`  tool_calls executed: ${(classification?.tool_calls as unknown[])?.length ?? 0}`);
    log(`DSL variable 'summary': ${t1result.summary}`);

    // ── Assertions: Test 1 ─────────────────────────────────────────────
    assert(classification?.parsed != null, 'Test 1: classification.parsed must exist');
    const t1parsed = classification.parsed as Record<string, unknown>;
    assert(typeof t1parsed.vertical === 'string' && t1parsed.vertical.length > 0,
      'Test 1: parsed.vertical must be a non-empty string');
    assert(typeof t1parsed.sub_vertical === 'string' && t1parsed.sub_vertical.length > 0,
      'Test 1: parsed.sub_vertical must be a non-empty string');
    log('Assertions passed ✓');

    // ── Test 2: tool-use loop ───────────────────────────────────────────
    divider('TEST 2: Tool-use loop (Linear classification, search_web available)');

    const t2start = Date.now();
    const t2result = await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [makeToolUseDSL(provider, model_id)],
      taskQueue:  'smoke',
      workflowId: `smoke-tools-${Date.now()}`,
    }) as Record<string, unknown>;
    const t2ms = Date.now() - t2start;

    const linear = t2result.linear_classification as Record<string, unknown>;
    log(`Completed in ${t2ms}ms`);
    log('Raw LlmAgentResult:', linear);

    const toolCalls = linear?.tool_calls as Array<Record<string, unknown>> ?? [];
    log(`── Tool calls executed: ${toolCalls.length} ──`);
    toolCalls.forEach((tc, i) => {
      console.log(`  [${i + 1}] ${tc.name}(`);
      console.log(`        args:   ${JSON.stringify(tc.arguments)}`);
      const result = tc.result as Record<string, unknown>;
      printToolResult(tc.name as string, result);
      console.log(`  )`);
    });

    if (linear?.parsed) {
      const parsed = linear.parsed as Record<string, unknown>;
      log('── Parsed classification output ──');
      console.log(`  vertical:     ${parsed.vertical}`);
      console.log(`  sub_vertical: ${parsed.sub_vertical}`);
      console.log(`  confidence:   ${parsed.confidence}`);
      console.log(`  used_search:  ${parsed.used_search}`);
    }
    log(`  tokens: ${linear?.prompt_tokens} in / ${linear?.completion_tokens} out`);

    // ── Assertions: Test 2 ─────────────────────────────────────────────
    assert(toolCalls.length > 0,
      'Test 2: model must have called search_web at least once (tool-use loop did not fire)');
    const searchCall = toolCalls.find((tc) => tc.name === 'search_web');
    assert(searchCall != null,
      'Test 2: expected a search_web tool call but none was recorded');
    if (process.env.EXA_API_KEY) {
      const searchResult = searchCall.result as Record<string, unknown>;
      const searchResults = Array.isArray(searchResult.results) ? searchResult.results : [];
      assert(searchResults.length > 0,
        'Test 2: EXA_API_KEY is set but search_web returned 0 results — check the API key and Exa connectivity');
    }
    assert(linear?.parsed != null, 'Test 2: linear_classification.parsed must exist');
    const t2parsed = linear.parsed as Record<string, unknown>;
    assert(typeof t2parsed.vertical === 'string' && t2parsed.vertical.length > 0,
      'Test 2: parsed.vertical must be a non-empty string');
    log('Assertions passed ✓');

    // ── Test 3: crawl_site verification ────────────────────────────────
    divider('TEST 3: crawl_site verification (stripe.com page content)');

    const t3start = Date.now();
    const t3result = await testEnv.client.workflow.execute('DSLWorkflow', {
      args: [makeCrawlSiteDSL(provider, model_id)],
      taskQueue:  'smoke',
      workflowId: `smoke-crawl-${Date.now()}`,
    }) as Record<string, unknown>;
    const t3ms = Date.now() - t3start;

    const crawl = t3result.crawl_result as Record<string, unknown>;
    log(`Completed in ${t3ms}ms`);
    log('Raw LlmAgentResult:', crawl);

    const crawlToolCalls = crawl?.tool_calls as Array<Record<string, unknown>> ?? [];
    log(`── Tool calls executed: ${crawlToolCalls.length} ──`);
    crawlToolCalls.forEach((tc, i) => {
      console.log(`  [${i + 1}] ${tc.name}(`);
      console.log(`        args:   ${JSON.stringify(tc.arguments)}`);
      const result = tc.result as Record<string, unknown>;
      printToolResult(tc.name as string, result);
      console.log(`  )`);
    });

    if (crawl?.parsed) {
      const parsed = crawl.parsed as Record<string, unknown>;
      log('── Parsed crawl summary ──');
      console.log(`  summary:       ${parsed.summary}`);
      console.log(`  pages_crawled: ${parsed.pages_crawled}`);
    }
    log(`  tokens: ${crawl?.prompt_tokens} in / ${crawl?.completion_tokens} out`);

    // ── Assertions: Test 3 ─────────────────────────────────────────────
    assert(crawlToolCalls.length > 0,
      'Test 3: model must have called crawl_site at least once (tool-use loop did not fire)');
    const crawlCall = crawlToolCalls.find((tc) => tc.name === 'crawl_site');
    assert(crawlCall != null,
      'Test 3: expected a crawl_site tool call but none was recorded');
    const crawlCallResult = crawlCall.result as Record<string, unknown>;
    const actualPages = Array.isArray(crawlCallResult.pages) ? crawlCallResult.pages : [];
    if (process.env.EXA_API_KEY) {
      assert(actualPages.length > 0,
        'Test 3: EXA_API_KEY is set but crawl_site returned 0 pages — check the API key and Exa connectivity');
    }
    assert(crawl?.parsed != null, 'Test 3: crawl_result.parsed must exist');
    const t3parsed = crawl.parsed as Record<string, unknown>;
    assert(typeof t3parsed.summary === 'string' && t3parsed.summary.length > 0,
      'Test 3: parsed.summary must be a non-empty string');
    // The model reports pages_crawled — verify it matches what crawl_site actually returned.
    const reportedPageCount = typeof t3parsed.pages_crawled === 'number' ? t3parsed.pages_crawled : -1;
    assert(reportedPageCount === actualPages.length,
      `Test 3: parsed.pages_crawled (${reportedPageCount}) does not match actual pages returned by crawl_site (${actualPages.length})`);
    log('Assertions passed ✓');

    // ── Summary ─────────────────────────────────────────────────────────
    divider('SMOKE TEST COMPLETE');
    console.log('  Test 1 (single-shot):  PASS ✓');
    console.log('  Test 2 (tool-use):     PASS ✓');
    console.log('  Test 3 (crawl_site):   PASS ✓');
    console.log(`  Provider used:         ${provider} / ${model_id}`);
    console.log(`  Total wall-clock:      ${t1ms + t2ms + t3ms}ms`);

  } catch (err) {
    divider('SMOKE TEST FAILED');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await worker.shutdown();
    await workerHandle;
    await testEnv.teardown();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
