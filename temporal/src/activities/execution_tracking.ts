import { log } from "@temporalio/activity";
import {
  config,
  MISSING_SUPABASE_SERVICE_ROLE_KEY,
  UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
} from "../config";

// \u2500\u2500 helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/** Truncate a value so its JSON representation stays within maxBytes. */
function truncatePreview(value: unknown, maxBytes: number): unknown {
  if (value === null || value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json.length <= maxBytes) return value;
  return { _truncated: true, preview: json.slice(0, maxBytes) };
}

function isSupabaseConfigured(): boolean {
  return !!(
    config.supabaseUrl &&
    config.supabaseServiceKey &&
    config.supabaseServiceKey !== MISSING_SUPABASE_SERVICE_ROLE_KEY &&
    config.supabaseServiceKey !== UNINJECTED_SUPABASE_SERVICE_ROLE_KEY
  );
}

function supabaseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
  };
}

function safeLogWarn(message: string, attributes: Record<string, unknown>): void {
  try {
    log.warn(message, attributes);
  } catch {
    // Unit tests call these helpers outside a Temporal activity context.
  }
}

function safeLogInfo(message: string, attributes: Record<string, unknown>): void {
  try {
    log.info(message, attributes);
  } catch {
    // Unit tests call these helpers outside a Temporal activity context.
  }
}

// \u2500\u2500 record_step \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface RecordStepArgs {
  workflow_id: string;
  step_index: number;
  step_name: string;
  /** 'running' on entry; 'completed' / 'failed' / 'skipped' on exit. */
  status: "running" | "completed" | "failed" | "skipped";
  /** Truncated to 2 KB. Only sent for the 'running' call. */
  input_preview?: unknown;
  /** Truncated to 2 KB. Only sent for the 'completed' call. */
  output_preview?: unknown;
  error_message?: string;
  /**
   * ISO timestamp returned by the 'running' call. Pass it back on the
   * 'completed'/'failed' call so the activity can compute duration_ms on
   * the activity side, keeping the workflow free of wall-clock calls.
   */
  started_at?: string;
}

/**
 * Upserts a row in workflow_execution_steps.
 *
 * Called twice per activity step by the DSL interpreter:
 *  - before: status='running'  \u2014 returns the started_at ISO string so the
 *            caller can pass it back on the completed/failed call.
 *  - after:  status='completed' | 'failed'. Pass the started_at value from
 *            the running call so duration_ms is computed here on the
 *            activity side (real wall-clock time, never in workflow code).
 *
 * Never throws \u2014 tracking failures are logged as warnings so the parent
 * workflow is never blocked by observability side-effects.
 */
export async function record_step(args: RecordStepArgs): Promise<string | undefined> {
  if (!isSupabaseConfigured()) {
    safeLogWarn("record_step: Supabase not configured, skipping step trace", {
      step_name: args.step_name,
      step_index: args.step_index,
    });
    return undefined;
  }

  // All timestamps are stamped here on the activity side so no wall-clock
  // calls are ever needed in workflow (non-determinism-safe) code.
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const body: Record<string, unknown> = {
    workflow_id: args.workflow_id,
    step_index: args.step_index,
    step_name: args.step_name,
    status: args.status,
  };

  if (args.status === "running") {
    // Stamp started_at explicitly so duration can be computed on the
    // completed/failed call without a round-trip to the DB.
    body.started_at = nowIso;
  } else {
    body.completed_at = nowIso;
    // Compute duration on the activity side using the started_at that was
    // returned from the earlier 'running' call and passed back by the
    // interpreter.
    if (args.started_at !== undefined) {
      const startedMs = new Date(args.started_at).getTime();
      if (!Number.isNaN(startedMs)) {
        body.duration_ms = Math.max(0, nowMs - startedMs);
      } else {
        safeLogWarn("record_step: started_at is not a valid ISO timestamp, skipping duration_ms", {
          started_at: args.started_at,
          step_name: args.step_name,
        });
      }
    }
  }

  if (args.input_preview !== undefined) {
    body.input_preview = truncatePreview(args.input_preview, 2048);
  }
  if (args.output_preview !== undefined) {
    body.output_preview = truncatePreview(args.output_preview, 2048);
  }
  if (args.error_message !== undefined) {
    body.error_message = args.error_message.slice(0, 2000);
  }

  const url = `${config.supabaseUrl}/rest/v1/workflow_execution_steps?on_conflict=workflow_id%2Cstep_index`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      safeLogWarn("record_step: write failed", {
        http_status: response.status,
        body: text.slice(0, 300),
        step_name: args.step_name,
      });
    }
  } catch (err) {
    safeLogWarn("record_step: network error", {
      error: String(err),
      step_name: args.step_name,
    });
  }

  // Advance current_step on the execution row so the UI can always show
  // which activity is active. Only patched on 'running' to avoid
  // overwriting the final step name on completion/failure.
  if (args.status === "running") {
    const execUrl =
      config.supabaseUrl +
      "/rest/v1/workflow_executions?workflow_id=eq." +
      encodeURIComponent(args.workflow_id);
    try {
      const execResponse = await fetch(execUrl, {
        method: "PATCH",
        headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ current_step: args.step_name }),
      });
      if (!execResponse.ok) {
        const text = await execResponse.text().catch(() => "");
        safeLogWarn("record_step: current_step update failed", {
          http_status: execResponse.status,
          body: text.slice(0, 300),
          step_name: args.step_name,
        });
      }
    } catch (err) {
      safeLogWarn("record_step: current_step network error", {
        error: String(err),
        step_name: args.step_name,
      });
    }
  }

  // Return started_at so the interpreter can pass it back on the
  // completed/failed call for activity-side duration computation.
  return args.status === "running" ? (body.started_at as string) : undefined;
}

// \u2500\u2500 complete_execution \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface CompleteExecutionArgs {
  workflow_id: string;
  run_id: string;
  definition_name: string;
  definition_version: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  output_payload?: Record<string, unknown>;
  error_message?: string;
}

/**
 * Updates the workflow_executions row when a DSL workflow finishes or fails.
 *
 * The initial row is expected to have been inserted by the HTTP trigger
 * (#193). If no row exists yet (standalone / test mode) the PATCH is a
 * no-op; that is logged as a warning but never throws.
 *
 * Never throws \u2014 same rationale as record_step.
 */
export async function complete_execution(args: CompleteExecutionArgs): Promise<void> {
  if (!isSupabaseConfigured()) {
    safeLogWarn("complete_execution: Supabase not configured, skipping execution trace", {
      workflow_id: args.workflow_id,
    });
    return;
  }

  const matchParam = `workflow_id=eq.${encodeURIComponent(args.workflow_id)}`;
  const url = `${config.supabaseUrl}/rest/v1/workflow_executions?${matchParam}`;

  const body: Record<string, unknown> = {
    status: args.status,
    completed_at: new Date().toISOString(),
  };
  if (args.output_payload !== undefined) {
    body.output_payload = args.output_payload;
  }
  if (args.error_message !== undefined) {
    body.error_message = args.error_message.slice(0, 2000);
  }

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      safeLogWarn("complete_execution: update failed", {
        http_status: response.status,
        body: text.slice(0, 300),
        workflow_id: args.workflow_id,
      });
    } else {
      safeLogInfo("complete_execution: execution trace written", {
        workflow_id: args.workflow_id,
        status: args.status,
      });
    }
  } catch (err) {
    safeLogWarn("complete_execution: network error", {
      error: String(err),
      workflow_id: args.workflow_id,
    });
  }
}
