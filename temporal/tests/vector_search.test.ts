jest.mock("@temporalio/activity", () => ({
  log: { info: jest.fn(), warn: jest.fn() },
}));

// Stub llm_embeddings so unit tests need no API keys.
const STUB_EMBEDDING = Array.from({ length: 1536 }, (_, i) => i / 1536);

jest.mock("../src/activities/llm_embeddings", () => ({
  llm_embeddings: jest.fn().mockResolvedValue({
    embeddings: [STUB_EMBEDDING],
    model: "text-embedding-3-small",
    tokens: 10,
  }),
}));

// Mock pg Client to avoid needing a real database.
const mockQuery = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockEnd = jest.fn().mockResolvedValue(undefined);

jest.mock("pg", () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
  })),
}));

import { llm_embeddings } from "../src/activities/llm_embeddings";
import { vector_search } from "../src/activities/vector_search";

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv, DATABASE_URL: "postgres://localhost:5432/test" };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ── Unit: allowlist validation ────────────────────────────────────────────

describe("vector_search unit — allowlist validation", () => {
  it("throws when table is not in the allowlist", async () => {
    await expect(
      vector_search({
        query: "test",
        table: "users",
        embedding_column: "embedding",
        content_column: "content",
      })
    ).rejects.toThrow("is not in the approved allowlist");
  });

  it("throws when embedding_column is not the approved column for the table", async () => {
    await expect(
      vector_search({
        query: "test",
        table: "documents",
        embedding_column: "other_embedding",
        content_column: "content",
      })
    ).rejects.toThrow("is not in the approved allowlist");
  });

  it("throws when content_column is not the approved column for the table", async () => {
    await expect(
      vector_search({
        query: "test",
        table: "documents",
        embedding_column: "embedding",
        content_column: "metadata",
      })
    ).rejects.toThrow("is not in the approved allowlist");
  });

  it("throws on a syntactically valid but unapproved table/column combination", async () => {
    await expect(
      vector_search({
        query: "test",
        table: "entity_versions",
        embedding_column: "embedding",
        content_column: "data",
      })
    ).rejects.toThrow("is not in the approved allowlist");
  });

  it("throws even when all identifiers look syntactically safe but the combination is not approved", async () => {
    await expect(
      vector_search({
        query: "test",
        table: "documents",
        embedding_column: "embedding",
        content_column: "created_at",
      })
    ).rejects.toThrow("is not in the approved allowlist");
  });

  it("accepts the approved documents/embedding/content combination", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
    });

    expect(result.results).toEqual([]);
  });
});

// ── Unit: DATABASE_URL requirement ────────────────────────────────────────

describe("vector_search unit — config", () => {
  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    await expect(
      vector_search({
        query: "test",
        table: "documents",
        embedding_column: "embedding",
        content_column: "content",
      })
    ).rejects.toThrow("DATABASE_URL is required");
  });
});

// ── Unit: embedding + SQL dispatch ────────────────────────────────────────

describe("vector_search unit — SQL construction", () => {
  it("calls llm_embeddings with the query text", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "semantic search query",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
      provider: "openai",
      model_id: "text-embedding-3-small",
    });

    expect(llm_embeddings).toHaveBeenCalledWith(
      expect.objectContaining({ texts: ["semantic search query"] })
    );
  });

  it("passes limit and threshold as bound parameters", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
      limit: 5,
      threshold: 0.7,
    });

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // $2 = threshold, $3 = limit
    expect(params[1]).toBe(0.7);
    expect(params[2]).toBe(5);
  });

  it("uses defaults of limit=10 and threshold=0 when not specified", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
    });

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(0.0);
    expect(params[2]).toBe(10);
  });

  it("clamps a negative limit to 1", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
      limit: -5,
    });

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe(1);
  });

  it("clamps an oversized limit to 100", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
      limit: 10000,
    });

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe(100);
  });

  it("clamps a zero limit to 1", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
      limit: 0,
    });

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe(1);
  });

  it("returns mapped result rows from pg", async () => {
    const rows = [
      { id: "id-1", content: "first result", similarity: 0.95 },
      { id: "id-2", content: "second result", similarity: 0.82 },
    ];
    mockQuery.mockResolvedValue({ rows });

    const result = await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
    });

    expect(result.results).toEqual(rows);
  });

  it("includes the approved table name and column names in the SQL string", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await vector_search({
      query: "test",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
    });

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain("documents");
    expect(sql).toContain("embedding");
    expect(sql).toContain("content");
  });

  it("disconnects the pg client even when the query throws", async () => {
    mockQuery.mockRejectedValue(new Error("query failed"));

    await expect(
      vector_search({
        query: "test",
        table: "documents",
        embedding_column: "embedding",
        content_column: "content",
      })
    ).rejects.toThrow("query failed");

    expect(mockEnd).toHaveBeenCalled();
  });
});

// ── E2E: real pgvector round-trip (skipped unless DATABASE_URL + key set) ─

describe.skip("vector_search e2e (requires real DATABASE_URL + embedding key — run locally only)", () => {
  it("e2e: embeds 3 strings, stores in pgvector, asserts similarity ordering", async () => {
    jest.unmock("../src/activities/llm_embeddings");
    jest.unmock("pg");

    const { Client } = await import("pg");
    const { llm_embeddings: embed } = await import("../src/activities/llm_embeddings");
    const { vector_search: search } = await import("../src/activities/vector_search");

    const DOCS = [
      "The quick brown fox jumps over the lazy dog",
      "Machine learning and artificial intelligence are transforming technology",
      "JavaScript is a versatile programming language for web development",
    ];

    const { embeddings } = await embed({ texts: DOCS, provider: "openai" });

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const ids: string[] = [];
    try {
      for (let i = 0; i < DOCS.length; i++) {
        const vectorLiteral = `[${embeddings[i].join(",")}]`;
        const { rows } = await client.query<{ id: string }>(
          "INSERT INTO documents (content, embedding) VALUES ($1, $2::vector) RETURNING id",
          [DOCS[i], vectorLiteral]
        );
        ids.push(rows[0].id);
      }
    } finally {
      await client.end();
    }

    const result = await search({
      query: "programming language web development",
      table: "documents",
      embedding_column: "embedding",
      content_column: "content",
      limit: 3,
      threshold: 0.0,
      provider: "openai",
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toContain("JavaScript");
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].similarity).toBeGreaterThanOrEqual(result.results[i].similarity);
    }

    const cleanupClient = new Client({ connectionString: process.env.DATABASE_URL });
    await cleanupClient.connect();
    try {
      await cleanupClient.query("DELETE FROM documents WHERE id = ANY($1)", [ids]);
    } finally {
      await cleanupClient.end();
    }
  });
});
