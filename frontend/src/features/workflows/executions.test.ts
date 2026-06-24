import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  buildWorkflowExecutionQuery,
  toEndOfDayIso,
  toStartOfDayIso,
  type WorkflowExecutionFilters,
} from "./executions";

describe("buildWorkflowExecutionQuery", () => {
  it("applies server-side filters for definition, status, and date range", () => {
    const filters: WorkflowExecutionFilters = {
      definitionName: "claims-review",
      status: "failed",
      startedFrom: "2026-06-20",
      startedTo: "2026-06-21",
    };

    const query = {
      order: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
    };

    query.order.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lte.mockReturnValue(query);

    const select = vi.fn().mockReturnValue(query);
    const client = {
      from: vi.fn().mockReturnValue({
        select,
      }),
    } as unknown as SupabaseClient;

    buildWorkflowExecutionQuery(client, filters);

    expect(client.from).toHaveBeenCalledWith("workflow_executions");
    expect(select).toHaveBeenCalled();
    expect(query.eq).toHaveBeenNthCalledWith(1, "definition_name", "claims-review");
    expect(query.eq).toHaveBeenNthCalledWith(2, "status", "failed");
    expect(query.gte).toHaveBeenCalledWith("started_at", toStartOfDayIso("2026-06-20"));
    expect(query.lte).toHaveBeenCalledWith("started_at", toEndOfDayIso("2026-06-21"));
  });
});
