import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

describe("workflow trigger navigation", () => {
  it("navigates to trigger workflow page from sidebar", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/workflows/history"] }),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Workflow history")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: "Trigger workflow" }));

    expect(await screen.findByRole("heading", { name: "Trigger workflow" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/workflows/trigger");
  });
});
