import { appendFileSync } from "node:fs";

const LOG_LEVEL = process.env["LOG_LEVEL"] ?? "info";
const STEP_SUMMARY = process.env["GITHUB_STEP_SUMMARY"];

function timestamp(): string {
  return new Date().toISOString();
}

export function log(level: string, message: string, meta?: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: timestamp(), level, msg: message, ...meta });
  console.log(entry);
}

export function info(message: string, meta?: Record<string, unknown>): void {
  log("info", message, meta);
}

export function warn(message: string, meta?: Record<string, unknown>): void {
  log("warn", message, meta);
}

export function error(message: string, meta?: Record<string, unknown>): void {
  log("error", message, meta);
}

export function writeSummary(content: string): void {
  if (STEP_SUMMARY) {
    appendFileSync(STEP_SUMMARY, content + "\n");
  } else {
    console.log("[SUMMARY]", content);
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "\n  ...(truncated)" : str;
}

/** Attach a console event logger to a Copilot SDK session so Actions logs show agent activity. */
type ToolRequest = { name?: string };
/**
 * Union-friendly event payload shape used by attachLogger.
 * Fields are optional because each event type provides a different subset.
 */
type SessionEventData = {
  [key: string]: unknown;
  selectedModel?: string;
  errorType?: string;
  message?: string;
  shutdownType?: string;
  totalApiDurationMs?: number;
  errorReason?: string;
  totalPremiumRequests?: unknown;
  content?: string;
  toolRequests?: ToolRequest[];
  toolName?: string;
  arguments?: unknown;
  success?: boolean;
  result?: { content?: string };
  error?: { message?: string };
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};
type SessionEvent = { type: string; data: SessionEventData };
/** Minimal event-stream contract so logging stays decoupled from SDK-specific session types. */
type SessionLike = {
  on: (listener: (event: unknown) => void) => void;
};

function isSessionEvent(event: unknown): event is SessionEvent {
  return typeof event === "object" && event !== null && "type" in event && "data" in event;
}

/** Attach a console event logger to a session-like event stream so Actions logs show agent activity. */
export function attachLogger(session: SessionLike): void {
  let turnCount = 0;
  let turnStartMs = 0;
  const sessionStartMs = Date.now();
  const elapsed = () => `+${((Date.now() - sessionStartMs) / 1000).toFixed(1)}s`;

  session.on((event) => {
    if (!isSessionEvent(event)) return;

    const t = elapsed();
    switch (event.type) {
      case "session.start":
        console.log(`[${t}] SESSION START model=${event.data.selectedModel ?? "default"}`);
        break;
      case "session.idle":
        console.log(`[${t}] SESSION IDLE — agent finished`);
        break;
      case "session.error":
        console.error(`[${t}] SESSION ERROR [${event.data.errorType}]: ${event.data.message}`);
        break;
      case "session.shutdown": {
        const d = event.data;
        const premiumRequests = (d as { totalPremiumRequests?: unknown }).totalPremiumRequests;
        const apiCalls = typeof premiumRequests === "number" ? premiumRequests : undefined;
        console.log(
          `[${t}] SESSION COMPLETE type=${d.shutdownType} apiCalls=${apiCalls ?? "n/a"} duration=${d.totalApiDurationMs}ms`
        );
        if (d.shutdownType === "error" && d.errorReason) console.error(`   Error: ${d.errorReason}`);
        break;
      }
      case "assistant.turn_start":
        turnCount++;
        turnStartMs = Date.now();
        console.log(`\n[${t}] Turn ${turnCount}`);
        break;
      case "assistant.turn_end":
        console.log(`[${t}] Turn ${turnCount} done (${((Date.now() - turnStartMs) / 1000).toFixed(1)}s)`);
        break;
      case "assistant.message":
        if (event.data.content) console.log(`[${t}] ASSISTANT: ${truncate(event.data.content, 400)}`);
        if (event.data.toolRequests?.length)
          console.log(
            `   → tools: ${event.data.toolRequests.map((r) => r.name ?? "unknown").join(", ")}`
          );
        break;
      case "tool.execution_start":
        console.log(`[${t}] TOOL ${event.data.toolName}: ${truncate(typeof event.data.arguments === "string" ? event.data.arguments : JSON.stringify(event.data.arguments ?? ""), 300)}`);
        break;
      case "tool.execution_complete":
        if (event.data.success) {
          const out = event.data.result?.content;
          if (out) console.log(`   OK: ${truncate(out, 300)}`);
        } else {
          console.log(`   FAIL: ${event.data.error?.message ?? "unknown"}`);
        }
        break;
      case "assistant.usage":
        console.log(`[${t}] USAGE ${event.data.model}: ${event.data.inputTokens ?? 0}in/${event.data.outputTokens ?? 0}out`);
        break;
    }
  });
}
