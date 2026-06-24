/**
 * llm_agent — universal LLM activity built on @earendil-works/pi-ai.
 *
 * pi-ai provides a unified API across all major LLM providers:
 * Anthropic, OpenAI, Azure OpenAI, AWS Bedrock, Google, Mistral, Groq,
 * Cerebras, DeepSeek, OpenRouter, and any OpenAI-compatible endpoint.
 *
 * DESIGN — config-driven, nothing hard-coded here:
 *   provider         e.g. "anthropic", "openai", "amazon-bedrock"
 *   model_id         provider-specific model ID (see @earendil-works/pi-ai)
 *   system_prompt    template-interpolated by the DSL layer before call
 *   user_prompt      same — DSL resolves $var.* / $input.* first
 *   tools            JSON Schema tool declarations (converted to pi-ai format)
 *   mcp_servers      HTTP MCP servers to dispatch named tool calls to
 *   response_schema  enforced via a mandatory "submit_response" tool call
 *
 * Built-in tools (no config required):
 *   search_web   — Exa Search
 *   crawl_site   — Exa Contents
 *
 * Provider auth: each provider reads from standard env vars (pi-ai resolves them):
 *   Anthropic:   ANTHROPIC_API_KEY
 *   OpenAI:      OPENAI_API_KEY
 *   Azure:       AZURE_OPENAI_API_KEY + AZURE_OPENAI_BASE_URL
 *                (or AZURE_OPENAI_ENDPOINT / AZURE_API_KEY + AZURE_API_BASE aliases)
 *   Bedrock:     AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION
 *   Google:      GOOGLE_API_KEY (or Application Default Credentials)
 *   OpenRouter:  OPENROUTER_API_KEY
 *   Groq:        GROQ_API_KEY
 *   Mistral:     MISTRAL_API_KEY
 *
 * ESM note: @earendil-works/pi-ai is an ESM-only package. Because this worker
 * compiles to CommonJS (Temporal webpack requirement), we load pi-ai via
 * dynamic import() using a Function wrapper that bypasses the CommonJS static
 * import transform. This is a standard interop pattern for ESM-only packages
 * in CJS environments and has no impact on correctness or type safety.
 */
import { log } from "@temporalio/activity";
import { normalizeAzureOpenAiEnv, resolveAzureDeploymentName } from "../azure_openai";
import { web_crawl } from "./web_crawl";
import { web_search } from "./web_search";

// ── Azure env-var aliases ────────────────────────────────────────────────
// pi-ai reads AZURE_OPENAI_API_KEY and AZURE_OPENAI_BASE_URL.
// Many environments (including mna-app) use AZURE_API_KEY / AZURE_API_BASE.
// Backfill the pi-ai names from the aliases so both naming conventions work.
// Canonical AZURE_OPENAI_* vars take precedence; aliases are used only when canonical vars are unset.
// The official Azure SDK name AZURE_OPENAI_ENDPOINT is also accepted.
normalizeAzureOpenAiEnv();

// ── Lazy ESM loader (CJS-safe) ────────────────────────────────────────────

// TypeScript transforms `import(...)` to `require(...)` in CJS mode.
// This function bypasses that transform to load ESM-only packages.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<Record<string, unknown>>;

type PiAiModule = typeof import("@earendil-works/pi-ai");

// Cached module reference — loaded once on first activity call
let _piAi: PiAiModule | null = null;

async function loadPiAi(): Promise<PiAiModule> {
  if (_piAi) return _piAi;
  _piAi = (await importEsm("@earendil-works/pi-ai")) as PiAiModule;
  return _piAi;
}

// ── Public types ──────────────────────────────────────────────────────────

/** Plain JSON Schema tool definition passed from DSL definitions */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for the tool arguments */
  parameters: Record<string, unknown>;
}

export interface McpServerConfig {
  name: string;
  url: string;
  auth_token?: string;
  headers?: Record<string, string>;
}

export interface LlmAgentArgs {
  // ── Provider selection ────────────────────────────────────────────────
  /**
   * pi-ai provider identifier, e.g. "anthropic", "openai", "amazon-bedrock",
   * "google", "azure-openai-responses", "openrouter".
   * Defaults to PIAGENT_PROVIDER env var → "anthropic".
   */
  provider?: string;
  /**
   * Provider-specific model ID as registered in @earendil-works/pi-ai.
   * e.g. "claude-sonnet-4-6", "gpt-4o", "anthropic.claude-sonnet-4-6" (Bedrock).
   * Defaults to PIAGENT_MODEL_ID env var → sensible per-provider default.
   */
  model_id?: string;

  // ── Prompts ──────────────────────────────────────────────────────────
  system_prompt: string;
  user_prompt: string;

  // ── Tools ─────────────────────────────────────────────────────────────
  tools?: ToolDefinition[];
  mcp_servers?: McpServerConfig[];

  // ── Response contract ─────────────────────────────────────────────────
  /**
   * JSON Schema the model's response must conform to.
   * Enforced by appending a mandatory "submit_response" tool that the model
   * must call. The DSL output_schema is the second validation layer.
   */
  response_schema?: Record<string, unknown>;
  schema_name?: string;

  // ── Model config ──────────────────────────────────────────────────────
  temperature?: number;
  max_tokens?: number;
  /** Max tool-call rounds before forcing final answer. Default 5. */
  max_tool_rounds?: number;

  _idempotency_key?: string;
}

export interface LlmToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface LlmAgentResult {
  /** Parsed JSON when response_schema provided */
  parsed?: Record<string, unknown>;
  /** Raw text when no response_schema */
  text?: string;
  tool_calls: LlmToolCall[];
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  content_filter_blocked: boolean;
}

// ── Provider defaults ─────────────────────────────────────────────────────

const PROVIDER_MODEL_DEFAULTS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  "amazon-bedrock": "anthropic.claude-sonnet-4-6",
  google: "gemini-2.0-flash",
  // azure-openai-responses has no default — deployment name must be given explicitly.
  // Set PIAGENT_MODEL_ID (preferred), AZURE_OPENAI_DEPLOYMENT, or AZURE_API_DEPLOYMENT.
  openrouter: "anthropic/claude-sonnet-4-5",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
};

// ── Tool dispatch ─────────────────────────────────────────────────────────

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  mcp: McpServerConfig[]
): Promise<unknown> {
  // Built-in: Exa search
  if (name === "search_web") {
    return web_search({
      query: String(args.query ?? ""),
      num_results: typeof args.count === "number" ? args.count : undefined,
    });
  }
  // Built-in: Exa crawl
  if (name === "crawl_site") {
    return web_crawl({
      url: String(args.url ?? ""),
      subpages: typeof args.subpages === "number" ? args.subpages : undefined,
    });
  }
  // MCP dispatch: match by tool name prefix or exact name
  const server = mcp.find(
    (s) => s.name === name || name.startsWith(`${s.name}/`) || name.startsWith(`${s.name}_`)
  );
  if (server) {
    const url = `${server.url.replace(/\/$/, "")}/tools/${encodeURIComponent(name)}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...server.headers,
    };
    if (server.auth_token) headers.Authorization = `Bearer ${server.auth_token}`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(args) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `MCP tool "${name}" HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return res.json();
  }

  log.warn("llm_agent: no handler for tool", { tool: name });
  return { error: `Tool "${name}" has no handler. Add it to mcp_servers or use a built-in.` };
}

// ── Main activity ─────────────────────────────────────────────────────────

const SUBMIT_TOOL = "submit_response";

export async function llm_agent(args: LlmAgentArgs): Promise<LlmAgentResult> {
  const pi = await loadPiAi();
  const { getModel, complete, getEnvApiKey, Type } = pi;

  const provider = args.provider ?? process.env.PIAGENT_PROVIDER ?? "anthropic";
  // For Azure, require an explicit deployment name rather than silently falling back to a
  // default. resolveAzureDeploymentName checks PIAGENT_MODEL_ID, AZURE_OPENAI_DEPLOYMENT,
  // and AZURE_API_DEPLOYMENT in priority order and throws with a clear message when none
  // is set — preventing a hidden fallback from masking a missing deployment (issue #62).
  const modelId =
    args.model_id ??
    process.env.PIAGENT_MODEL_ID ??
    (provider === "azure-openai-responses"
      ? resolveAzureDeploymentName(process.env)
      : (PROVIDER_MODEL_DEFAULTS[provider] ?? "claude-sonnet-4-6"));

  // Verify credentials are available (Bedrock and Vertex use IAM / ADC, not a simple API key)
  const apiKey = (getEnvApiKey as (p: string) => string | undefined)(provider);
  if (!apiKey && !["amazon-bedrock", "google-vertex"].includes(provider)) {
    throw new Error(
      `No API key found for provider "${provider}". ` +
        `Set the appropriate env var (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY).`
    );
  }

  // ── Azure: use openai-completions with Chat API instead of Responses API ──
  // The azure-openai-responses provider calls the OpenAI Responses API (/v1/responses)
  // which many Azure deployments do not support. Azure's Chat Completions API
  // (/openai/v1/chat/completions) is universally available and accepts api-key + api-version
  // as request headers. We build a custom model object to use openai-completions.
  let model: unknown;
  if (provider === "azure-openai-responses") {
    const azureBaseUrl = process.env.AZURE_OPENAI_BASE_URL ?? "";
    const azureApiKey = process.env.AZURE_OPENAI_API_KEY ?? "";
    const azureVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2025-03-01-preview";
    if (!azureBaseUrl)
      throw new Error(
        "AZURE_OPENAI_BASE_URL (or AZURE_API_BASE) is required for provider azure-openai-responses"
      );
    model = {
      id: modelId,
      name: `Azure ${modelId}`,
      api: "openai-completions",
      provider: "openai",
      baseUrl: `${azureBaseUrl.replace(/\/$/, "")}/openai/v1`,
      reasoning: false,
      input: ["text", "image"] as string[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384,
      headers: {
        "api-key": azureApiKey,
        "api-version": azureVersion,
      },
    };
  } else {
    model = (getModel as (p: string, m: string) => unknown)(provider, modelId);
  }
  const useSchema = !!args.response_schema;
  const schemaName = args.schema_name ?? "response";
  const mcpServers = args.mcp_servers ?? [];
  const maxRounds = args.max_tool_rounds ?? (args.tools?.length || useSchema ? 5 : 0);

  log.info("llm_agent", {
    provider,
    model: modelId,
    schema: useSchema ? schemaName : "text",
    tools: args.tools?.map((t) => t.name) ?? [],
    mcp: mcpServers.map((s) => s.name),
    maxRounds,
  });

  // Convert JSON Schema tool definitions to pi-ai Tool format using Type.Unsafe()
  // Type.Unsafe wraps a plain JSON Schema object as a TypeBox schema without transformation.
  type PiTool = { name: string; description: string; parameters: unknown };

  const makeTools = (): PiTool[] => {
    const tools: PiTool[] = (args.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: (Type as { Unsafe: (s: unknown) => unknown }).Unsafe(t.parameters),
    }));

    // Always provide built-in web tools
    if (!tools.find((t) => t.name === "search_web")) {
      tools.push({
        name: "search_web",
        description: "Search the web for information.",
        parameters: (Type as { Unsafe: (s: unknown) => unknown }).Unsafe({
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Search query" },
            count: { type: "number", description: "Number of results (default 5)" },
          },
        }),
      });
    }
    if (!tools.find((t) => t.name === "crawl_site")) {
      tools.push({
        name: "crawl_site",
        description: "Fetch and return the content of a web page.",
        parameters: (Type as { Unsafe: (s: unknown) => unknown }).Unsafe({
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: "URL to fetch" },
            subpages: { type: "number", description: "Subpages to include (default 0)" },
          },
        }),
      });
    }

    // submit_response tool enforces response_schema when present
    if (useSchema) {
      tools.push({
        name: SUBMIT_TOOL,
        description: `Submit the final structured response conforming to the ${schemaName} schema. You MUST call this tool.`,
        parameters: (Type as { Unsafe: (s: unknown) => unknown }).Unsafe(args.response_schema!),
      });
    }

    return tools;
  };

  type PiContext = {
    systemPrompt?: string;
    messages: unknown[];
    tools?: PiTool[];
  };

  const context: PiContext = {
    systemPrompt: args.system_prompt,
    messages: [{ role: "user", content: args.user_prompt, timestamp: 0 }],
    tools: makeTools(),
  };

  const executedCalls: LlmToolCall[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let lastMsg: Record<string, unknown> | null = null;
  let blocked = false;

  for (let round = 0; round <= maxRounds; round++) {
    // Final forced round: strip everything except submit_response
    if (round === maxRounds && context.tools?.length) {
      context.tools = useSchema ? context.tools.filter((t) => t.name === SUBMIT_TOOL) : undefined;
    }

    const msg = await (
      complete as unknown as (
        m: unknown,
        c: unknown,
        o?: unknown
      ) => Promise<Record<string, unknown>>
    )(model, context, {
      temperature: args.temperature ?? 0,
      maxTokens: args.max_tokens ?? 2000,
    }).catch((err: Error) => {
      if (/content.filter|safety|policy/i.test(err.message)) {
        blocked = true;
        return null as unknown as Record<string, unknown>;
      }
      throw err;
    });

    if (!msg) break;

    lastMsg = msg;
    const usage = msg.usage as { input: number; output: number };
    totalIn += usage?.input ?? 0;
    totalOut += usage?.output ?? 0;
    (context.messages as unknown[]).push(msg);

    const content = msg.content as Array<{
      type: string;
      name?: string;
      arguments?: Record<string, unknown>;
      id?: string;
      text?: string;
    }>;
    const toolCalls = content.filter((b) => b.type === "toolCall");

    // Submit_response means the model delivered structured output
    const submitCall = toolCalls.find((tc) => tc.name === SUBMIT_TOOL);
    if (submitCall) {
      return {
        parsed: submitCall.arguments as Record<string, unknown>,
        tool_calls: executedCalls,
        provider,
        model: String(msg.model ?? modelId),
        prompt_tokens: totalIn,
        completion_tokens: totalOut,
        content_filter_blocked: false,
      };
    }

    // No tool calls — model finished with text
    if (!toolCalls.length || msg.stopReason === "stop") {
      const text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      // When response_schema was given and the model didn't call submit_response,
      // we cannot satisfy the schema contract — throw so Temporal can retry.
      if (useSchema && round < maxRounds) {
        throw new Error(
          `llm_agent: model returned text instead of calling "${SUBMIT_TOOL}" — schema not satisfied. ` +
            `stop_reason=${msg.stopReason}. Text preview: ${text.slice(0, 200)}`
        );
      }
      return {
        text: useSchema ? undefined : text || undefined,
        tool_calls: executedCalls,
        provider,
        model: String(msg.model ?? modelId),
        prompt_tokens: totalIn,
        completion_tokens: totalOut,
        content_filter_blocked: false,
      };
    }

    // Execute tool calls and feed results back
    for (const tc of toolCalls) {
      const result = await dispatchTool(tc.name!, tc.arguments ?? {}, mcpServers);
      executedCalls.push({ name: tc.name!, arguments: tc.arguments ?? {}, result });
      (context.messages as unknown[]).push({
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
        timestamp: 0,
      });
    }
  }

  // Exhausted rounds or content filter
  if (blocked) {
    return {
      tool_calls: executedCalls,
      provider,
      model: String(lastMsg?.model ?? modelId),
      prompt_tokens: totalIn,
      completion_tokens: totalOut,
      content_filter_blocked: true,
    };
  }

  const text = ((lastMsg?.content as Array<{ type: string; text?: string }>) ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  return {
    text: text || undefined,
    tool_calls: executedCalls,
    provider,
    model: String(lastMsg?.model ?? modelId),
    prompt_tokens: totalIn,
    completion_tokens: totalOut,
    content_filter_blocked: false,
  };
}
