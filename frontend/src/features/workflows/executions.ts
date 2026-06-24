import type { SupabaseClient } from "@supabase/supabase-js";

export const WORKFLOW_EXECUTION_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type WorkflowExecutionStatus = (typeof WORKFLOW_EXECUTION_STATUSES)[number];

export interface WorkflowExecutionFilters {
  definitionName: string;
  status: "" | WorkflowExecutionStatus;
  startedFrom: string;
  startedTo: string;
}

export interface WorkflowExecutionRecord {
  workflow_id: string;
  run_id: string;
  definition_name: string;
  definition_version: string;
  status: WorkflowExecutionStatus;
  current_step: string | null;
  started_at: string;
  completed_at: string | null;
  input_payload: unknown;
  output_payload: unknown;
  error_message: string | null;
  updated_at: string;
}

export const DEFAULT_WORKFLOW_EXECUTION_FILTERS: WorkflowExecutionFilters = {
  definitionName: "",
  status: "",
  startedFrom: "",
  startedTo: "",
};

const WORKFLOW_EXECUTION_SELECT =
  "workflow_id, run_id, definition_name, definition_version, status, current_step, started_at, completed_at, input_payload, output_payload, error_message, updated_at";

export function toStartOfDayIso(dateValue: string): string | null {
  if (!dateValue) {
    return null;
  }

  return new Date(`${dateValue}T00:00:00`).toISOString();
}

export function toEndOfDayIso(dateValue: string): string | null {
  if (!dateValue) {
    return null;
  }

  return new Date(`${dateValue}T23:59:59.999`).toISOString();
}

export function buildWorkflowExecutionQuery(
  client: SupabaseClient,
  filters: WorkflowExecutionFilters
) {
  let query = client
    .from("workflow_executions")
    .select(WORKFLOW_EXECUTION_SELECT)
    .order("started_at", { ascending: false });

  if (filters.definitionName) {
    query = query.eq("definition_name", filters.definitionName);
  }

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const startedFrom = toStartOfDayIso(filters.startedFrom);
  if (startedFrom) {
    query = query.gte("started_at", startedFrom);
  }

  const startedTo = toEndOfDayIso(filters.startedTo);
  if (startedTo) {
    query = query.lte("started_at", startedTo);
  }

  return query;
}

export async function listWorkflowExecutions(
  client: SupabaseClient,
  filters: WorkflowExecutionFilters
): Promise<WorkflowExecutionRecord[]> {
  const { data, error } = await buildWorkflowExecutionQuery(client, filters);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listWorkflowDefinitionNames(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from("workflow_definitions")
    .select("name")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return [...new Set((data ?? []).map((definition) => definition.name))];
}

export async function getWorkflowExecution(
  client: SupabaseClient,
  workflowId: string
): Promise<WorkflowExecutionRecord | null> {
  const { data, error } = await client
    .from("workflow_executions")
    .select(WORKFLOW_EXECUTION_SELECT)
    .eq("workflow_id", workflowId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export function formatWorkflowStatus(status: WorkflowExecutionStatus): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatWorkflowTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatWorkflowDuration(startedAt: string, completedAt: string | null): string {
  const started = new Date(startedAt).getTime();
  const ended = new Date(completedAt ?? new Date().toISOString()).getTime();
  const totalSeconds = Math.max(0, Math.floor((ended - started) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

export function formatWorkflowPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return JSON.stringify(value, null, 2);
}
