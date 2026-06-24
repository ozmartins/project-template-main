import { log } from "@temporalio/activity";

type EmbeddingsProvider = "openai" | "azure" | "cohere";

export interface LlmEmbeddingsArgs {
  texts: string[];
  provider?: EmbeddingsProvider;
  model_id?: string;
  _idempotency_key?: string;
}

export interface LlmEmbeddingsResult {
  embeddings: number[][];
  model: string;
  tokens: number;
}

interface OpenAIEmbeddingsResponse {
  data: Array<{ embedding: number[] }>;
  model: string;
  usage?: { total_tokens?: number };
}

interface CohereEmbeddingsResponse {
  embeddings?: number[][];
  model?: string;
  meta?: {
    billed_units?: {
      input_tokens?: number;
    };
  };
}

function assertNonEmptyTexts(texts: string[]): void {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("llm_embeddings: texts must be a non-empty array");
  }
  if (texts.some((text) => typeof text !== "string" || text.trim().length === 0)) {
    throw new Error("llm_embeddings: each text must be a non-empty string");
  }
}

async function parseErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 600);
}

async function fetchOpenAIEmbeddings(texts: string[], model: string): Promise<LlmEmbeddingsResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("llm_embeddings: OPENAI_API_KEY is required for provider openai");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: ["Bearer", apiKey].join(" "),
    },
    body: JSON.stringify({ input: texts, model }),
  });

  if (!response.ok) {
    throw new Error(
      `llm_embeddings: openai HTTP ${response.status}: ${await parseErrorBody(response)}`
    );
  }

  const payload = (await response.json()) as OpenAIEmbeddingsResponse;
  return {
    embeddings: payload.data.map((item) => item.embedding),
    model: payload.model ?? model,
    tokens: payload.usage?.total_tokens ?? 0,
  };
}

async function fetchAzureEmbeddings(texts: string[], model: string): Promise<LlmEmbeddingsResult> {
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? process.env.AZURE_API_KEY;
  const endpoint =
    process.env.AZURE_OPENAI_ENDPOINT ??
    process.env.AZURE_OPENAI_BASE_URL ??
    process.env.AZURE_API_BASE;
  if (!apiKey) {
    throw new Error("llm_embeddings: AZURE_OPENAI_API_KEY is required for provider azure");
  }
  if (!endpoint) {
    throw new Error("llm_embeddings: AZURE_OPENAI_BASE_URL is required for provider azure");
  }

  const base = endpoint.replace(/\/$/, "");
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01";
  const response = await fetch(
    `${base}/openai/deployments/${encodeURIComponent(model)}/embeddings?api-version=${apiVersion}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({ input: texts }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `llm_embeddings: azure HTTP ${response.status}: ${await parseErrorBody(response)}`
    );
  }

  const payload = (await response.json()) as OpenAIEmbeddingsResponse;
  return {
    embeddings: payload.data.map((item) => item.embedding),
    model,
    tokens: payload.usage?.total_tokens ?? 0,
  };
}

async function fetchCohereEmbeddings(texts: string[], model: string): Promise<LlmEmbeddingsResult> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error("llm_embeddings: COHERE_API_KEY is required for provider cohere");
  }

  const response = await fetch("https://api.cohere.com/v1/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: ["Bearer", apiKey].join(" "),
    },
    body: JSON.stringify({ texts, model, input_type: "search_document" }),
  });

  if (!response.ok) {
    throw new Error(
      `llm_embeddings: cohere HTTP ${response.status}: ${await parseErrorBody(response)}`
    );
  }

  const payload = (await response.json()) as CohereEmbeddingsResponse;
  return {
    embeddings: payload.embeddings ?? [],
    model: payload.model ?? model,
    tokens: payload.meta?.billed_units?.input_tokens ?? 0,
  };
}

export async function llm_embeddings(args: LlmEmbeddingsArgs): Promise<LlmEmbeddingsResult> {
  assertNonEmptyTexts(args.texts);

  const provider: EmbeddingsProvider =
    args.provider ?? (process.env.EMBEDDING_PROVIDER as EmbeddingsProvider | undefined) ?? "openai";
  const model =
    args.model_id ??
    process.env.EMBEDDING_MODEL_ID ??
    (provider === "cohere" ? "embed-english-v3.0" : "text-embedding-3-small");

  log.info("llm_embeddings", { provider, model, text_count: args.texts.length });

  const result =
    provider === "azure"
      ? await fetchAzureEmbeddings(args.texts, model)
      : provider === "cohere"
        ? await fetchCohereEmbeddings(args.texts, model)
        : await fetchOpenAIEmbeddings(args.texts, model);

  if (result.embeddings.length !== args.texts.length) {
    throw new Error(
      `llm_embeddings: expected ${args.texts.length} embeddings but received ${result.embeddings.length}`
    );
  }

  return result;
}
