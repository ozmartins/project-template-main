// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetWorkflowDefinition = vi.fn();
const mockListWorkflowDefinitions = vi.fn(() => [
  "smoke-classification",
  "vertical-classification",
]);

vi.mock("@/data/workflowDefinitions", () => ({
  getWorkflowDefinition: (...args: unknown[]) => mockGetWorkflowDefinition(...args),
  listWorkflowDefinitions: () => mockListWorkflowDefinitions(),
}));

vi.mock("@/components/WorkflowGraph", () => ({
  WorkflowGraph: () => <div data-testid="workflow-graph-node" />,
}));

// Preserve real createFileRoute so Route.useParams is available for spying,
// but stub Link to avoid needing a RouterProvider in unit tests.
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
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
// Component under test — imported after mocks are in place
// ---------------------------------------------------------------------------

import { Route, WorkflowDefinitionRoute } from "@/routes/workflows/definitions/$name";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkflowDefinitionRoute — missing-definition fallback", () => {
  it("shows not-found messaging when the definition does not exist", () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ name: "nonexistent-xyz" });
    mockGetWorkflowDefinition.mockReturnValue(undefined);

    render(<WorkflowDefinitionRoute />);

    expect(screen.getByText("Workflow definition not found")).toBeInTheDocument();
  });

  it("renders a visible catalog recovery link for unknown definitions", () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ name: "nonexistent-xyz" });
    mockGetWorkflowDefinition.mockReturnValue(undefined);

    render(<WorkflowDefinitionRoute />);

    const link = screen.getByRole("link", { name: /back to definitions catalog/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/workflows/definitions");
  });

  it("does not render workflow graph content for unknown definitions", () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ name: "nonexistent-xyz" });
    mockGetWorkflowDefinition.mockReturnValue(undefined);

    render(<WorkflowDefinitionRoute />);

    expect(screen.queryByTestId("workflow-graph-node")).not.toBeInTheDocument();
  });

  it("keeps available-definition names visible in the fallback", () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ name: "stale-name" });
    mockGetWorkflowDefinition.mockReturnValue(undefined);

    render(<WorkflowDefinitionRoute />);

    expect(screen.getByText(/smoke-classification/)).toBeInTheDocument();
  });
});
