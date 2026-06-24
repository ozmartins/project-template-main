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

export interface WorkflowExecutionStep {
  step_index: number;
  step_name: string;
  step_path?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  error_message?: string | null;
  duration_ms?: number | null;
  started_at?: string;
  completed_at?: string | null;
}
