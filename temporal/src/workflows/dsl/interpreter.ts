import type { RetryPolicy as TemporalRetryPolicy } from "@temporalio/common";
import {
  condition,
  executeChild,
  ParentClosePolicy,
  proxyActivities,
  setDefaultQueryHandler,
  setDefaultSignalHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { parseDuration } from "./duration";
import { evaluateCondition, resolveArgs, resolveExpression, type Variables } from "./expression";
import { type DSLStep, type RetryPolicy, validateDefinition } from "./schema";
import { validateSchema } from "./validation";

export interface DSLInput {
  definition: Record<string, unknown>;
  input: Record<string, unknown>;
}

type ActivityProxy = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

/** Minimal proxy type for the two execution-tracking activities. */
interface TrackingActivities {
  record_step: (args: {
    workflow_id: string;
    step_index: number;
    step_name: string;
    status: "running" | "completed" | "failed" | "skipped";
    input_preview?: unknown;
    output_preview?: unknown;
    error_message?: string;
    /** Pass back the value returned by the 'running' call to compute duration on the activity side. */
    started_at?: string;
  }) => Promise<string | undefined>;
  complete_execution: (args: {
    workflow_id: string;
    run_id: string;
    definition_name: string;
    definition_version: string;
    status: "completed" | "failed" | "cancelled" | "timed_out";
    output_payload?: Record<string, unknown>;
    error_message?: string;
  }) => Promise<void>;
}

function buildRetryPolicy(r?: RetryPolicy): TemporalRetryPolicy | undefined {
  if (!r) return undefined;
  return {
    maximumAttempts: r.max_attempts,
    initialInterval: r.initial_interval ? parseDuration(r.initial_interval) : undefined,
    backoffCoefficient: r.backoff_coefficient,
    maximumInterval: r.max_interval ? parseDuration(r.max_interval) : undefined,
    nonRetryableErrorTypes: r.non_retryable_errors,
  };
}

export async function DSLWorkflow(dslInput: DSLInput): Promise<Variables> {
  validateDefinition(dslInput.definition);

  const vars: Variables = {
    ...((dslInput.definition.variables as Variables) ?? {}),
  };
  const inputData: Variables = dslInput.input ?? {};

  // Buffer every signal into per-name queues before any await.
  const signalQueues = new Map<string, unknown[]>();
  setDefaultSignalHandler((signalName: string, ...args: unknown[]) => {
    const payload = args.length > 0 ? args[0] : null;
    if (!signalQueues.has(signalName)) signalQueues.set(signalName, []);
    signalQueues.get(signalName)!.push(payload);
  });

  // Dynamic query handlers registered by query_handler steps.
  const queryHandlers = new Map<string, () => unknown>();
  setDefaultQueryHandler((queryName: string) => {
    const handler = queryHandlers.get(queryName);
    if (!handler) throw new Error(`No query handler registered for: ${queryName}`);
    return handler();
  });

  let stepCounter = 0;
  const nextId = () => stepCounter++;

  // Tracking activities run with a short timeout and no retries so they
  // never block or fail the main workflow.
  const tracking = proxyActivities<TrackingActivities>({
    startToCloseTimeout: 10_000,
    retry: { maximumAttempts: 1 },
  });

  const info = workflowInfo();

  try {
    await executeStep(
      dslInput.definition.steps as DSLStep,
      vars,
      inputData,
      signalQueues,
      queryHandlers,
      nextId,
      tracking
    );
    // Best-effort: update workflow_executions row to completed.
    try {
      await tracking.complete_execution({
        workflow_id: info.workflowId,
        run_id: info.runId,
        definition_name: String(dslInput.definition.name),
        definition_version: String(dslInput.definition.version),
        status: "completed",
        output_payload: vars,
      });
    } catch {
      // swallow — tracking never fails the workflow
    }
  } catch (err) {
    // Best-effort: update workflow_executions row to failed.
    try {
      await tracking.complete_execution({
        workflow_id: info.workflowId,
        run_id: info.runId,
        definition_name: String(dslInput.definition.name),
        definition_version: String(dslInput.definition.version),
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // swallow — tracking never fails the workflow
    }
    throw err;
  }

  return vars;
}

async function executeStep(
  step: DSLStep,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  if ("activity" in step) return execActivity(step.activity, vars, input, nextId, tracking);
  if ("sequence" in step) {
    for (const s of step.sequence.steps)
      await executeStep(s, vars, input, signals, queries, nextId, tracking);
    return;
  }
  if ("parallel" in step)
    return execParallel(step.parallel, vars, input, signals, queries, nextId, tracking);
  if ("condition" in step)
    return execCondition(step.condition, vars, input, signals, queries, nextId, tracking);
  if ("wait_signal" in step)
    return execWaitSignal(step.wait_signal, vars, input, signals, queries, nextId, tracking);
  if ("sleep" in step) {
    await sleep(parseDuration(step.sleep.duration));
    return;
  }
  if ("wait_until" in step) return execWaitUntil(step.wait_until, vars, input);
  if ("child_workflow" in step) return execChildWorkflow(step.child_workflow, vars, input);
  if ("for_each" in step)
    return execForEach(step.for_each, vars, input, signals, queries, nextId, tracking);
  if ("try_catch" in step)
    return execTryCatch(step.try_catch, vars, input, signals, queries, nextId, tracking);
  if ("set_variable" in step) {
    vars[step.set_variable.name] = resolveExpression(step.set_variable.value, vars, input);
    return;
  }
  if ("query_handler" in step) {
    const qh = step.query_handler;
    queries.set(qh.query, () => resolveExpression(qh.returns, vars, input));
    return;
  }
  throw new Error(`Unknown step type: ${JSON.stringify(Object.keys(step))}`);
}

async function execActivity(
  spec: import("./schema").ActivityStep,
  vars: Variables,
  input: Variables,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  const stepId = nextId();
  const resolvedArgs = resolveArgs(spec.args ?? {}, vars, input);

  // Input schema validation — fails fast before calling the activity.
  if (spec.input_schema) {
    try {
      validateSchema(spec.input_schema as Record<string, unknown>, resolvedArgs);
    } catch (e) {
      throw new Error(`Activity "${spec.name}" input validation failed: ${(e as Error).message}`);
    }
  }

  const idempotencyKey = spec.idempotency_key
    ? String(resolveExpression(spec.idempotency_key, vars, input))
    : `${workflowInfo().workflowId}:${spec.name}:${stepId}`;

  const argsWithKey = { ...resolvedArgs, _idempotency_key: idempotencyKey };

  const startToClose = spec.start_to_close_timeout
    ? parseDuration(spec.start_to_close_timeout)
    : 30_000;

  const acts = proxyActivities<ActivityProxy>({
    startToCloseTimeout: startToClose,
    scheduleToCloseTimeout: spec.schedule_to_close_timeout
      ? parseDuration(spec.schedule_to_close_timeout)
      : undefined,
    retry: buildRetryPolicy(spec.retry),
    taskQueue: spec.task_queue,
  }) as ActivityProxy;

  const workflowId = workflowInfo().workflowId;

  // Record step as running before dispatching the activity.
  // Capture the returned started_at so we can pass it back on the
  // completed/failed call — the activity uses it to compute duration_ms on
  // its side (no Date.now() in workflow code).
  let startedAt: string | undefined;
  try {
    startedAt = await tracking.record_step({
      workflow_id: workflowId,
      step_index: stepId,
      step_name: spec.name,
      status: "running",
      input_preview: resolvedArgs,
    });
  } catch {
    // swallow — tracking never fails the workflow
  }

  try {
    const result = await acts[spec.name](argsWithKey);

    // Output schema validation — if the activity returned bad data, throw a
    // ValidationError. Temporal will retry the activity up to max_attempts.
    if (spec.output_schema && result !== undefined && result !== null) {
      try {
        validateSchema(spec.output_schema as Record<string, unknown>, result);
      } catch (e) {
        // Throw as a plain Error so Temporal retries it (ValidationError is retryable).
        throw new Error(
          `Activity "${spec.name}" output validation failed: ${(e as Error).message}`
        );
      }
    }

    if (spec.result) vars[spec.result] = result;

    // Record step as completed, passing back started_at so the activity
    // can compute duration_ms without any workflow-side wall-clock calls.
    try {
      await tracking.record_step({
        workflow_id: workflowId,
        step_index: stepId,
        step_name: spec.name,
        status: "completed",
        output_preview: result,
        started_at: startedAt,
      });
    } catch {
      // swallow — tracking never fails the workflow
    }
  } catch (err) {
    // Record step as failed before re-throwing.
    try {
      await tracking.record_step({
        workflow_id: workflowId,
        step_index: stepId,
        step_name: spec.name,
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
        started_at: startedAt,
      });
    } catch {
      // swallow — tracking never fails the workflow
    }
    throw err;
  }
}

async function execParallel(
  spec: import("./schema").ParallelStep,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  const branches = spec.branches;
  const snapshot = { ...vars };
  const branchVars = branches.map(() => ({ ...vars }));

  const run = (branch: DSLStep, bv: Variables) =>
    executeStep(branch, bv, input, signals, queries, nextId, tracking);

  if (spec.wait_all !== false) {
    await Promise.all(branches.map((b, i) => run(b, branchVars[i])));
  } else {
    await Promise.race(branches.map((b, i) => run(b, branchVars[i])));
  }

  for (const bv of branchVars) {
    for (const [k, v] of Object.entries(bv)) {
      if (snapshot[k] === v) continue; // branch didn't mutate this key
      if (k in vars && vars[k] !== snapshot[k] && vars[k] !== v) {
        throw new Error(`DSLConflictError: parallel branches both wrote variable '${k}'`);
      }
      vars[k] = v;
    }
  }
}

async function execCondition(
  spec: import("./schema").ConditionStep,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  const result = evaluateCondition(spec.if, vars, input);
  if (result) {
    await executeStep(spec.then, vars, input, signals, queries, nextId, tracking);
  } else if (spec.else) {
    await executeStep(spec.else, vars, input, signals, queries, nextId, tracking);
  }
}

async function execWaitSignal(
  spec: import("./schema").WaitSignalStep,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  const signalName = spec.signal;
  const timeoutMs = spec.timeout ? parseDuration(spec.timeout) : undefined;

  // condition() returns false on timeout — does NOT throw
  const received =
    timeoutMs !== undefined
      ? await condition(() => (signals.get(signalName)?.length ?? 0) > 0, timeoutMs)
      : await condition(() => (signals.get(signalName)?.length ?? 0) > 0);

  if (received) {
    const payload = signals.get(signalName)!.shift();
    if (spec.result) vars[spec.result] = payload;
  } else if (spec.on_timeout) {
    await executeStep(spec.on_timeout, vars, input, signals, queries, nextId, tracking);
  }
}

async function execWaitUntil(
  spec: import("./schema").WaitUntilStep,
  vars: Variables,
  input: Variables
): Promise<void> {
  const tsRaw = resolveExpression(spec.timestamp, vars, input);
  const target = new Date(String(tsRaw)).getTime();
  // Temporal's sleep is relative — compute ms from now using workflow time.
  // workflow.now() is not available in this SDK version; sleep(0) is a no-op
  // that gives us a determinism-safe checkpoint, then we sleep the remaining.
  // For wait_until we store the target epoch in a local var and use condition.
  const targetEpoch = target;
  // Use condition with a zero-ms poll — the workflow timer fires when Temporal
  // processes the sleep event. We approximate with a direct sleep.
  const nowApprox = Date.now(); // outside workflow determinism boundary — activity-side only
  const remaining = targetEpoch - nowApprox;
  if (remaining > 0) await sleep(remaining);
}

async function execChildWorkflow(
  spec: import("./schema").ChildWorkflowStep,
  vars: Variables,
  input: Variables
): Promise<void> {
  const args = resolveArgs(spec.args ?? {}, vars, input);
  const result = await executeChild(spec.workflow, {
    args: [args],
    taskQueue: spec.task_queue,
    parentClosePolicy:
      spec.parent_close_policy === "abandon"
        ? ParentClosePolicy.ABANDON
        : spec.parent_close_policy === "request_cancel"
          ? ParentClosePolicy.REQUEST_CANCEL
          : ParentClosePolicy.TERMINATE,
    retry: buildRetryPolicy(spec.retry),
  });
  if (spec.result) vars[spec.result] = result;
}

async function execForEach(
  spec: import("./schema").ForEachStep,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  const items = resolveExpression(spec.items, vars, input);
  if (!Array.isArray(items))
    throw new Error(`for_each.items must resolve to an array, got ${typeof items}`);

  const runItem = async (item: unknown, index: number) => {
    const iterVars = { ...vars, [spec.item_var]: item };
    if (spec.index_var) iterVars[spec.index_var] = index;
    await executeStep(spec.body, iterVars, input, signals, queries, nextId, tracking);
    // Write back any vars the body set, excluding the loop-scoped vars.
    for (const [k, v] of Object.entries(iterVars)) {
      if (k !== spec.item_var && k !== spec.index_var) vars[k] = v;
    }
  };

  if (spec.mode === "parallel") {
    await Promise.all(items.map((item, i) => runItem(item, i)));
  } else {
    for (let i = 0; i < items.length; i++) await runItem(items[i], i);
  }
}

async function execTryCatch(
  spec: import("./schema").TryCatchStep,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
  tracking: TrackingActivities
): Promise<void> {
  try {
    await executeStep(spec.try, vars, input, signals, queries, nextId, tracking);
  } catch (err) {
    if (spec.catch) {
      if (spec.catch.error_var) {
        vars[spec.catch.error_var] = err instanceof Error ? err.message : String(err);
      }
      await executeStep(spec.catch.body, vars, input, signals, queries, nextId, tracking);
    } else {
      throw err;
    }
  } finally {
    if (spec.finally) {
      await executeStep(spec.finally, vars, input, signals, queries, nextId, tracking);
    }
  }
}
