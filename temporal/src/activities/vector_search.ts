import { log } from "@temporalio/activity";
import { Client } from "pg";
import { config } from "../config";
import { llm_embeddings } from "./llm_embeddings";

export interface VectorSearchArgs {
  query: string;
  table: string;
  embedding_column: string;
  content_column: string;
  limit?: number;
  threshold?: number;
  provider?: string;
  model_id?: string;
  _idempotency_key?: string;
}

export interface VectorSearchResultItem {
  id: string;
  content: string;
  similarity: number;
}

export interface VectorSearchResult {
  results: VectorSearchResultItem[];
}

/**
 * Approved table/column combinations for vector search.
 * Each entry defines the only valid combination of table, embedding column,
 * and content column. Add new entries here when new vector-search targets
 * are introduced; never accept caller-supplied arbitrary identifiers.
 */
export const ALLOWED_SEARCH_TARGETS = [
  { table: "documents", embedding_column: "embedding", content_column: "content" },
] as const;

type AllowedTarget = (typeof ALLOWED_SEARCH_TARGETS)[number];

function assertAllowedTarget(
  table: string,
  embedding_column: string,
  content_column: string
): AllowedTarget {
  const match = ALLOWED_SEARCH_TARGETS.find(
    (t) =>
      t.table === table &&
      t.embedding_column === embedding_column &&
      t.content_column === content_column
  );
  if (!match) {
    const supported = ALLOWED_SEARCH_TARGETS.map(
      (t) => `${t.table}(${t.embedding_column}, ${t.content_column})`
    ).join(", ");
    throw new Error(
      `vector_search: table/column combination "${table}"/"${embedding_column}"/"${content_column}" ` +
        `is not in the approved allowlist. Supported targets: ${supported}`
    );
  }
  return match;
}

export async function vector_search(args: VectorSearchArgs): Promise<VectorSearchResult> {
  const target = assertAllowedTarget(args.table, args.embedding_column, args.content_column);

  const limit = Math.max(1, Math.min(100, args.limit ?? 10));
  const threshold = args.threshold ?? 0.0;

  const { embeddings } = await llm_embeddings({
    texts: [args.query],
    provider: args.provider as Parameters<typeof llm_embeddings>[0]["provider"],
    model_id: args.model_id,
    _idempotency_key: args._idempotency_key ? `${args._idempotency_key}:embed` : undefined,
  });

  const queryEmbedding = embeddings[0];
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  if (!config.databaseUrl) {
    throw new Error("vector_search: DATABASE_URL is required");
  }

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    const sql =
      "SELECT id::text, " +
      target.content_column +
      "::text AS content, " +
      "1 - (" +
      target.embedding_column +
      " <=> $1::vector) AS similarity " +
      "FROM " +
      target.table +
      " " +
      "WHERE 1 - (" +
      target.embedding_column +
      " <=> $1::vector) > $2 " +
      "ORDER BY " +
      target.embedding_column +
      " <=> $1::vector " +
      "LIMIT $3";

    const { rows } = await client.query<VectorSearchResultItem>(sql, [
      vectorLiteral,
      threshold,
      limit,
    ]);

    log.info("vector_search", {
      table: target.table,
      result_count: rows.length,
      limit,
      threshold,
    });

    return { results: rows };
  } finally {
    await client.end().catch(() => {
      // Best-effort cleanup; do not mask the original error.
    });
  }
}
