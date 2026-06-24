/**
 * web_search — text search returning ranked snippets.
 * Powered by Exa Search API when EXA_API_KEY is set,
 * falls back to a stub for local/test environments.
 */
import { log } from "@temporalio/activity";
import { config } from "../config";

export interface WebSearchArgs {
  query: string;
  /** Max results. Default 5. Max 25. */
  num_results?: number;
  /** Max characters per snippet. Default 400. */
  max_chars?: number;
  _idempotency_key?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
}

export interface WebSearchResult {
  query: string;
  results: SearchResult[];
}

export async function web_search(args: WebSearchArgs): Promise<WebSearchResult> {
  const numResults = Math.min(args.num_results ?? 5, 25);
  log.info("web_search", { query: args.query.slice(0, 80), num_results: numResults });

  if (!config.exaApiKey) {
    log.warn("web_search: EXA_API_KEY not set — returning stub results");
    return { query: args.query, results: [] };
  }

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.exaApiKey,
    },
    body: JSON.stringify({
      query: args.query,
      numResults,
      type: "neural",
      contents: {
        text: { maxCharacters: args.max_chars ?? 400 },
      },
      livecrawl: "preferred",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`web_search: Exa HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    results: Array<{
      title: string;
      url: string;
      text?: string;
      publishedDate?: string;
    }>;
  };

  return {
    query: args.query,
    results: (json.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.text ?? "",
      published_date: r.publishedDate,
    })),
  };
}
