// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, WorkflowExecutionDetailPage } from "@/routes/workflows/executions/$workflowId";

function buildApiResponse(
  overrides: {
    definition_name?: string;
    status?: string;
    stepTrace?: Array<{ step_name: string; status: string; error_message?: string }>;
  } = {}
) {
  return {
    execution: {
      workflow_id: "exec-001",
      definition_name: overrides.definition_name ?? "vertical-classification",
      status: overrides.status ?? "completed",
      started_at: "2026-06-20T10:00:00.000Z",
      completed_at: "2026-06-20T10:01:00.000Z",
    },
    step_trace: overrides.stepTrace ?? [],
  };
}

function mockFetch(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkflowExecutionDetailPage graph integration", () => {
  it("renders the workflow graph for a known definition", async () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ workflowId: "exec-001" });
    mockFetch(buildApiResponse());

    render(<WorkflowExecutionDetailPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByText("Workflow graph").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByTestId("workflow-graph-node").length).toBeGreaterThan(0);
  });

  it("reflects a failed step's error message in the graph overlay", async () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ workflowId: "exec-001" });
    mockFetch(
      buildApiResponse({
        status: "failed",
        stepTrace: [
          { step_name: "domain_probe", status: "completed" },
          {
            step_name: "web_search",
            status: "failed",
            error_message: "Search quota exceeded",
          },
        ],
      })
    );

    render(<WorkflowExecutionDetailPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByText("Workflow graph").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Search quota exceeded").length).toBeGreaterThan(0);
    const failedBadges = screen
      .getAllByTestId("workflow-graph-node")
      .filter((node) => node.textContent?.includes("Failed"));
    expect(failedBadges.length).toBeGreaterThan(0);
  });

  it("does not show graph nodes as Running when API step statuses are unknown", async () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ workflowId: "exec-001" });
    mockFetch(
      buildApiResponse({
        status: "running",
        stepTrace: [
          { step_name: "domain_probe", status: "pending" },
          { step_name: "web_search", status: "queued" },
          { step_name: "llm_agent", status: "cancelled" },
          { step_name: "classification_result", status: "timed_out" },
        ],
      })
    );

    render(<WorkflowExecutionDetailPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByText("Workflow graph").length).toBeGreaterThan(0);
    });

    const runningGraphNodes = screen
      .getAllByTestId("workflow-graph-node")
      .filter((node) => node.textContent?.includes("Running"));
    expect(runningGraphNodes).toHaveLength(0);
  });

  it("hides the workflow graph when definition_name is not registered", async () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ workflowId: "exec-001" });
    mockFetch(buildApiResponse({ definition_name: "not-a-real-definition" }));

    render(<WorkflowExecutionDetailPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Workflow execution exec-001")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("workflow-graph-node")).not.toBeInTheDocument();
  });
});
