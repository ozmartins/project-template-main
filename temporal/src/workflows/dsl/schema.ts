/**
 * Structural validation for DSL workflow definitions.
 * Checks required top-level fields and validates step types recursively.
 * No external schema library — runs cleanly inside the Temporal V8 isolate.
 */

export interface DSLDefinition {
  name: string;
  version: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  steps: DSLStep;
  definitions?: Record<string, unknown>;
}

export type DSLStep =
  | { activity: ActivityStep }
  | { sequence: SequenceStep }
  | { parallel: ParallelStep }
  | { condition: ConditionStep }
  | { wait_signal: WaitSignalStep }
  | { sleep: SleepStep }
  | { wait_until: WaitUntilStep }
  | { child_workflow: ChildWorkflowStep }
  | { for_each: ForEachStep }
  | { try_catch: TryCatchStep }
  | { set_variable: SetVariableStep }
  | { query_handler: QueryHandlerStep };

export interface ActivityStep {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  task_queue?: string;
  retry?: RetryPolicy;
  start_to_close_timeout?: string;
  schedule_to_close_timeout?: string;
  idempotency_key?: string;
  /**
   * JSON Schema validated against the resolved args before the activity is called.
   * If validation fails, the step throws immediately (no activity invocation).
   */
  input_schema?: Record<string, unknown>;
  /**
   * JSON Schema validated against the activity's return value.
   * If validation fails, a ValidationError is thrown — Temporal retries the activity
   * up to the step's retry.max_attempts (default 3).
   */
  output_schema?: Record<string, unknown>;
}

export interface SequenceStep {
  steps: DSLStep[];
}
export interface ParallelStep {
  branches: DSLStep[];
  wait_all?: boolean;
}
export interface ConditionStep {
  if: string;
  then: DSLStep;
  else?: DSLStep;
}
export interface WaitSignalStep {
  signal: string;
  result?: string;
  timeout?: string;
  on_timeout?: DSLStep;
}
export interface SleepStep {
  duration: string;
  label?: string;
}
export interface WaitUntilStep {
  timestamp: string;
  label?: string;
}
export interface ChildWorkflowStep {
  workflow: string;
  args?: Record<string, unknown>;
  result?: string;
  task_queue?: string;
  parent_close_policy?: "terminate" | "abandon" | "request_cancel";
  retry?: RetryPolicy;
}
export interface ForEachStep {
  items: string;
  item_var: string;
  index_var?: string;
  body: DSLStep;
  mode?: "sequential" | "parallel";
}
export interface TryCatchStep {
  try: DSLStep;
  catch?: { error_var?: string; body: DSLStep };
  finally?: DSLStep;
}
export interface SetVariableStep {
  name: string;
  value: unknown;
}
export interface QueryHandlerStep {
  query: string;
  returns: unknown;
}

export interface RetryPolicy {
  max_attempts?: number;
  initial_interval?: string;
  backoff_coefficient?: number;
  max_interval?: string;
  non_retryable_errors?: string[];
}

const STEP_KEYS = new Set([
  "activity",
  "sequence",
  "parallel",
  "condition",
  "wait_signal",
  "sleep",
  "wait_until",
  "child_workflow",
  "for_each",
  "try_catch",
  "set_variable",
  "query_handler",
]);

function validateStep(step: unknown, path: string): void {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error(`${path}: step must be an object`);
  }
  const keys = Object.keys(step as object);
  if (keys.length !== 1) {
    throw new Error(
      `${path}: step must have exactly one discriminator key, got [${keys.join(", ")}]`
    );
  }
  const key = keys[0];
  if (!STEP_KEYS.has(key)) {
    throw new Error(`${path}: unknown step type "${key}"`);
  }
  const body = (step as Record<string, unknown>)[key];

  if (key === "activity") {
    const a = body as ActivityStep;
    if (!a.name || typeof a.name !== "string") {
      throw new Error(`${path}.activity.name: required string`);
    }
  } else if (key === "sequence") {
    const s = body as SequenceStep;
    if (!Array.isArray(s.steps)) throw new Error(`${path}.sequence.steps: required array`);
    s.steps.forEach((sub, i) => {
      validateStep(sub, `${path}.sequence.steps[${i}]`);
    });
  } else if (key === "parallel") {
    const p = body as ParallelStep;
    if (!Array.isArray(p.branches)) throw new Error(`${path}.parallel.branches: required array`);
    p.branches.forEach((sub, i) => {
      validateStep(sub, `${path}.parallel.branches[${i}]`);
    });
  } else if (key === "condition") {
    const c = body as ConditionStep;
    if (!c.if || typeof c.if !== "string") throw new Error(`${path}.condition.if: required string`);
    if (!c.then) throw new Error(`${path}.condition.then: required`);
    validateStep(c.then, `${path}.condition.then`);
    if (c.else) validateStep(c.else, `${path}.condition.else`);
  } else if (key === "wait_signal") {
    const w = body as WaitSignalStep;
    if (!w.signal || typeof w.signal !== "string") {
      throw new Error(`${path}.wait_signal.signal: required string`);
    }
    if (w.on_timeout) validateStep(w.on_timeout, `${path}.wait_signal.on_timeout`);
  } else if (key === "child_workflow") {
    const cw = body as ChildWorkflowStep;
    if (!cw.workflow || typeof cw.workflow !== "string") {
      throw new Error(`${path}.child_workflow.workflow: required string`);
    }
  } else if (key === "for_each") {
    const fe = body as ForEachStep;
    if (!fe.items || typeof fe.items !== "string")
      throw new Error(`${path}.for_each.items: required string`);
    if (!fe.item_var || typeof fe.item_var !== "string")
      throw new Error(`${path}.for_each.item_var: required string`);
    if (!fe.body) throw new Error(`${path}.for_each.body: required`);
    validateStep(fe.body, `${path}.for_each.body`);
  } else if (key === "try_catch") {
    const tc = body as TryCatchStep;
    if (!tc.try) throw new Error(`${path}.try_catch.try: required`);
    validateStep(tc.try, `${path}.try_catch.try`);
    if (tc.catch) validateStep(tc.catch.body, `${path}.try_catch.catch.body`);
    if (tc.finally) validateStep(tc.finally, `${path}.try_catch.finally`);
  } else if (key === "set_variable") {
    const sv = body as SetVariableStep;
    if (!sv.name || typeof sv.name !== "string")
      throw new Error(`${path}.set_variable.name: required string`);
  } else if (key === "query_handler") {
    const qh = body as QueryHandlerStep;
    if (!qh.query || typeof qh.query !== "string")
      throw new Error(`${path}.query_handler.query: required string`);
  }
  // sleep and wait_until have no required sub-fields beyond being objects
}

const SEMVER_RE = /^\d+\.\d+\.\d+/;

export function validateDefinition(def: unknown): asserts def is DSLDefinition {
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    throw new Error("Definition must be a JSON object");
  }
  const d = def as Record<string, unknown>;
  if (!d.name || typeof d.name !== "string") throw new Error("definition.name: required string");
  if (!d.version || typeof d.version !== "string")
    throw new Error("definition.version: required string");
  if (!SEMVER_RE.test(d.version))
    throw new Error(`definition.version: must be semver, got "${d.version}"`);
  if (!d.steps) throw new Error("definition.steps: required");
  validateStep(d.steps, "steps");
  if (d.input_schema !== undefined) {
    if (typeof d.input_schema !== "object" || Array.isArray(d.input_schema)) {
      throw new Error("definition.input_schema: must be a JSON Schema object");
    }
    const s = d.input_schema as Record<string, unknown>;
    if (s.type !== "object") throw new Error('definition.input_schema: type must be "object"');
    if (!Array.isArray(s.required) || s.required.length === 0) {
      throw new Error("definition.input_schema: required array must list at least one field");
    }
    if (!s.properties || typeof s.properties !== "object") {
      throw new Error("definition.input_schema: properties is required");
    }
  }
}
