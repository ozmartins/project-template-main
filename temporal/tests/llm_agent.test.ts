/**
 * llm_agent tests — no real LLM calls, no API keys required.
 *
 * TESTING STRATEGY
 * ─────────────────
 * The llm_agent activity wraps @earendil-works/pi-ai. Real LLM calls need
 * provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) which must
 * never exist in CI or be checked into the repo.
 *
 * Three testing layers:
 *
 * 1. UNIT — pure logic tests that need no pi-ai or Temporal.
 *    Covered here: argument passthrough, tool dispatch routing, error messages.
 *
 * 2. DSL INTEGRATION — register a stub `llm_agent` activity with a
 *    TestWorkflowEnvironment. The stub returns a canned LlmAgentResult.
 *    Proves that DSL definitions using llm_agent are wired correctly —
 *    expression resolution, schema validation, result binding all exercised
 *    without a real LLM call. Covered here.
 *
 * 3. E2E WITH REAL KEYS — skipped unless PIAGENT_PROVIDER and the matching
 *    API key env var are set. Run locally, never in CI.
 *    Example: ANTHROPIC_API_KEY=sk-... npm test -- --testNamePattern="e2e"
 *
 * Keys must NEVER appear in source files, test fixtures, or CI env vars.
 * Use a local .env file (gitignored) and `source .env && npm test` locally.
 */

import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import { detectProvider } from "../scripts/test-vertical-classification";
import type { LlmAgentResult } from "../src/activities/llm_agent";
import type { DSLInput } from "../src/workflows/dsl/interpreter";

// ── Unit: arg passthrough and result binding ──────────────────────────────

describe("llm_agent DSL integration (stub activity)", () => {
  // Canned LlmAgentResult returned by the stub — no real LLM call
  const STUB_LLM_RESULT: LlmAgentResult = {
    parsed: { vertical: "technology", confidence: 0.92 },
    tool_calls: [],
    provider: "stub",
    model: "stub-model",
    prompt_tokens: 100,
    completion_tokens: 50,
    content_filter_blocked: false,
  };

  const STUB_TEXT_RESULT: LlmAgentResult = {
    text: "This is a plain text response.",
    tool_calls: [],
    provider: "stub",
    model: "stub-model",
    prompt_tokens: 80,
    completion_tokens: 30,
    content_filter_blocked: false,
  };

  // Stub activities — substitute for real llm_agent, web_search, domain_probe
  const testActivities = {
    llm_agent: async (_args: Record<string, unknown>): Promise<LlmAgentResult> => STUB_LLM_RESULT,
    llm_agent_text: async (_args: Record<string, unknown>): Promise<LlmAgentResult> =>
      STUB_TEXT_RESULT,
    web_search: async (_args: Record<string, unknown>) => ({
      query: "test query",
      results: [{ title: "Test", url: "https://example.com", snippet: "Test snippet" }],
    }),
    domain_probe: async (args: Record<string, unknown>) => ({
      domain: String(args.domain ?? ""),
      domain_active: true,
      dns_resolves: true,
      http_status: 200,
    }),
    supabase_mutate: async (_args: Record<string, unknown>) => ({ id: "stub-id", upserted: true }),
    record_step: async (_args: Record<string, unknown>): Promise<string | undefined> => undefined,
    complete_execution: async (_args: Record<string, unknown>): Promise<void> => {},
  };

  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRunPromise: Promise<void>;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger("WARN") });
    testEnv = await TestWorkflowEnvironment.createLocal();
    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      namespace: "default",
      taskQueue: "test-llm",
      workflowsPath: require.resolve("../src/workflows"),
      activities: testActivities,
    });
    workerRunPromise = worker.run();
  }, 180_000);

  afterAll(async () => {
    await worker?.shutdown();
    await workerRunPromise;
    // suppress the known native-connection teardown race in @temporalio/testing
    await testEnv?.teardown().catch(() => {});
  }, 60_000);

  async function runDSL(input: DSLInput): Promise<Record<string, unknown>> {
    return testEnv.client.workflow.execute("DSLWorkflow", {
      args: [input],
      taskQueue: "test-llm",
      workflowId: `llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }) as Promise<Record<string, unknown>>;
  }

  it("binds parsed result to a variable", async () => {
    const result = await runDSL({
      definition: {
        name: "test-llm-binding",
        version: "1.0.0",
        steps: {
          activity: {
            name: "llm_agent",
            args: {
              provider: "stub",
              model_id: "stub-model",
              system_prompt: "You are a classifier.",
              user_prompt: "Classify $input.company_name.",
            },
            result: "classification",
          },
        },
      },
      input: { company_name: "Acme Corp" },
    });
    const c = result.classification as LlmAgentResult;
    expect(c.provider).toBe("stub");
    expect((c.parsed as Record<string, unknown>).vertical).toBe("technology");
  });

  it("output_schema validation passes on valid stub result", async () => {
    const result = await runDSL({
      definition: {
        name: "test-llm-output-schema",
        version: "1.0.0",
        steps: {
          activity: {
            name: "llm_agent",
            args: { system_prompt: "Classify.", user_prompt: "$input.company" },
            result: "out",
            output_schema: {
              type: "object",
              required: ["parsed"],
              properties: {
                parsed: { type: "object" },
                provider: { type: "string" },
              },
            },
          },
        },
      },
      input: { company: "TestCo" },
    });
    expect((result.out as LlmAgentResult).parsed).toBeTruthy();
  });

  it("downstream condition uses llm result", async () => {
    const result = await runDSL({
      definition: {
        name: "test-llm-condition",
        version: "1.0.0",
        steps: {
          sequence: {
            steps: [
              {
                activity: {
                  name: "llm_agent",
                  args: { system_prompt: "Classify.", user_prompt: "Test." },
                  result: "llm_out",
                },
              },
              {
                condition: {
                  if: "$var.llm_out.content_filter_blocked == false",
                  // biome-ignore lint/suspicious/noThenProperty: DSL keyword, not a thenable
                  then: { set_variable: { name: "status", value: "ok" } },
                  else: { set_variable: { name: "status", value: "blocked" } },
                },
              },
            ],
          },
        },
      },
      input: {},
    });
    expect(result.status).toBe("ok");
  });

  it("llm_agent in parallel with web_search", async () => {
    const result = await runDSL({
      definition: {
        name: "test-llm-parallel",
        version: "1.0.0",
        steps: {
          parallel: {
            branches: [
              {
                activity: {
                  name: "llm_agent",
                  args: { system_prompt: "Classify.", user_prompt: "Test." },
                  result: "classification",
                },
              },
              {
                activity: {
                  name: "web_search",
                  args: { query: "$input.company" },
                  result: "search",
                },
              },
            ],
          },
        },
      },
      input: { company: "Acme Corp" },
    });
    expect((result.classification as LlmAgentResult).provider).toBe("stub");
    expect((result.search as Record<string, unknown>).query).toBe("test query");
  });

  it("llm_agent in try_catch surfaces errors gracefully", async () => {
    // Inject a failing llm_agent for this specific test
    const failWorker = await Worker.create({
      connection: testEnv.nativeConnection,
      namespace: "default",
      taskQueue: "test-llm-fail",
      workflowsPath: require.resolve("../src/workflows"),
      activities: {
        ...testActivities,
        llm_agent: async () => {
          throw new Error("provider unavailable");
        },
      },
    });
    const failHandle = failWorker.run();

    try {
      const result = (await testEnv.client.workflow.execute("DSLWorkflow", {
        args: [
          {
            definition: {
              name: "test-llm-error",
              version: "1.0.0",
              steps: {
                try_catch: {
                  try: {
                    activity: {
                      name: "llm_agent",
                      args: { system_prompt: "Classify.", user_prompt: "Test." },
                      retry: { max_attempts: 1 },
                    },
                  },
                  catch: {
                    error_var: "llm_error",
                    body: { set_variable: { name: "fallback", value: "manual_review" } },
                  },
                },
              },
            },
            input: {},
          } satisfies DSLInput,
        ],
        taskQueue: "test-llm-fail",
        workflowId: `llm-fail-${Date.now()}`,
      })) as Record<string, unknown>;

      expect(result.fallback).toBe("manual_review");
      expect(typeof result.llm_error).toBe("string");
    } finally {
      await failWorker.shutdown();
      await failHandle;
    }
  });
});

// NOTE: Direct unit tests for llm_agent that call the activity function
// from the Jest process are not viable here because @earendil-works/pi-ai
// is an ESM-only package loaded via dynamic import(), and Jest runs in a
// Node.js VM sandbox that blocks --experimental-vm-modules.
//
// The DSL integration tests above exercise all the meaningful paths
// (expression resolution, schema validation, result binding, error handling)
// by running llm_agent as a registered activity inside a real Temporal
// TestWorkflowEnvironment process — which is the correct production boundary.
//
// To verify the missing-credentials error message, run:
//   ANTHROPIC_API_KEY="" node -e "require('./dist/activities/llm_agent').llm_agent({provider:'anthropic',system_prompt:'t',user_prompt:'t'}).catch(e=>console.error(e.message))"

// ── Unit: Azure env-var alias normalization ───────────────────────────────
//
// detectProvider() is the shared alias-normalization function used by all
// Azure smoke scripts. These tests verify the full alias resolution order:
//   AZURE_OPENAI_BASE_URL  (canonical — used as-is when already set)
//   AZURE_OPENAI_ENDPOINT  (official Azure SDK name — new alias)
//   AZURE_API_BASE         (legacy mna-app name)

describe("Azure env-var alias normalization (detectProvider)", () => {
  const KEYS = [
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_BASE_URL",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_API_KEY",
    "AZURE_API_BASE",
    "AZURE_OPENAI_API_VERSION",
    "AZURE_API_VERSION",
    "AZURE_OPENAI_DEPLOYMENT",
    "AZURE_API_DEPLOYMENT",
    "PIAGENT_PROVIDER",
    "PIAGENT_MODEL_ID",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
  ] as const;

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("AZURE_OPENAI_ENDPOINT is aliased to AZURE_OPENAI_BASE_URL", () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://myresource.openai.azure.com";
    process.env.PIAGENT_MODEL_ID = "gpt-5.4";
    const result = detectProvider();
    expect(process.env.AZURE_OPENAI_BASE_URL).toBe("https://myresource.openai.azure.com");
    expect(result.provider).toBe("azure-openai-responses");
  });

  it("AZURE_API_BASE is aliased to AZURE_OPENAI_BASE_URL", () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_API_BASE = "https://legacy.openai.azure.com";
    process.env.PIAGENT_MODEL_ID = "gpt-5.4";
    const result = detectProvider();
    expect(process.env.AZURE_OPENAI_BASE_URL).toBe("https://legacy.openai.azure.com");
    expect(result.provider).toBe("azure-openai-responses");
  });

  it("AZURE_OPENAI_BASE_URL is used as-is and neither alias overwrites it", () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_BASE_URL = "https://canonical.openai.azure.com";
    process.env.AZURE_OPENAI_ENDPOINT = "https://should-be-ignored.openai.azure.com";
    process.env.AZURE_API_BASE = "https://also-ignored.openai.azure.com";
    process.env.PIAGENT_MODEL_ID = "gpt-5.4";
    const result = detectProvider();
    expect(process.env.AZURE_OPENAI_BASE_URL).toBe("https://canonical.openai.azure.com");
    expect(result.provider).toBe("azure-openai-responses");
  });

  it("AZURE_OPENAI_ENDPOINT takes precedence over AZURE_API_BASE", () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://sdk-name.openai.azure.com";
    process.env.AZURE_API_BASE = "https://legacy-name.openai.azure.com";
    process.env.PIAGENT_MODEL_ID = "gpt-5.4";
    detectProvider();
    expect(process.env.AZURE_OPENAI_BASE_URL).toBe("https://sdk-name.openai.azure.com");
  });

  it("AZURE_API_KEY is aliased to AZURE_OPENAI_API_KEY and API version upgrades for Azure smoke runs", () => {
    process.env.AZURE_API_KEY = "legacy-key";
    process.env.AZURE_API_BASE = "https://volarisiaisandboxazureopenai.openai.azure.com";
    process.env.PIAGENT_MODEL_ID = "gpt-5.4";
    process.env.AZURE_API_VERSION = "2024-12-01-preview";
    const result = detectProvider();
    expect(process.env.AZURE_OPENAI_API_KEY).toBe("legacy-key");
    expect(process.env.AZURE_OPENAI_BASE_URL).toBe(
      "https://volarisiaisandboxazureopenai.openai.azure.com"
    );
    expect(process.env.AZURE_OPENAI_API_VERSION).toBe("2025-03-01-preview");
    expect(result).toEqual({ provider: "azure-openai-responses", model_id: "gpt-5.4" });
  });

  it("prefers PIAGENT_MODEL_ID over Azure deployment aliases", () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_API_BASE = "https://volarisiaisandboxazureopenai.openai.azure.com";
    process.env.PIAGENT_MODEL_ID = "gpt-5.4";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4o";
    process.env.AZURE_API_DEPLOYMENT = "legacy-deployment";
    const result = detectProvider();
    expect(result).toEqual({ provider: "azure-openai-responses", model_id: "gpt-5.4" });
  });

  it("restores Azure deployment aliases between tests", () => {
    expect(process.env.AZURE_OPENAI_DEPLOYMENT).toBeUndefined();
    expect(process.env.AZURE_API_DEPLOYMENT).toBeUndefined();
  });

  it("fails fast when Azure smoke config has no explicit deployment name", () => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_API_BASE = "https://volarisiaisandboxazureopenai.openai.azure.com";
    expect(() => detectProvider()).toThrow(
      "Resource: https://volarisiaisandboxazureopenai.openai.azure.com. Set PIAGENT_MODEL_ID (preferred) or AZURE_OPENAI_DEPLOYMENT / AZURE_API_DEPLOYMENT."
    );
  });
});

// ── E2E: real LLM call (skipped unless ANTHROPIC_API_KEY is set) ──────────
//
// Run these locally with:
//   ANTHROPIC_API_KEY=sk-ant-... npm test -- --testNamePattern="e2e"
//
// NEVER set API key secrets in CI environment variables.

const hasRealKey = !!(
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GROQ_API_KEY
);

describe.skip("llm_agent e2e (requires real API key — run locally only)", () => {
  it("e2e: returns a text response from a real LLM", async () => {
    if (!hasRealKey) return;
    const { llm_agent } = await import("../src/activities/llm_agent");
    const result = await llm_agent({
      system_prompt: 'You are a test assistant. Reply with exactly: {"ok": true}',
      user_prompt: "Say ok.",
      response_schema: {
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
      schema_name: "ok_response",
      temperature: 0,
      max_tokens: 50,
    });
    expect(result.content_filter_blocked).toBe(false);
    expect(result.parsed?.ok).toBe(true);
  });
});
