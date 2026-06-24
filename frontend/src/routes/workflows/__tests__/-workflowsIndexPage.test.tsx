// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@/data/supabase", () => ({ supabase: {} }));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (opts: { component: unknown }) => opts,
    useNavigate: () => vi.fn(),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UseQueryResult = {
  isLoading: boolean;
  isError: boolean;
  data: unknown;
  refetch: ReturnType<typeof vi.fn>;
};

const definitionsResult: UseQueryResult = {
  isLoading: false,
  isError: false,
  data: ["claims-review"],
  refetch: vi.fn(),
};

let workflowsResult: UseQueryResult = {
  isLoading: false,
  isError: false,
  data: { rows: [], total: 0 },
  refetch: vi.fn(),
};

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[] }) => {
      if ((opts.queryKey as string[])[1] === "definitions") {
        return definitionsResult;
      }
      return workflowsResult;
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: "exec-1",
    workflow_id: "wf-abc",
    definition_name: "claims-review",
    status: "completed",
    started_at: "2026-06-20T08:00:00.000Z",
    completed_at: "2026-06-20T08:05:30.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkflowsPage (index) — drill-in affordance", () => {
  it("renders an Open trace link for each execution row", async () => {
    workflowsResult = {
      isLoading: false,
      isError: false,
      data: { rows: [makeExecution()], total: 1 },
      refetch: vi.fn(),
    };

    const { WorkflowsPage } = await import("@/routes/workflows/index");
    render(<WorkflowsPage />, { wrapper });

    await waitFor(() => {
      const link = screen.getByTestId("workflow-open-trace-wf-abc");
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent("Open trace");
      expect(link).toHaveAttribute("href", "/workflows/wf-abc");
    });
  });
});

describe("WorkflowsPage (index) — empty state", () => {
  it("shows a generic message when no rows and no filters are active", async () => {
    workflowsResult = {
      isLoading: false,
      isError: false,
      data: { rows: [], total: 0 },
      refetch: vi.fn(),
    };

    const { WorkflowsPage } = await import("@/routes/workflows/index");
    render(<WorkflowsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("No workflow executions found.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });
});

describe("WorkflowsPage (index) — error state", () => {
  it("shows a Retry button when the workflow query fails", async () => {
    const refetch = vi.fn();
    workflowsResult = {
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    };

    const { WorkflowsPage } = await import("@/routes/workflows/index");
    render(<WorkflowsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load workflow history\./)).toBeInTheDocument();
    });

    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
    fireEvent.click(retryButton);
    expect(refetch).toHaveBeenCalledOnce();
  });
});
