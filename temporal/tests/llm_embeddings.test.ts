jest.mock("@temporalio/activity", () => ({
  log: { info: jest.fn(), warn: jest.fn() },
}));

import { llm_embeddings } from "../src/activities/llm_embeddings";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeFetchMock(status: number, body: unknown): jest.MockedFunction<typeof fetch> {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }) as unknown as jest.MockedFunction<typeof fetch>;
}

function makeOpenAIResponse(embeddings: number[][], model = "text-embedding-3-small") {
  return {
    object: "list",
    data: embeddings.map((embedding, i) => ({ object: "embedding", index: i, embedding })),
    model,
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}

const STUB_EMBEDDING = Array.from({ length: 1536 }, (_, i) => i / 1536);

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  delete process.env.EMBEDDING_PROVIDER;
  delete process.env.EMBEDDING_MODEL_ID;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_BASE_URL;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.COHERE_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

// ── Unit: validation ──────────────────────────────────────────────────────

describe("llm_embeddings unit — validation", () => {
  it("throws on empty texts array", async () => {
    await expect(llm_embeddings({ texts: [] })).rejects.toThrow("texts must be a non-empty array");
  });

  it("throws when OPENAI_API_KEY is missing for openai provider", async () => {
    await expect(llm_embeddings({ texts: ["hello"], provider: "openai" })).rejects.toThrow(
      "OPENAI_API_KEY is required"
    );
  });

  it("throws when AZURE_OPENAI_API_KEY is missing for azure provider", async () => {
    process.env.AZURE_OPENAI_BASE_URL = "https://example.openai.azure.com";
    await expect(llm_embeddings({ texts: ["hello"], provider: "azure" })).rejects.toThrow(
      "AZURE_OPENAI_API_KEY is required"
    );
  });

  it("throws when AZURE_OPENAI_BASE_URL is missing for azure provider", async () => {
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    await expect(llm_embeddings({ texts: ["hello"], provider: "azure" })).rejects.toThrow(
      "AZURE_OPENAI_BASE_URL is required"
    );
  });

  it("throws when COHERE_API_KEY is missing for cohere provider", async () => {
    await expect(llm_embeddings({ texts: ["hello"], provider: "cohere" })).rejects.toThrow(
      "COHERE_API_KEY is required"
    );
  });
});

// ── Unit: OpenAI provider ─────────────────────────────────────────────────

describe("llm_embeddings unit — openai provider", () => {
  it("calls OpenAI /v1/embeddings and returns parsed result", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const mockBody = makeOpenAIResponse([STUB_EMBEDDING]);
    global.fetch = makeFetchMock(200, mockBody);

    const result = await llm_embeddings({
      texts: ["hello world"],
      provider: "openai",
      model_id: "text-embedding-3-small",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Bearer "),
        }),
      })
    );

    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toHaveLength(1536);
    expect(result.model).toBe("text-embedding-3-small");
    expect(result.tokens).toBe(10);
  });

  it("embeds multiple texts in a single request", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const mockBody = makeOpenAIResponse([STUB_EMBEDDING, STUB_EMBEDDING]);
    global.fetch = makeFetchMock(200, mockBody);

    const result = await llm_embeddings({ texts: ["a", "b"], provider: "openai" });

    expect(result.embeddings).toHaveLength(2);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as {
      input: string[];
    };
    expect(body.input).toEqual(["a", "b"]);
  });

  it("uses EMBEDDING_PROVIDER env var when provider arg is omitted", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.EMBEDDING_PROVIDER = "openai";
    const mockBody = makeOpenAIResponse([STUB_EMBEDDING]);
    global.fetch = makeFetchMock(200, mockBody);

    const result = await llm_embeddings({ texts: ["hello"] });
    expect(result.embeddings).toHaveLength(1);
  });

  it("uses EMBEDDING_MODEL_ID env var when model_id arg is omitted", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.EMBEDDING_MODEL_ID = "text-embedding-3-large";
    const mockBody = makeOpenAIResponse([STUB_EMBEDDING], "text-embedding-3-large");
    global.fetch = makeFetchMock(200, mockBody);

    await llm_embeddings({ texts: ["hello"], provider: "openai" });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as {
      model: string;
    };
    expect(body.model).toBe("text-embedding-3-large");
  });

  it("throws a descriptive error on HTTP 401", async () => {
    process.env.OPENAI_API_KEY = "sk-bad-key";
    global.fetch = makeFetchMock(401, { error: { message: "Unauthorized" } });

    await expect(llm_embeddings({ texts: ["hello"], provider: "openai" })).rejects.toThrow(
      "llm_embeddings: openai HTTP 401"
    );
  });
});

// ── Unit: Azure provider ──────────────────────────────────────────────────

describe("llm_embeddings unit — azure provider", () => {
  it("calls Azure deployment endpoint with api-key header", async () => {
    process.env.AZURE_OPENAI_API_KEY = "azure-key-123";
    process.env.AZURE_OPENAI_BASE_URL = "https://myresource.openai.azure.com";
    process.env.AZURE_OPENAI_API_VERSION = "2024-02-01";

    const mockBody = makeOpenAIResponse([STUB_EMBEDDING]);
    global.fetch = makeFetchMock(200, mockBody);

    const result = await llm_embeddings({
      texts: ["hello"],
      provider: "azure",
      model_id: "my-embed-deployment",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://myresource.openai.azure.com/openai/deployments/my-embed-deployment/embeddings?api-version=2024-02-01",
      expect.objectContaining({
        headers: expect.objectContaining({ "api-key": "azure-key-123" }),
      })
    );
    expect(result.embeddings).toHaveLength(1);
  });

  it("accepts AZURE_API_KEY as an alias for AZURE_OPENAI_API_KEY", async () => {
    process.env.AZURE_API_KEY = "alias-key";
    process.env.AZURE_OPENAI_BASE_URL = "https://myresource.openai.azure.com";

    const mockBody = makeOpenAIResponse([STUB_EMBEDDING]);
    global.fetch = makeFetchMock(200, mockBody);

    await llm_embeddings({ texts: ["hello"], provider: "azure", model_id: "dep" });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "api-key": "alias-key" }),
      })
    );
  });
});

// ── Unit: Cohere provider ─────────────────────────────────────────────────

describe("llm_embeddings unit — cohere provider", () => {
  it("calls Cohere /v1/embed and returns parsed result", async () => {
    process.env.COHERE_API_KEY = "cohere-test-key";

    const mockBody = {
      id: "test-id",
      embeddings: [Array.from({ length: 1024 }, () => 0.1)],
      meta: { billed_units: { input_tokens: 5 } },
    };
    global.fetch = makeFetchMock(200, mockBody);

    const result = await llm_embeddings({
      texts: ["hello"],
      provider: "cohere",
      model_id: "embed-english-v3.0",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.cohere.com/v1/embed",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("Bearer ") }),
        body: JSON.stringify({
          texts: ["hello"],
          model: "embed-english-v3.0",
          input_type: "search_document",
        }),
      })
    );

    expect(result.embeddings[0]).toHaveLength(1024);
    expect(result.tokens).toBe(5);
  });

  it("returns zero tokens when Cohere meta is absent", async () => {
    process.env.COHERE_API_KEY = "cohere-test-key";

    const mockBody = { embeddings: [[0.1, 0.2]] };
    global.fetch = makeFetchMock(200, mockBody);

    const result = await llm_embeddings({ texts: ["hello"], provider: "cohere" });
    expect(result.tokens).toBe(0);
  });
});

// ── E2E: real API call (skipped unless OPENAI_API_KEY is set) ─────────────

describe.skip("llm_embeddings e2e (requires real API key — run locally only)", () => {
  it("e2e: openai returns 1536-dimensional embeddings for 3 texts", async () => {
    const { llm_embeddings: embed } = await import("../src/activities/llm_embeddings");
    const result = await embed({
      texts: [
        "The quick brown fox jumps over the lazy dog",
        "Machine learning and artificial intelligence",
        "JavaScript is a versatile programming language",
      ],
      provider: "openai",
      model_id: "text-embedding-3-small",
    });

    expect(result.embeddings).toHaveLength(3);
    for (const emb of result.embeddings) {
      expect(emb).toHaveLength(1536);
    }
    expect(result.tokens).toBeGreaterThan(0);
  });
});
