jest.mock("@temporalio/activity", () => ({
  log: {
    info: jest.fn(),
  },
}));

const mockEmbeddings = jest.fn();
jest.mock("../src/activities/llm_embeddings", () => ({
  llm_embeddings: (args: unknown) => mockEmbeddings(args),
}));

import { randomUUID } from "node:crypto";
import { Client } from "pg";

const databaseUrl = process.env.VECTOR_SEARCH_E2E_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const embeddingByText: Record<string, number[]> = {
  "cats are playful pets": [1, 0, 0],
  "dogs enjoy daily walks": [0.8, 0.2, 0],
  "weather forecasts mention rain": [0, 0, 1],
  "kittens play indoors": [0.95, 0.05, 0],
};

describeIfDatabase("vector_search e2e (pgvector)", () => {
  const tableName = `documents_vector_search_e2e_${randomUUID().replace(/-/g, "_")}`;
  let client: Client;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("create extension if not exists vector");
    await client.query(`
      create table ${tableName} (
        id text primary key,
        content text not null,
        embedding vector(3) not null
      )
    `);

    const docs = [
      { id: "doc-1", content: "cats are playful pets" },
      { id: "doc-2", content: "dogs enjoy daily walks" },
      { id: "doc-3", content: "weather forecasts mention rain" },
    ];

    for (const doc of docs) {
      const embedding = embeddingByText[doc.content];
      await client.query(
        `insert into ${tableName} (id, content, embedding) values ($1, $2, $3::vector)`,
        [doc.id, doc.content, `[${embedding.join(",")}]`]
      );
    }

    mockEmbeddings.mockImplementation(async ({ texts }: { texts: string[] }) => ({
      embeddings: texts.map((text) => embeddingByText[text] ?? [0, 0, 0]),
      model: "stub-e2e",
      tokens: 0,
    }));
  });

  afterAll(async () => {
    await client.query(`drop table if exists ${tableName}`);
    await client.end();
    jest.resetAllMocks();
  });

  it("orders semantic matches by similarity", async () => {
    const { vector_search } = await import("../src/activities/vector_search");

    const result = await vector_search({
      query: "kittens play indoors",
      table: tableName,
      embedding_column: "embedding",
      content_column: "content",
      limit: 3,
    });

    expect(result.results.map((item) => item.id)).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(result.results[0].similarity).toBeGreaterThan(result.results[1].similarity);
    expect(result.results[1].similarity).toBeGreaterThan(result.results[2].similarity);
  });
});
