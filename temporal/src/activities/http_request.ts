import { log } from "@temporalio/activity";

type AuthConfig =
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "api_key"; header: string; key: string };

export interface HttpRequestArgs {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  auth?: AuthConfig;
  timeout?: number; // ms; default 30000
  expected_status?: number[]; // default [200, 201, 204]
  non_retryable_status?: number[]; // default [400, 401, 403, 404]
  result_path?: string; // dot-path into response JSON
  _idempotency_key?: string;
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function buildHeaders(args: HttpRequestArgs): Record<string, string> {
  const headers: Record<string, string> = { ...args.headers };
  if (!headers["Content-Type"] && args.body && args.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  if (args.auth) {
    const a = args.auth;
    if (a.type === "bearer") {
      headers.Authorization = `Bearer ${a.token}`;
    } else if (a.type === "basic") {
      const encoded = Buffer.from(`${a.username}:${a.password}`).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    } else if (a.type === "api_key") {
      headers[a.header] = a.key;
    }
  }
  return headers;
}

export async function http_request(args: HttpRequestArgs): Promise<unknown> {
  const {
    method,
    url,
    body,
    timeout = 30_000,
    expected_status = [200, 201, 204],
    non_retryable_status = [400, 401, 403, 404],
  } = args;

  const headers = buildHeaders(args);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  log.info("http_request", { method, url });

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`http_request network error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!expected_status.includes(response.status)) {
    const text = await response.text().catch(() => "");
    const message = `http_request: unexpected status ${response.status} from ${url}: ${text.slice(0, 200)}`;
    if (non_retryable_status.includes(response.status)) {
      // Throw a non-retryable error by marking it
      const err = new Error(message);
      (err as Error & { type?: string }).type = "NonRetryableError";
      throw err;
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return await response.text();
  }

  if (args.result_path) return getPath(json, args.result_path);
  return json;
}
