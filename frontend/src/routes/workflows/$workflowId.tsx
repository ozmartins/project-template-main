import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/data/supabase";
import { workflowApiBaseUrl } from "@/data/workflowApi";
import {
  formatWorkflowPayload,
  formatWorkflowStatus,
  getWorkflowExecution,
  type WorkflowExecutionRecord,
} from "@/features/workflows/executions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workflows/$workflowId")({
  component: WorkflowTracePage,
});

const MAX_JSON_PREVIEW_LENGTH = 900;
// Support both spellings because upstream workflow status payloads can vary across integrations.
const TERMINAL_WORKFLOW_STATES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "TIMED_OUT",
]);

interface WorkflowExecution {
  workflow_id: string;
  run_id?: string;
  definition_name?: string;
  definition_version?: string;
  state: string;
  current_step?: string | null;
  started_at?: string;
  completed_at?: string;
  total_duration_ms?: number;
  steps?: WorkflowStep[];
}

interface WorkflowExecutionApiResponse {
  execution: {
    workflow_id: string;
    run_id?: string;
    definition_name?: string;
    definition_version?: string;
    status: string;
    current_step?: string | null;
    started_at?: string;
    completed_at?: string;
    duration_ms?: number;
  };
  step_trace: Array<{
    step_name?: string;
    activity_name?: string;
    name?: string;
    status?: string;
    retries?: number;
    duration_ms?: number;
    input_args?: unknown;
    output?: unknown;
    result?: unknown;
    llm_agent?: unknown;
    error_message?: string;
  }>;
}

interface WorkflowStep {
  activity_name?: string;
  name?: string;
  status?: string;
  attempt?: number;
  duration_ms?: number;
  input_args?: unknown;
  output?: unknown;
  parsed?: Record<string, unknown>;
  tool_calls?: unknown[];
  provider?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  error_message?: string;
  retry_count?: number;
  next_retry_at?: string;
}

interface ToolCall {
  name?: string;
  args?: unknown;
  result_summary?: string;
  result?: unknown;
}

interface LlmMetadata {
  provider?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
}

async function fetchWorkflowExecution(workflowId: string): Promise<WorkflowExecution> {
  const response = await fetch(getWorkflowExecutionEndpoint(workflowId), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load workflow trace: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as WorkflowExecution | WorkflowExecutionApiResponse;

  if ("execution" in payload && "step_trace" in payload) {
    return {
      workflow_id: payload.execution.workflow_id,
      run_id: payload.execution.run_id,
      definition_name: payload.execution.definition_name,
      definition_version: payload.execution.definition_version,
      state: (payload.execution.status ?? "UNKNOWN").toUpperCase(),
      current_step: payload.execution.current_step,
      started_at: payload.execution.started_at,
      completed_at: payload.execution.completed_at,
      total_duration_ms: payload.execution.duration_ms,
      steps: payload.step_trace.map((step) => ({
        activity_name: step.activity_name ?? step.step_name ?? step.name,
        status: (step.status ?? "UNKNOWN").toUpperCase(),
        attempt: typeof step.retries === "number" ? step.retries + 1 : undefined,
        duration_ms: step.duration_ms,
        input_args: step.input_args,
        output: step.output ?? step.result ?? step.llm_agent,
        error_message: step.error_message,
        retry_count: step.retries,
      })),
    };
  }

  return payload;
}

export function getWorkflowExecutionEndpoint(workflowId: string): string {
  return `${workflowApiBaseUrl}/workflows/executions/${encodeURIComponent(workflowId)}`;
}

function normalizeWorkflowState(state: string | undefined): string | undefined {
  return typeof state === "string" ? state.toUpperCase() : undefined;
}

function isTerminalState(state: string | undefined): boolean {
  const normalized = normalizeWorkflowState(state);
  return typeof normalized === "string" && TERMINAL_WORKFLOW_STATES.has(normalized);
}

export function getWorkflowTraceRefetchInterval(state: string | undefined): number | false {
  return isTerminalState(state) ? false : 2000;
}

function formatDuration(milliseconds: number | undefined): string {
  if (typeof milliseconds !== "number" || Number.isNaN(milliseconds)) {
    return "-";
  }

  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return "-";
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }

  return new Date(parsed).toLocaleString();
}

function formatWorkflowStateLabel(state: string | undefined): string {
  const normalized = normalizeWorkflowState(state);
  if (!normalized) {
    return "Unknown";
  }

  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeStringify(value: unknown): string {
  try {
    const serialised = JSON.stringify(value, null, 2);
    return typeof serialised === "string" ? serialised : String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStepOutput(step: WorkflowStep): Record<string, unknown> {
  return isRecord(step.output) ? step.output : {};
}

function getParsedOutput(step: WorkflowStep): Record<string, unknown> | undefined {
  if (step.parsed) {
    return step.parsed;
  }

  const output = getStepOutput(step);
  return isRecord(output.parsed) ? output.parsed : undefined;
}

function getToolCalls(step: WorkflowStep): ToolCall[] {
  if (Array.isArray(step.tool_calls)) {
    return step.tool_calls.filter(isRecord) as ToolCall[];
  }

  const output = getStepOutput(step);
  return Array.isArray(output.tool_calls)
    ? output.tool_calls.filter(isRecord).map((toolCall) => toolCall as ToolCall)
    : [];
}

function getLlmMetadata(step: WorkflowStep): LlmMetadata {
  const output = getStepOutput(step);
  return {
    provider: step.provider ?? (typeof output.provider === "string" ? output.provider : undefined),
    model: step.model ?? (typeof output.model === "string" ? output.model : undefined),
    prompt_tokens:
      step.prompt_tokens ??
      (typeof output.prompt_tokens === "number" ? output.prompt_tokens : undefined),
    completion_tokens:
      step.completion_tokens ??
      (typeof output.completion_tokens === "number" ? output.completion_tokens : undefined),
  };
}

function getToolCallKey(toolCall: ToolCall): string {
  const fallbackKey = `tool_call_unknown:${safeStringify(toolCall)}`;
  const key = [
    toolCall.name,
    safeStringify(toolCall.args),
    toolCall.result_summary,
    safeStringify(toolCall.result),
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(":");
  return key || fallbackKey;
}

function getStepKey(step: WorkflowStep): string {
  const fallbackKey = `step_unknown:${safeStringify(step)}`;
  const key = [
    step.activity_name ?? step.name,
    step.status,
    step.attempt?.toString(),
    step.duration_ms?.toString(),
    step.next_retry_at,
    step.error_message,
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(":");
  return key || fallbackKey;
}

function JsonValue({ value }: { value: unknown }) {
  const formatted = safeStringify(value);

  if (formatted.length <= MAX_JSON_PREVIEW_LENGTH) {
    return (
      <pre className="text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded">{formatted}</pre>
    );
  }

  const preview = `${formatted.slice(0, MAX_JSON_PREVIEW_LENGTH)}...`;

  return (
    <div className="space-y-2">
      <pre className="text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded">{preview}</pre>
      <details>
        <summary className="cursor-pointer text-xs text-primary">Show full payload</summary>
        <pre className="text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded mt-2">
          {formatted}
        </pre>
      </details>
    </div>
  );
}

function ParsedOutputCard({ parsed }: { parsed: Record<string, unknown> }) {
  return (
    <Card className="bg-muted/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Parsed output</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(parsed).map(([key, value]) => (
          <div key={key} className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {key}
            </p>
            <p className="text-sm break-words">
              {typeof value === "string" ? value : safeStringify(value)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  const activityName = step.activity_name ?? step.name ?? "Step (no name)";
  const stepStatus = step.status ?? "COMPLETED";
  const isFailed = stepStatus === "FAILED";
  const parsed = getParsedOutput(step);
  const toolCalls = getToolCalls(step);
  const llm = getLlmMetadata(step);

  return (
    <Card className={cn("border-border", isFailed && "border-destructive/60 bg-destructive/5")}>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{activityName}</CardTitle>
          <Badge variant={isFailed ? "destructive" : "secondary"}>{stepStatus}</Badge>
        </div>
        <CardDescription>
          Attempt {step.attempt ?? 1} • Duration {formatDuration(step.duration_ms)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details>
          <summary className="cursor-pointer text-sm font-medium">Input args</summary>
          <div className="pt-2">
            <JsonValue value={step.input_args ?? {}} />
          </div>
        </details>

        {(llm.provider || llm.model || llm.prompt_tokens || llm.completion_tokens) && (
          <div className="grid gap-1 text-sm">
            <p>
              <span className="font-medium">Provider:</span> {llm.provider ?? "-"}
            </p>
            <p>
              <span className="font-medium">Model:</span> {llm.model ?? "-"}
            </p>
            <p>
              <span className="font-medium">Tokens:</span> {llm.prompt_tokens ?? 0} in /{" "}
              {llm.completion_tokens ?? 0} out
            </p>
          </div>
        )}

        {toolCalls.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Tool call rounds</p>
            {toolCalls.map((toolCall) => (
              <Card key={getToolCallKey(toolCall)} className="bg-muted/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{toolCall.name ?? "tool_call"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Args
                    </p>
                    <JsonValue value={toolCall.args ?? {}} />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Result
                    </p>
                    {toolCall.result_summary ? (
                      <p className="text-sm break-words">{toolCall.result_summary}</p>
                    ) : (
                      <JsonValue value={toolCall.result ?? {}} />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {parsed && <ParsedOutputCard parsed={parsed} />}

        <details>
          <summary className="cursor-pointer text-sm font-medium">Output</summary>
          <div className="pt-2">
            <JsonValue value={step.output ?? {}} />
          </div>
        </details>

        {isFailed && (
          <div className="space-y-1 text-sm">
            {step.error_message && (
              <p>
                <span className="font-medium">Error:</span> {step.error_message}
              </p>
            )}
            <p>
              <span className="font-medium">Retry count:</span> {step.retry_count ?? 0}
            </p>
            <p>
              <span className="font-medium">Next retry:</span> {formatTimestamp(step.next_retry_at)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkflowTracePage() {
  const { workflowId } = Route.useParams();

  const query = useQuery({
    queryKey: ["workflow-execution", workflowId],
    queryFn: () => fetchWorkflowExecution(workflowId),
    refetchInterval: (currentQuery) => {
      const currentState = currentQuery.state.data?.state;
      return getWorkflowTraceRefetchInterval(currentState);
    },
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workflow trace…</p>;
  }

  if (query.isError) {
    return (
      <div className="space-y-4 max-w-5xl">
        <div>
          <Link to="/workflows/history" className="text-sm text-primary hover:underline">
            ← Back to workflow history
          </Link>
        </div>
        <Card className="border-destructive/60 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base">Failed to load workflow trace</CardTitle>
            <CardDescription>
              {query.error instanceof Error ? query.error.message : "Unknown error"}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const execution = query.data;
  if (!execution) {
    return (
      <div className="space-y-4 max-w-5xl">
        <div>
          <Link to="/workflows/history" className="text-sm text-primary hover:underline">
            ← Back to workflow history
          </Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workflow trace unavailable</CardTitle>
            <CardDescription>No execution data was returned for this workflow.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  const normalizedExecutionState =
    normalizeWorkflowState(execution.state) ?? execution.state ?? "UNKNOWN";
  const totalDuration =
    execution.total_duration_ms ??
    (execution.started_at && execution.completed_at
      ? Date.parse(execution.completed_at) - Date.parse(execution.started_at)
      : undefined);
  const isTerminal = isTerminalState(execution.state);
  const steps = execution.steps ?? [];
  const executionLabel = execution.definition_name
    ? `${execution.definition_name}${execution.definition_version ? ` v${execution.definition_version}` : ""}`
    : "Workflow execution";
  const executionStateLabel = formatWorkflowStateLabel(execution.state);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link to="/workflows/history" className="text-sm text-primary hover:underline">
          ← Back to workflow history
        </Link>
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow trace</h1>
        <p className="text-sm text-muted-foreground">
          {executionLabel} • {executionStateLabel} run
        </p>
        <p className="text-sm text-muted-foreground">
          Workflow ID: {execution.workflow_id}
          {execution.run_id ? ` • Run ID: ${execution.run_id}` : ""}
        </p>
      </div>

      <Card
        className={cn(
          execution.state === "COMPLETED" && "border-green-600/40 bg-green-50",
          execution.state === "FAILED" && "border-destructive/60 bg-destructive/5"
        )}
      >
        <CardHeader>
          <CardTitle className="text-base">
            {isTerminal ? normalizedExecutionState : `RUNNING (${normalizedExecutionState})`}
          </CardTitle>
          <CardDescription>Total duration: {formatDuration(totalDuration)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm pt-0 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Definition" value={executionLabel} />
          <SummaryItem label="Workflow ID" value={execution.workflow_id} />
          <SummaryItem label="Run ID" value={execution.run_id ?? "-"} />
          <SummaryItem label="Current step" value={execution.current_step ?? "-"} />
          <SummaryItem label="Started" value={formatTimestamp(execution.started_at)} />
          <SummaryItem label="Completed" value={formatTimestamp(execution.completed_at)} />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {steps.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No steps recorded yet</CardTitle>
              <CardDescription>
                {execution.definition_name
                  ? `${execution.definition_name} has not recorded any trace steps yet.`
                  : "This workflow has not recorded any trace steps yet."}{" "}
                If the run has been waiting for a while,{" "}
                <Link to="/workflows/history" className="text-primary hover:underline">
                  return to workflow history
                </Link>{" "}
                to check run status or trigger a new execution.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          steps.map((step) => <StepCard key={getStepKey(step)} step={step} />)
        )}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value}</p>
    </div>
  );
}

interface WorkflowExecutionDetailRouteProps {
  getExecution?: (workflowId: string) => Promise<WorkflowExecutionRecord | null>;
}

export function WorkflowExecutionDetailRoute({
  getExecution = (workflowId) => getWorkflowExecution(supabase, workflowId),
}: WorkflowExecutionDetailRouteProps) {
  const { workflowId } = Route.useParams();

  const query = useQuery({
    queryKey: ["workflow-execution-inspector", workflowId],
    queryFn: () => getExecution(workflowId),
  });

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (query.isError) {
    return <p className="text-sm text-destructive">Could not load workflow execution.</p>;
  }

  if (!query.data) {
    return (
      <div className="space-y-2">
        <p className="font-medium">Workflow execution not found</p>
        <p className="text-sm text-muted-foreground">
          No workflow execution was returned for {workflowId}.
        </p>
      </div>
    );
  }

  const exec = query.data;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/workflows/history" className="text-sm text-primary hover:underline">
          ← Back to workflow history
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Workflow result inspector</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Definition
            </p>
            <p>{exec.definition_name}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Version
            </p>
            <p>{exec.definition_version}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Run ID
            </p>
            <p>{exec.run_id}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </p>
            <Badge>{formatWorkflowStatus(exec.status)}</Badge>
          </div>
          {exec.current_step !== null && (
            <div className="grid gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current step
              </p>
              <p>{exec.current_step}</p>
            </div>
          )}
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Input payload
            </p>
            <pre className="text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded">
              {formatWorkflowPayload(exec.input_payload)}
            </pre>
          </div>
          {exec.error_message !== null && (
            <div className="grid gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Error
              </p>
              <p className="text-destructive">{exec.error_message}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
