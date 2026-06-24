/**
 * web_crawl — live page content fetch for a URL.
 * Powered by Exa Contents API when EXA_API_KEY is set.
 */
import { log } from "@temporalio/activity";
import { config } from "../config";

export interface WebCrawlArgs {
  url: string;
  /** Number of relevant subpages to fetch alongside homepage. Default 3. */
  subpages?: number;
  /** Max characters per page. Default 8000. */
  max_chars?: number;
  _idempotency_key?: string;
}

export interface CrawledPage {
  url: string;
  title: string;
  content: string;
}

export interface WebCrawlResult {
  url: string;
  pages: CrawledPage[];
}

export async function web_crawl(args: WebCrawlArgs): Promise<WebCrawlResult> {
  log.info("web_crawl", { url: args.url });

  if (!config.exaApiKey) {
    log.warn("web_crawl: EXA_API_KEY not set — returning stub result");
    return { url: args.url, pages: [] };
  }

  const subpages = Math.min(args.subpages ?? 3, 10);
  const maxChars = args.max_chars ?? 8000;
  const subpageTargets = ["about", "products", "solutions", "industries", "customers"];

  const res = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.exaApiKey,
    },
    body: JSON.stringify({
      ids: [args.url],
      livecrawl: "preferred",
      subpages,
      subpageTarget: subpageTargets,
      text: { maxCharacters: maxChars },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`web_crawl: Exa HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    results: Array<{
      url: string;
      title?: string;
      text?: string;
      subpages?: Array<{ url: string; title?: string; text?: string }>;
    }>;
  };

  const pages: CrawledPage[] = [];
  for (const r of json.results ?? []) {
    pages.push({ url: r.url, title: r.title ?? "", content: r.text ?? "" });
    for (const sub of r.subpages ?? []) {
      pages.push({ url: sub.url, title: sub.title ?? "", content: sub.text ?? "" });
    }
  }

  return { url: args.url, pages };
}
