import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKFLOW_EXECUTION_FILTERS,
  type WorkflowExecutionRecord,
} from "@/features/workflows/executions";
import { isWorkflowHistoryPath } from "@/routes/__root";
import {
  Route as WorkflowExecutionDetailFileRoute,
  WorkflowExecutionDetailRoute,
} from "@/routes/workflows/$workflowId";
import { WorkflowHistoryRoute } from "@/routes/workflows/history";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");

  return {
    ...actual,
    Link: ({
      children,
      params,
      to,
      ...props
    }: {
      children: ReactNode;
      params?: { workflowId?: string };
      to: string;
      [key: string]: unknown;
    }) => (
      <a href={to.replace("$workflowId", params?.workflowId ?? "")} {...props}>
        {children}
      </a>
    ),
  };
});

const execution: WorkflowExecutionRecord = {
  workflow_id: "wf-001",
  run_id: "run-001",
  definition_name: "claims-review",
  definition_version: "v1",
  status: "failed",
  current_step: "review",
  started_at: "2026-06-20T08:00:00.000Z",
  completed_at: "2026-06-20T08:05:30.000Z",
  input_payload: { claimId: "123" },
  output_payload: null,
  error_message: "Needs operator review",
  updated_at: "2026-06-20T08:05:30.000Z",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkflowHistoryRoute", () => {
  it("updates server-side filter state and renders drill-in links", async () => {
    const listExecutions = vi.fn().mockResolvedValue([execution]);
    const listDefinitions = vi.fn().mockResolvedValue(["claims-review"]);

    renderWithProviders(
      <WorkflowHistoryRoute listExecutions={listExecutions} listDefinitions={listDefinitions} />
    );

    await waitFor(() => {
      expect(listExecutions).toHaveBeenCalledWith(DEFAULT_WORKFLOW_EXECUTION_FILTERS);
    });

    fireEvent.change(screen.getByLabelText("Definition name"), {
      target: { value: "claims-review" },
    });

    await waitFor(() => {
      expect(listExecutions).toHaveBeenLastCalledWith({
        ...DEFAULT_WORKFLOW_EXECUTION_FILTERS,
        definitionName: "claims-review",
      });
    });

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "failed" },
    });

    await waitFor(() => {
      expect(listExecutions).toHaveBeenLastCalledWith({
        ...DEFAULT_WORKFLOW_EXECUTION_FILTERS,
        definitionName: "claims-review",
        status: "failed",
      });
    });

    fireEvent.change(screen.getByLabelText("Started on or after"), {
      target: { value: "2026-06-20" },
    });

    await waitFor(() => {
      expect(listExecutions).toHaveBeenLastCalledWith({
        ...DEFAULT_WORKFLOW_EXECUTION_FILTERS,
        definitionName: "claims-review",
        status: "failed",
        startedFrom: "2026-06-20",
      });
    });

    expect(screen.getByTestId("workflow-link-wf-001")).toHaveAttribute("href", "/workflows/wf-001");
  });
});

describe("WorkflowExecutionDetailRoute", () => {
  it("renders workflow detail fields for the inspector route", async () => {
    vi.spyOn(WorkflowExecutionDetailFileRoute, "useParams").mockReturnValue({
      workflowId: execution.workflow_id,
    });

    const getExecution = vi.fn().mockResolvedValue(execution);

    renderWithProviders(<WorkflowExecutionDetailRoute getExecution={getExecution} />);

    await screen.findByText("Workflow result inspector");

    expect(getExecution).toHaveBeenCalledWith("wf-001");
    expect(screen.getByRole("link", { name: "← Back to workflow history" })).toHaveAttribute(
      "href",
      "/workflows/history"
    );
    expect(screen.getByText("claims-review")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("run-001")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText(/"claimId": "123"/)).toBeInTheDocument();
    expect(screen.getByText("Needs operator review")).toBeInTheDocument();
  });

  it("renders a not-found state when no execution is returned", async () => {
    vi.spyOn(WorkflowExecutionDetailFileRoute, "useParams").mockReturnValue({
      workflowId: execution.workflow_id,
    });

    renderWithProviders(
      <WorkflowExecutionDetailRoute getExecution={vi.fn().mockResolvedValue(null)} />
    );

    expect(await screen.findByText("Workflow execution not found")).toBeInTheDocument();
    expect(screen.getByText(/No workflow execution was returned for/)).toBeInTheDocument();
  });
});

describe("isWorkflowHistoryPath", () => {
  it("marks history and workflow detail routes active without matching definitions routes", () => {
    expect(isWorkflowHistoryPath("/workflows/history")).toBe(true);
    expect(isWorkflowHistoryPath("/workflows/wf-001")).toBe(true);
    expect(isWorkflowHistoryPath("/workflows/definitions/claims-review")).toBe(false);
    expect(isWorkflowHistoryPath("/entities/group")).toBe(false);
  });
});

function renderWithProviders(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}
