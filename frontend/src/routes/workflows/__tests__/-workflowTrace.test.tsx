// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted so they are available inside vi.mock factories)
// ---------------------------------------------------------------------------

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: vi.fn(() => ({ workflowId: "wf-test-123" })),
}));

vi.mock("@/data/supabase", () => ({ supabase: {} }));
vi.mock("@/data/workflowApi", () => ({ workflowApiBaseUrl: "http://localhost:3000" }));
vi.mock("@/features/workflows/executions", () => ({
  formatWorkflowPayload: (p: unknown) => JSON.stringify(p),
  formatWorkflowStatus: (s: string) => s,
  getWorkflowExecution: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (opts: { component: unknown }) => ({
      ...opts,
      options: opts,
      useParams: mockUseParams,
    }),
    Link: ({
      children,
      to,
      ...props
    }: {
      children: ReactNode;
      to: string;
      [key: string]: unknown;
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, status = 200) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeApiResponse(
  overrides: {
    steps?: Array<{ step_name: string; status: string; duration_ms?: number }>;
    status?: string;
    run_id?: string;
    definition_name?: string;
    definition_version?: string;
    current_step?: string | null;
    started_at?: string;
    completed_at?: string;
  } = {}
) {
  return {
    execution: {
      workflow_id: "wf-test-123",
      run_id: overrides.run_id ?? "run-test-789",
      definition_name: overrides.definition_name ?? "smoke-classification",
      definition_version: overrides.definition_version ?? "1.0.0",
      status: overrides.status ?? "completed",
      current_step: overrides.current_step ?? null,
      started_at: overrides.started_at ?? "2026-01-01T10:00:00.000Z",
      completed_at: overrides.completed_at ?? "2026-01-01T10:00:03.000Z",
      duration_ms: 3000,
    },
    step_trace: overrides.steps ?? [
      { step_name: "classify_company", status: "completed", duration_ms: 3000 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  mockUseParams.mockReturnValue({ workflowId: "wf-test-123" });
});

describe("WorkflowTracePage — recovery link", () => {
  it("shows a Back to workflow history link at the top of the page", async () => {
    mockFetch(makeApiResponse());
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      const backLinks = screen.getAllByRole("link", { name: /back to workflow history/i });
      expect(backLinks.length).toBeGreaterThan(0);
      expect(backLinks[0]).toHaveAttribute("href", "/workflows/history");
    });
  });
});

describe("WorkflowTracePage — error state recovery", () => {
  it("shows a Back to workflow history link when the trace fails to load", async () => {
    mockFetch({ error: "unavailable" }, 500);
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Failed to load workflow trace")).toBeInTheDocument();
      const backLink = screen.getByRole("link", { name: /back to workflow history/i });
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute("href", "/workflows/history");
    });
  });
});

describe("WorkflowTracePage — execution summary", () => {
  it("surfaces definition, run, and timestamp context in the summary card", async () => {
    mockFetch(makeApiResponse());
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("smoke-classification v1.0.0 • Completed run")).toBeInTheDocument();
      const definitionLabel = screen.getByText("Definition");
      expect(definitionLabel).toBeInTheDocument();
      expect(definitionLabel.className).toContain("uppercase");
      expect(screen.getByText(/Run ID: run-test-789/)).toBeInTheDocument();
      expect(screen.getByText("Started")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
      const definitionValues = screen.getAllByText("smoke-classification v1.0.0");
      expect(definitionValues.some((element) => element.className.includes("break-words"))).toBe(
        true
      );
    });
  });

  it("formats multi-word workflow states for operators", async () => {
    mockFetch(makeApiResponse({ status: "timed_out" }));
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("smoke-classification v1.0.0 • Timed Out run")).toBeInTheDocument();
    });
  });

  it("falls back to an unknown state label when the payload omits workflow state", async () => {
    mockFetch({
      workflow_id: "wf-test-123",
      steps: [],
    });
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Workflow execution • Unknown run")).toBeInTheDocument();
    });
  });

  it("falls back to an unknown state label when the payload provides an empty state string", async () => {
    mockFetch({
      workflow_id: "wf-test-123",
      state: "",
      steps: [],
    });
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Workflow execution • Unknown run")).toBeInTheDocument();
    });
  });

  it("shows the raw workflow ID for operator reference", async () => {
    mockFetch(makeApiResponse());
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Workflow ID: wf-test-123/)).toBeInTheDocument();
    });
  });
});

describe("WorkflowTracePage — empty state", () => {
  it("shows a no-steps message with a recovery link when steps array is empty", async () => {
    mockFetch(makeApiResponse({ steps: [] }));
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("No steps recorded yet")).toBeInTheDocument();
      const recoveryLink = screen.getByRole("link", { name: /return to workflow history/i });
      expect(recoveryLink).toBeInTheDocument();
      expect(recoveryLink).toHaveAttribute("href", "/workflows/history");
    });
  });

  it("shows a no-steps message when steps field is absent from the API response", async () => {
    mockFetch({
      execution: {
        workflow_id: "wf-test-123",
        status: "running",
        started_at: "2026-01-01T10:00:00.000Z",
        duration_ms: undefined,
      },
      step_trace: [],
    });
    const { WorkflowTracePage } = await import("@/routes/workflows/$workflowId");

    render(<WorkflowTracePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("No steps recorded yet")).toBeInTheDocument();
    });
  });
});
