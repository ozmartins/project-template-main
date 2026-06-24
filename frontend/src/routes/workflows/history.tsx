import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/data/supabase";
import {
  DEFAULT_WORKFLOW_EXECUTION_FILTERS,
  formatWorkflowDuration,
  formatWorkflowStatus,
  formatWorkflowTimestamp,
  listWorkflowDefinitionNames,
  listWorkflowExecutions,
  WORKFLOW_EXECUTION_STATUSES,
  type WorkflowExecutionFilters,
  type WorkflowExecutionRecord,
} from "@/features/workflows/executions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workflows/history")({
  component: WorkflowHistoryRoute,
});

interface WorkflowHistoryRouteProps {
  listExecutions?: (filters: WorkflowExecutionFilters) => Promise<WorkflowExecutionRecord[]>;
  listDefinitions?: () => Promise<string[]>;
}

export function WorkflowHistoryRoute({
  listExecutions = (filters) => listWorkflowExecutions(supabase, filters),
  listDefinitions = () => listWorkflowDefinitionNames(supabase),
}: WorkflowHistoryRouteProps) {
  const [filters, setFilters] = useState<WorkflowExecutionFilters>(
    DEFAULT_WORKFLOW_EXECUTION_FILTERS
  );

  const executionQuery = useQuery({
    queryKey: ["workflow-executions", filters],
    queryFn: () => listExecutions(filters),
  });

  const definitionQuery = useQuery({
    queryKey: ["workflow-definition-names"],
    queryFn: listDefinitions,
  });

  const definitions = useMemo(() => definitionQuery.data ?? [], [definitionQuery.data]);

  function updateFilter<Key extends keyof WorkflowExecutionFilters>(
    key: Key,
    value: WorkflowExecutionFilters[Key]
  ) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Workflow execution history</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review recent and past workflow runs, narrow by backend-supported filters, and open the
          result inspector.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Filter by definition name, execution status, and started date range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="definition-name">Definition name</Label>
              <Input
                id="definition-name"
                list="workflow-definition-options"
                placeholder="All definitions"
                value={filters.definitionName}
                onChange={(event) => updateFilter("definitionName", event.target.value)}
              />
              <datalist id="workflow-definition-options">
                {definitions.map((definitionName) => (
                  <option key={definitionName} value={definitionName} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workflow-status">Status</Label>
              <select
                id="workflow-status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={filters.status}
                onChange={(event) =>
                  updateFilter("status", event.target.value as WorkflowExecutionFilters["status"])
                }
              >
                <option value="">All statuses</option>
                {WORKFLOW_EXECUTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatWorkflowStatus(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="started-from">Started on or after</Label>
              <Input
                id="started-from"
                type="date"
                value={filters.startedFrom}
                onChange={(event) => updateFilter("startedFrom", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="started-to">Started on or before</Label>
              <Input
                id="started-to"
                type="date"
                value={filters.startedTo}
                onChange={(event) => updateFilter("startedTo", event.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilters(DEFAULT_WORKFLOW_EXECUTION_FILTERS)}
            >
              Clear filters
            </Button>
            {definitionQuery.isError ? (
              <p className="text-sm text-destructive">Definition suggestions are unavailable.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Executions</CardTitle>
          <CardDescription>Recent runs are ordered by started time, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {executionQuery.isPending ? (
            <WorkflowHistoryLoadingState />
          ) : executionQuery.isError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not load workflow history</AlertTitle>
              <AlertDescription>
                The execution query failed. Refresh or retry after confirming the history query
                surface is available.
              </AlertDescription>
            </Alert>
          ) : executionQuery.data.length === 0 ? (
            <div
              className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="workflow-history-empty"
            >
              No workflow executions match the current filters.
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow ID</TableHead>
                    <TableHead>Definition</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executionQuery.data.map((execution) => (
                    <TableRow key={execution.workflow_id}>
                      <TableCell className="font-medium">
                        <Link
                          to="/workflows/$workflowId"
                          params={{ workflowId: execution.workflow_id }}
                          className="text-primary underline-offset-4 hover:underline"
                          data-testid={`workflow-link-${execution.workflow_id}`}
                        >
                          {execution.workflow_id}
                        </Link>
                      </TableCell>
                      <TableCell>{execution.definition_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={statusBadgeVariant(execution.status)}
                          className={cn(
                            statusTextClassName(execution.status),
                            "capitalize whitespace-nowrap"
                          )}
                        >
                          {formatWorkflowStatus(execution.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatWorkflowDuration(execution.started_at, execution.completed_at)}
                      </TableCell>
                      <TableCell>{formatWorkflowTimestamp(execution.started_at)}</TableCell>
                      <TableCell>{formatWorkflowTimestamp(execution.completed_at)}</TableCell>
                      <TableCell>{formatWorkflowTimestamp(execution.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowHistoryLoadingState() {
  return (
    <div className="space-y-3" data-testid="workflow-history-loading">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function statusBadgeVariant(status: WorkflowExecutionRecord["status"]) {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
    case "cancelled":
    case "timed_out":
      return "destructive";
  }
}

function statusTextClassName(status: WorkflowExecutionRecord["status"]) {
  return status === "completed" ? "text-foreground" : "";
}
