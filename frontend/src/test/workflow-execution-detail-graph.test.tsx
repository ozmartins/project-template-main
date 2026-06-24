import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";

describe("workflow execution detail graph integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders graph section with live failed overlay from fetched step data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/workflows/executions/wf-graph")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                execution: {
                  workflow_id: "wf-graph",
                  definition_name: "vertical-classification",
                  definition_version: "1.0.0",
                  status: "running",
                  started_at: "2026-06-21T10:00:00.000Z",
                },
                step_trace: [
                  {
                    step_index: 0,
                    step_name: "domain_probe",
                    status: "completed",
                  },
                  {
                    step_index: 1,
                    step_name: "web_search",
                    status: "failed",
                    error_message: "Web search quota exceeded",
                  },
                  {
                    step_index: 2,
                    step_name: "llm_agent",
                    status: "running",
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        return Promise.resolve(new Response("Not found", { status: 404 }));
      })
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/workflows/executions/wf-graph"] }),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    const graphNodes = await screen.findAllByTestId("workflow-graph-node");
    expect(graphNodes.length).toBeGreaterThan(0);

    const nodeWithError = graphNodes.find((n) =>
      n.textContent?.includes("Web search quota exceeded")
    );
    expect(nodeWithError).toBeTruthy();

    const nodeWithFailed = graphNodes.find((n) => n.textContent?.includes("Failed"));
    expect(nodeWithFailed).toBeTruthy();
  });
});
