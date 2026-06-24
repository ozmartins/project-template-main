import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, ChevronDown, ChevronUp, Download } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowGraph } from "@/components/WorkflowGraph";
import { workflowApiBaseUrl } from "@/data/workflowApi";
import { getWorkflowDefinition } from "@/data/workflowDefinitions";
import { cn } from "@/lib/utils";
import type { WorkflowExecutionStep } from "@/types/workflows";

type ExecutionStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out";

type JsonObject = Record<string, unknown>;

type ExecutionStep = {
  id?: string;
  index?: number;
  step_path?: string;
  step_name?: string;
  activity_name?: string;
  name?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  retries?: number;
  error_message?: string;
  output?: unknown;
  result?: unknown;
  llm_agent?: unknown;
};

type WorkflowExecutionDetail = {
  workflow_id: string;
  run_id?: string;
  definition_name?: string;
  definition_version?: string;
  status: ExecutionStatus;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error_message?: string;
  final_variables?: JsonObject;
  result?: JsonObject;
  output_payload?: JsonObject;
  steps?: ExecutionStep[];
};

type WorkflowExecutionApiResponse = {
  execution: WorkflowExecutionDetail;
  step_trace: ExecutionStep[];
};

export const Route = createFileRoute("/workflows/executions/$workflowId")({
  component: WorkflowExecutionDetailPage,
});

export function WorkflowExecutionDetailPage() {
  const { workflowId } = Route.useParams();
  const [graphExpanded, setGraphExpanded] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["workflow-execution-detail", workflowId],
    queryFn: () => fetchExecutionDetail(workflowId),
    refetchInterval: (query) =>
      (query.state.data as WorkflowExecutionDetail | undefined)?.status === "running"
        ? 5000
        : false,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading execution detail…</p>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Could not load workflow execution</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Unknown error"}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">No workflow execution detail found.</p>;
  }

  const steps = (data.steps ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const graphSteps = toWorkflowGraphSteps(steps);
  const definition = data.definition_name ? getWorkflowDefinition(data.definition_name) : undefined;
  const currentGraphStep = resolveCurrentGraphStep(graphSteps, data.status);
  const finalState = resolveFinalState(data);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Workflow execution {data.workflow_id}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.definition_name ?? "Unknown definition"}
            {data.definition_version ? ` v${data.definition_version}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={data.status} />
          <Button variant="outline" size="sm" onClick={() => exportExecutionDetail(data)}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </section>

      {data.error_message ? (
        <Alert variant="destructive" data-testid="execution-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Execution failed</AlertTitle>
          <AlertDescription>{data.error_message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Workflow ID" value={data.workflow_id} />
          <SummaryItem label="Run ID" value={data.run_id ?? "-"} />
          <SummaryItem label="Started" value={formatTimestamp(data.started_at)} />
          <SummaryItem label="Completed" value={formatTimestamp(data.completed_at)} />
          <SummaryItem
            label="Duration"
            value={formatDuration(
              data.duration_ms ?? durationFromTimestamps(data.started_at, data.completed_at)
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step timeline</CardTitle>
          <CardDescription>Ordered execution trace for this workflow run.</CardDescription>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No step data available yet.</p>
          ) : (
            <ol className="space-y-3">
              {steps.map((step, index) => {
                const stepName =
                  step.step_name ?? step.activity_name ?? step.name ?? `Step ${index + 1}`;
                const status = (step.status ?? "running").toLowerCase();
                const isFailed = status === "failed";
                const llmMeta = llmMetadata(step);

                return (
                  <li
                    key={step.id ?? `${stepName}-${index}`}
                    className={cn(
                      "rounded-md border p-4",
                      isFailed ? "border-destructive bg-destructive/5" : "border-border"
                    )}
                    data-testid={`step-item-${index}`}
                    data-step-status={status}
                    data-failed={isFailed ? "true" : "false"}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{stepName}</p>
                        <p className="text-xs text-muted-foreground">
                          Duration:{" "}
                          {formatDuration(
                            step.duration_ms ??
                              durationFromTimestamps(step.started_at, step.completed_at)
                          )}
                          {" · "}Retries: {String(step.retries ?? 0)}
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </div>

                    {step.error_message ? (
                      <p
                        className="mt-2 text-sm text-destructive"
                        data-testid={`step-error-${index}`}
                      >
                        {step.error_message}
                      </p>
                    ) : null}

                    {llmMeta ? (
                      <div
                        className="mt-3 rounded-md border bg-muted/30 p-3 text-sm"
                        data-testid={`llm-step-${index}`}
                      >
                        <p className="font-medium">LLM metadata</p>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          <span>Provider: {String(llmMeta.provider ?? "-")}</span>
                          <span>Model: {String(llmMeta.model ?? "-")}</span>
                          <span>Prompt tokens: {String(llmMeta.prompt_tokens ?? 0)}</span>
                          <span>Completion tokens: {String(llmMeta.completion_tokens ?? 0)}</span>
                          <span>Tool rounds: {String(llmMeta.tool_rounds ?? 0)}</span>
                        </div>
                        {llmMeta.parsed ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                              Parsed output
                            </summary>
                            <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs">
                              {stringify(llmMeta.parsed)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ) : null}

                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Raw step payload
                      </summary>
                      <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                        {stringify(step)}
                      </pre>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {definition ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Workflow graph</CardTitle>
              <CardDescription>
                Visual representation of the workflow definition with live step status overlays.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGraphExpanded((prev) => !prev)}
              aria-expanded={graphExpanded}
              aria-label={graphExpanded ? "Collapse workflow graph" : "Expand workflow graph"}
            >
              {graphExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CardHeader>
          {graphExpanded ? (
            <CardContent className="pt-0">
              <WorkflowGraph
                definition={definition}
                steps={graphSteps.length > 0 ? graphSteps : undefined}
                currentStep={currentGraphStep}
              />
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {finalState ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Final result state</CardTitle>
            <CardDescription>
              Variables/output captured when the workflow completed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Show final variables/output
              </summary>
              <pre
                className="mt-2 overflow-auto rounded bg-muted p-3 text-xs"
                data-testid="final-state-json"
              >
                {stringify(finalState)}
              </pre>
            </details>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant =
    normalized === "completed"
      ? "secondary"
      : normalized === "failed"
        ? "destructive"
        : normalized === "running"
          ? "default"
          : "outline";

  return <Badge variant={variant}>{normalized}</Badge>;
}

async function fetchExecutionDetail(workflowId: string): Promise<WorkflowExecutionDetail> {
  const response = await fetch(
    `${workflowApiBaseUrl}/workflows/executions/${encodeURIComponent(workflowId)}`
  );

  if (!response.ok) {
    throw new Error(`Execution query failed (${response.status})`);
  }

  const payload = (await response.json()) as WorkflowExecutionApiResponse;
  const execution = payload.execution;
  if (!execution || typeof execution !== "object") {
    throw new Error(
      `Execution query returned an unexpected payload shape: execution must be an object (received ${typeof execution})`
    );
  }
  if (!Array.isArray(payload.step_trace)) {
    throw new Error("Execution query returned an unexpected step_trace shape");
  }

  return {
    ...execution,
    steps: payload.step_trace,
  };
}

function exportExecutionDetail(data: WorkflowExecutionDetail) {
  const json = stringify(data);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${data.workflow_id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function formatTimestamp(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function durationFromTimestamps(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return undefined;
  return Math.max(0, endTime - startTime);
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function llmMetadata(step: ExecutionStep): JsonObject | null {
  const source = resolveStepPayload(step);
  if (!source) return null;

  const hasLlmFields =
    "provider" in source ||
    "model" in source ||
    "prompt_tokens" in source ||
    "completion_tokens" in source ||
    "tool_calls" in source ||
    "parsed" in source;

  if (!hasLlmFields) return null;

  const toolCalls = Array.isArray(source.tool_calls) ? source.tool_calls : [];

  return {
    provider: source.provider,
    model: source.model,
    prompt_tokens: source.prompt_tokens,
    completion_tokens: source.completion_tokens,
    tool_rounds: toolCalls.length,
    parsed: source.parsed,
  };
}

function resolveFinalState(detail: WorkflowExecutionDetail): JsonObject | undefined {
  return detail.final_variables ?? detail.output_payload ?? detail.result;
}

function resolveStepPayload(step: ExecutionStep): JsonObject | null {
  return asObject(step.result) ?? asObject(step.output) ?? asObject(step.llm_agent);
}

function asObject(value: unknown): JsonObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeStepStatus(status: string | undefined): WorkflowExecutionStep["status"] {
  if (
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "skipped"
  ) {
    return status;
  }

  return "pending";
}

export function toWorkflowGraphSteps(steps: ExecutionStep[]): WorkflowExecutionStep[] {
  return steps.map((step, index) => ({
    step_index: step.index ?? index,
    step_name: step.step_name ?? step.activity_name ?? step.name ?? `step_${index + 1}`,
    step_path: step.step_path,
    status: normalizeStepStatus(step.status?.toLowerCase()),
    error_message: step.error_message,
    duration_ms: step.duration_ms,
    started_at: step.started_at,
    completed_at: step.completed_at,
  }));
}

export function resolveCurrentGraphStep(
  steps: WorkflowExecutionStep[],
  executionStatus: ExecutionStatus
): string | undefined {
  if (executionStatus !== "running") {
    return undefined;
  }

  return steps.find((step) => step.status === "running")?.step_name;
}
