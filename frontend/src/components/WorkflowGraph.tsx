import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Check, GitBranch, LoaderCircle, Split, Workflow, X } from "lucide-react";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DSLDefinition, DSLStep, WorkflowExecutionStep } from "@/types/workflows";

interface WorkflowGraphProps {
  definition: DSLDefinition;
  steps?: WorkflowExecutionStep[];
  currentStep?: string;
}

type WorkflowNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

type WorkflowGraphNodeData = Record<string, unknown> & {
  label: string;
  kind: "activity" | "condition" | "parallel" | "child_workflow";
  subtitle?: string;
  status: WorkflowNodeStatus;
  errorMessage?: string;
  stepPath?: string;
};

interface BuildState {
  currentColumn: number;
  currentRow: number;
  nodes: Node<WorkflowGraphNodeData>[];
  edges: Edge[];
  edgeCount: number;
  nodeCount: number;
  stepNameOccurrences: Map<string, number>;
  currentStepConsumed: boolean;
}

interface BuildResult {
  entry: string | null;
  exits: string[];
}

interface StepOverlayLookup {
  byPath: Map<string, Pick<WorkflowGraphNodeData, "status" | "errorMessage">>;
  byName: Map<string, Pick<WorkflowGraphNodeData, "status" | "errorMessage">[]>;
  currentStep?: string;
}

const COLUMN_GAP = 260;
const ROW_GAP = 150;

const STATUS_STYLES: Record<WorkflowNodeStatus, string> = {
  pending: "border-border bg-card text-card-foreground",
  running: "border-amber-400 bg-amber-50 text-amber-950",
  completed: "border-emerald-500 bg-emerald-50 text-emerald-950",
  failed: "border-red-500 bg-red-50 text-red-950",
  skipped: "border-slate-300 bg-slate-100 text-slate-700",
};

const STATUS_BADGE_STYLES: Record<WorkflowNodeStatus, string> = {
  pending: "border-border text-muted-foreground",
  running: "border-amber-300 bg-amber-100 text-amber-900",
  completed: "border-emerald-300 bg-emerald-100 text-emerald-900",
  failed: "border-red-300 bg-red-100 text-red-900",
  skipped: "border-slate-300 bg-slate-200 text-slate-700",
};

const STATUS_LABELS: Record<WorkflowNodeStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

function resolveNodeStatus(
  name: string,
  stepPath: string,
  state: BuildState,
  overlays: StepOverlayLookup
): Pick<WorkflowGraphNodeData, "status" | "errorMessage"> {
  const occurrence = state.stepNameOccurrences.get(name) ?? 0;
  state.stepNameOccurrences.set(name, occurrence + 1);
  const executionStep = overlays.byPath.get(stepPath) ?? overlays.byName.get(name)?.[occurrence];

  if (executionStep?.status === "failed") {
    return { status: "failed", errorMessage: executionStep.errorMessage };
  }

  if (executionStep?.status === "completed") {
    return { status: "completed" };
  }

  if (executionStep?.status === "skipped") {
    return { status: "skipped" };
  }

  if (executionStep?.status === "running") {
    return { status: "running" };
  }

  if (!state.currentStepConsumed && overlays.currentStep === name) {
    state.currentStepConsumed = true;
    return { status: "running" };
  }

  return { status: "pending" };
}

function nextEdgeId(state: BuildState): string {
  state.edgeCount += 1;
  return `edge-${state.edgeCount}`;
}

function nextNodeId(state: BuildState): string {
  state.nodeCount += 1;
  return `node-${state.nodeCount}`;
}

function addEdge(state: BuildState, source: string, target: string, label?: string) {
  state.edges.push({
    id: nextEdgeId(state),
    source,
    target,
    label,
    markerEnd: {
      type: "arrowclosed",
      width: 18,
      height: 18,
      color: "hsl(230 15% 50%)",
    },
    style: {
      stroke: "hsl(230 15% 50%)",
      strokeWidth: 1.5,
    },
    labelStyle: {
      fill: "hsl(230 15% 40%)",
      fontSize: 12,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: "hsl(230 20% 97%)",
    },
  });
}

function addNode(
  state: BuildState,
  column: number,
  row: number,
  data: WorkflowGraphNodeData
): BuildResult {
  const id = nextNodeId(state);

  state.nodes.push({
    id,
    type:
      data.kind === "condition" ? "condition" : data.kind === "parallel" ? "parallel" : "workflow",
    position: {
      x: column * COLUMN_GAP,
      y: row * ROW_GAP,
    },
    data,
  });

  state.currentColumn = Math.max(state.currentColumn, column);
  state.currentRow = Math.max(state.currentRow, row);

  return { entry: id, exits: [id] };
}

function toStepOverlay(
  step: WorkflowExecutionStep
): Pick<WorkflowGraphNodeData, "status" | "errorMessage"> {
  if (step.status === "failed") {
    return step.error_message
      ? { status: "failed", errorMessage: step.error_message }
      : { status: "failed" };
  }

  return { status: step.status };
}

function buildStepOverlayLookup(
  steps: WorkflowExecutionStep[] | undefined,
  currentStep: string | undefined
): StepOverlayLookup {
  const byPath = new Map<string, Pick<WorkflowGraphNodeData, "status" | "errorMessage">>();
  const byName = new Map<string, Pick<WorkflowGraphNodeData, "status" | "errorMessage">[]>();

  for (const step of [...(steps ?? [])].sort((left, right) => left.step_index - right.step_index)) {
    const overlay = toStepOverlay(step);

    if (step.step_path) {
      byPath.set(step.step_path, overlay);
      continue;
    }

    const overlays = byName.get(step.step_name) ?? [];
    overlays.push(overlay);
    byName.set(step.step_name, overlays);
  }

  return { byPath, byName, currentStep };
}

function buildGraphStep(
  step: DSLStep,
  path: string,
  column: number,
  row: number,
  state: BuildState,
  overlays: StepOverlayLookup
): BuildResult {
  if ("sequence" in step) {
    let entry: string | null = null;
    let exits: string[] = [];
    let nextRow = row;

    for (const [index, child] of step.sequence.steps.entries()) {
      const childResult = buildGraphStep(
        child,
        `${path}.sequence.steps[${index}]`,
        column,
        nextRow,
        state,
        overlays
      );

      if (!childResult.entry) {
        continue;
      }

      if (entry === null) {
        entry = childResult.entry;
      }

      if (exits.length > 0) {
        for (const previousExit of exits) {
          addEdge(state, previousExit, childResult.entry);
        }
      }

      exits = childResult.exits;
      nextRow = state.currentRow + 1;
    }

    return { entry, exits };
  }

  if ("condition" in step) {
    const conditionNode = addNode(state, column, row, {
      kind: "condition",
      label: "Condition",
      subtitle: step.condition.if,
      status: "pending",
      stepPath: path,
    });

    const thenResult = buildGraphStep(
      step.condition.then,
      `${path}.condition.then`,
      column + 1,
      row,
      state,
      overlays
    );
    const elseRow = Math.max(state.currentRow + 1, row + 1);
    const elseResult = step.condition.else
      ? buildGraphStep(
          step.condition.else,
          `${path}.condition.else`,
          column + 1,
          elseRow,
          state,
          overlays
        )
      : { entry: null, exits: conditionNode.exits };

    if (thenResult.entry) {
      addEdge(state, conditionNode.entry as string, thenResult.entry, "if true");
    }

    if (elseResult.entry) {
      addEdge(state, conditionNode.entry as string, elseResult.entry, "else");
    }

    return {
      entry: conditionNode.entry,
      exits: [...thenResult.exits, ...elseResult.exits],
    };
  }

  if ("parallel" in step) {
    const forkNode = addNode(state, column, row, {
      kind: "parallel",
      label: "Fork",
      subtitle: `${step.parallel.branches.length} branches`,
      status: "pending",
      stepPath: `${path}.parallel.fork`,
    });

    const branchResults = step.parallel.branches.map((branch, index) =>
      buildGraphStep(
        branch,
        `${path}.parallel.branches[${index}]`,
        column + 1,
        row + index * 2,
        state,
        overlays
      )
    );

    const joinRow = Math.max(state.currentRow + 1, row + step.parallel.branches.length * 2);
    const joinNode = addNode(state, column + 2, joinRow, {
      kind: "parallel",
      label: "Join",
      subtitle: step.parallel.wait_all === false ? "first branch wins" : "wait for all",
      status: "pending",
      stepPath: `${path}.parallel.join`,
    });

    for (const branchResult of branchResults) {
      if (!branchResult.entry) {
        continue;
      }

      addEdge(state, forkNode.entry as string, branchResult.entry);

      for (const branchExit of branchResult.exits) {
        addEdge(state, branchExit, joinNode.entry as string);
      }
    }

    return {
      entry: forkNode.entry,
      exits: joinNode.exits,
    };
  }

  if ("set_variable" in step) {
    return {
      entry: null,
      exits: [],
    };
  }

  if ("activity" in step) {
    const status = resolveNodeStatus(step.activity.name, path, state, overlays);

    return addNode(state, column, row, {
      kind: "activity",
      label: step.activity.name,
      subtitle: step.activity.result ? `result → ${step.activity.result}` : undefined,
      stepPath: path,
      ...status,
    });
  }

  if ("child_workflow" in step) {
    const status = resolveNodeStatus(step.child_workflow.workflow, path, state, overlays);

    return addNode(state, column, row, {
      kind: "child_workflow",
      label: step.child_workflow.workflow,
      subtitle: step.child_workflow.result
        ? `result → ${step.child_workflow.result}`
        : "Child workflow",
      stepPath: path,
      ...status,
    });
  }

  if ("wait_signal" in step) {
    const status = resolveNodeStatus(step.wait_signal.signal, path, state, overlays);

    return addNode(state, column, row, {
      kind: "activity",
      label: `wait:${step.wait_signal.signal}`,
      subtitle: step.wait_signal.timeout ? `timeout ${step.wait_signal.timeout}` : "Wait signal",
      stepPath: path,
      ...status,
    });
  }

  if ("sleep" in step) {
    return addNode(state, column, row, {
      kind: "activity",
      label: step.sleep.label ?? "sleep",
      subtitle: step.sleep.duration,
      status: "pending",
    });
  }

  if ("wait_until" in step) {
    return addNode(state, column, row, {
      kind: "activity",
      label: step.wait_until.label ?? "wait_until",
      subtitle: step.wait_until.timestamp,
      status: "pending",
    });
  }

  if ("for_each" in step) {
    return addNode(state, column, row, {
      kind: "activity",
      label: "for_each",
      subtitle: `${step.for_each.mode ?? "sequential"} over ${step.for_each.items}`,
      status: "pending",
    });
  }

  if ("try_catch" in step) {
    return addNode(state, column, row, {
      kind: "activity",
      label: "try_catch",
      subtitle: step.try_catch.catch ? "with catch" : "try only",
      status: "pending",
    });
  }

  if ("query_handler" in step) {
    return addNode(state, column, row, {
      kind: "activity",
      label: step.query_handler.query,
      subtitle: "Query handler",
      status: "pending",
    });
  }

  return addNode(state, column, row, {
    kind: "activity",
    label: "unknown_step",
    subtitle: "Unsupported step",
    status: "pending",
  });
}

export function buildWorkflowGraph(
  definition: DSLDefinition,
  steps?: WorkflowExecutionStep[],
  currentStep?: string
): { nodes: Node<WorkflowGraphNodeData>[]; edges: Edge[] } {
  const overlays = buildStepOverlayLookup(steps, currentStep);
  const state: BuildState = {
    currentColumn: 0,
    currentRow: 0,
    nodes: [],
    edges: [],
    edgeCount: 0,
    nodeCount: 0,
    stepNameOccurrences: new Map(),
    currentStepConsumed: false,
  };

  buildGraphStep(definition.steps, "steps", 0, 0, state, overlays);

  return {
    nodes: state.nodes,
    edges: state.edges,
  };
}

function WorkflowNode({ data }: { data: WorkflowGraphNodeData }) {
  return (
    <div
      className={cn(
        "min-w-56 rounded-xl border-2 px-4 py-3 shadow-sm transition-colors",
        data.kind === "child_workflow" && "border-dashed",
        STATUS_STYLES[data.status]
      )}
      data-testid="workflow-graph-node"
      title={data.status === "failed" ? data.errorMessage : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {data.kind === "child_workflow" ? (
              <Workflow className="h-4 w-4" />
            ) : data.kind === "parallel" ? (
              <Split className="h-4 w-4" />
            ) : (
              <GitBranch className="h-4 w-4" />
            )}
            <span>{data.label}</span>
          </div>
          {data.subtitle ? (
            <p className="max-w-56 whitespace-pre-wrap text-xs text-muted-foreground">
              {data.subtitle}
            </p>
          ) : null}
        </div>
        <Badge
          variant="outline"
          className={cn("gap-1 capitalize", STATUS_BADGE_STYLES[data.status])}
        >
          {data.status === "completed" ? (
            <Check className="h-3 w-3" />
          ) : data.status === "running" ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : data.status === "failed" ? (
            <X className="h-3 w-3" />
          ) : null}
          {STATUS_LABELS[data.status]}
        </Badge>
      </div>
      {data.status === "failed" && data.errorMessage ? (
        <p className="mt-3 text-xs font-medium text-red-700">{data.errorMessage}</p>
      ) : null}
    </div>
  );
}

const ConditionNode = memo(function ConditionNode({ data }: { data: WorkflowGraphNodeData }) {
  return (
    <div
      className="flex h-40 w-40 items-center justify-center"
      data-testid="workflow-graph-node"
      title={data.subtitle}
    >
      <div className="relative h-28 w-28 rotate-45 rounded-2xl border-2 border-primary bg-accent shadow-sm">
        <div className="absolute inset-0 flex -rotate-45 flex-col items-center justify-center px-3 text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Condition
          </span>
          <span className="mt-2 whitespace-pre-wrap text-xs text-accent-foreground">
            {data.subtitle}
          </span>
        </div>
      </div>
    </div>
  );
});

export function WorkflowGraph({ definition, steps, currentStep }: WorkflowGraphProps) {
  const graph = buildWorkflowGraph(definition, steps, currentStep);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Workflow graph</CardTitle>
        <CardDescription>
          Zoom, pan, and inspect the workflow definition with live step status overlays.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[640px] rounded-xl border bg-background">
          <ReactFlowProvider>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              fitView
              minZoom={0.5}
              maxZoom={1.75}
              nodesDraggable={false}
              nodeTypes={{
                workflow: WorkflowNode,
                condition: ConditionNode,
                parallel: WorkflowNode,
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </CardContent>
    </Card>
  );
}
