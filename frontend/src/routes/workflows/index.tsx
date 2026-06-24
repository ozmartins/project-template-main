import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/data/supabase";

const PAGE_SIZE = 25;

type WorkflowStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out" | string;

interface WorkflowExecution {
  id: string;
  workflow_id: string;
  definition_name: string;
  status: WorkflowStatus;
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  input?: unknown;
  input_payload?: unknown;
}

export const Route = createFileRoute("/workflows/")({
  component: WorkflowsPage,
});

export function WorkflowsPage() {
  const navigate = useNavigate();
  const [definitionName, setDefinitionName] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [page, setPage] = useState(1);

  const offset = (page - 1) * PAGE_SIZE;

  const definitionsQuery = useQuery({
    queryKey: ["workflows", "definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_executions")
        .select("definition_name")
        .order("definition_name", { ascending: true });

      if (error) {
        throw error;
      }

      return Array.from(
        new Set(
          (data ?? []).map((row) => row.definition_name).filter((value): value is string => !!value)
        )
      );
    },
  });

  const workflowsQuery = useQuery({
    queryKey: ["workflows", "history", definitionName, status, startDate, endDate, page],
    queryFn: async () => {
      let query = supabase.from("workflow_executions").select("*", { count: "exact" });

      if (definitionName !== "all") {
        query = query.eq("definition_name", definitionName);
      }

      if (status !== "all") {
        query = query.eq("status", status);
      }

      if (startDate) {
        query = query.gte("started_at", `${startDate}T00:00:00.000Z`);
      }

      if (endDate) {
        query = query.lte("started_at", `${endDate}T23:59:59.999Z`);
      }

      const { data, error, count } = await query
        .order("started_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as WorkflowExecution[];
      return {
        rows,
        total: count ?? rows.length,
      };
    },
  });

  const totalRows = workflowsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const canPreviousPage = page > 1;
  const canNextPage = page < totalPages;

  const rows = workflowsQuery.data?.rows ?? [];
  const hasActiveFilters = definitionName !== "all" || status !== "all" || !!startDate || !!endDate;

  function clearFilters() {
    setDefinitionName("all");
    setStatus("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Workflow History</CardTitle>
          <CardDescription>Execution history from workflow_executions.</CardDescription>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Select
            value={definitionName}
            onValueChange={(next) => {
              setDefinitionName(next);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Definition filter">
              <SelectValue placeholder="All definitions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All definitions</SelectItem>
              {(definitionsQuery.data ?? []).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Status filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Input
            aria-label="Start date filter"
            type="date"
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setPage(1);
            }}
          />

          <Input
            aria-label="End date filter"
            type="date"
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Definition Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Input Summary</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Started At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((execution) => (
              <TableRow
                key={execution.id}
                className="cursor-pointer"
                onClick={() => {
                  navigate({
                    to: "/workflows/$workflowId",
                    params: { workflowId: execution.workflow_id },
                  });
                }}
              >
                <TableCell className="font-medium">{execution.definition_name}</TableCell>
                <TableCell>
                  <StatusBadge status={execution.status} />
                </TableCell>
                <TableCell className="max-w-[320px] truncate">
                  {toInputSummary(execution)}
                </TableCell>
                <TableCell>{formatDuration(execution)}</TableCell>
                <TableCell>{formatDateTime(execution.started_at)}</TableCell>
                <TableCell>
                  <Link
                    to="/workflows/$workflowId"
                    params={{ workflowId: execution.workflow_id }}
                    className="text-primary underline-offset-4 hover:underline text-sm font-medium"
                    data-testid={`workflow-open-trace-${execution.workflow_id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open trace
                  </Link>
                </TableCell>
              </TableRow>
            ))}

            {workflowsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center py-8">
                  Loading workflow history…
                </TableCell>
              </TableRow>
            )}

            {workflowsQuery.isError && !workflowsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
                    <p className="text-sm text-destructive">Failed to load workflow history.</p>
                    <Button variant="outline" size="sm" onClick={() => workflowsQuery.refetch()}>
                      Retry
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {!workflowsQuery.isLoading && !workflowsQuery.isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  {hasActiveFilters ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        No executions match the current filters.
                      </p>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No workflow executions found.</p>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {rows.length ? offset + 1 : 0}-{offset + rows.length} of {totalRows}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={!canPreviousPage || workflowsQuery.isLoading}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {Math.min(page, totalPages)} of {totalPages}
            </span>
            <Button
              variant="outline"
              onClick={() => setPage((current) => current + 1)}
              disabled={!canNextPage || workflowsQuery.isLoading}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge variant="default">completed</Badge>;
  if (status === "running") return <Badge variant="secondary">running</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function toInputSummary(execution: WorkflowExecution): string {
  const payload = execution.input ?? execution.input_payload;
  if (payload === undefined || payload === null) return "—";

  if (typeof payload === "string") {
    return truncate(payload);
  }

  if (typeof payload === "object") {
    try {
      return truncate(JSON.stringify(payload));
    } catch {
      return "[unserializable]";
    }
  }

  return truncate(String(payload));
}

function truncate(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatDuration(execution: WorkflowExecution): string {
  const fromColumn = execution.duration_ms;
  if (typeof fromColumn === "number" && fromColumn >= 0) {
    return formatDurationMs(fromColumn);
  }

  if (execution.completed_at) {
    const started = new Date(execution.started_at);
    const completed = new Date(execution.completed_at);
    const ms = completed.getTime() - started.getTime();
    if (!Number.isNaN(ms) && ms >= 0) {
      return formatDurationMs(ms);
    }
  }

  return "—";
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;

  const totalSeconds = Math.floor(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
