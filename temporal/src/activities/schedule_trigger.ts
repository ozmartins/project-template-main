import { Client, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { config } from "../config";
import { parseDuration } from "../workflows/dsl/duration";

export interface ScheduleTriggerArgs {
  workflow_id: string;
  workflow_input: Record<string, unknown>;
  run_at: string;
  _idempotency_key: string;
}

export interface ScheduleTriggerResult {
  scheduled_workflow_id: string;
  run_at: string;
}

export function resolveRunAt(
  runAt: string,
  nowMs = Date.now()
): { runAtIso: string; startDelayMs: number } {
  const trimmed = runAt.trim();
  if (!trimmed) {
    throw new Error("schedule_trigger: run_at is required");
  }

  try {
    const delayMs = parseDuration(trimmed);
    const startDelayMs = Math.max(0, Math.round(delayMs));
    return {
      runAtIso: new Date(nowMs + startDelayMs).toISOString(),
      startDelayMs,
    };
  } catch {
    const absoluteMs = Date.parse(trimmed);
    if (!Number.isFinite(absoluteMs)) {
      throw new Error(`schedule_trigger: invalid run_at "${runAt}"`);
    }
    return {
      runAtIso: new Date(absoluteMs).toISOString(),
      startDelayMs: Math.max(0, absoluteMs - nowMs),
    };
  }
}

function buildScheduledWorkflowId(workflowId: string, idempotencyKey: string): string {
  const key = idempotencyKey.trim();
  return `${workflowId}:schedule_trigger:${key}`;
}

export async function schedule_trigger(args: ScheduleTriggerArgs): Promise<ScheduleTriggerResult> {
  if (!args.workflow_id?.trim()) {
    throw new Error("schedule_trigger: workflow_id is required");
  }
  if (
    !args.workflow_input ||
    typeof args.workflow_input !== "object" ||
    Array.isArray(args.workflow_input)
  ) {
    throw new Error("schedule_trigger: workflow_input must be an object");
  }
  if (!args._idempotency_key?.trim()) {
    throw new Error("schedule_trigger: _idempotency_key is required");
  }

  const { runAtIso, startDelayMs } = resolveRunAt(args.run_at);
  const scheduledWorkflowId = buildScheduledWorkflowId(
    args.workflow_id.trim(),
    args._idempotency_key
  );

  const connection = await NativeConnection.connect({ address: config.temporalAddress });
  try {
    const client = new Client({ connection, namespace: config.temporalNamespace });
    await client.workflow.start("DSLWorkflow", {
      taskQueue: config.temporalTaskQueue,
      workflowId: scheduledWorkflowId,
      args: [args.workflow_input],
      startDelay: startDelayMs,
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
      throw error;
    }
  } finally {
    await connection.close();
  }

  return {
    scheduled_workflow_id: scheduledWorkflowId,
    run_at: runAtIso,
  };
}
