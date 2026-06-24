import { describe, expect, it } from "vitest";
import { isWorkflowHistoryPath } from "@/routes/__root";

describe("isWorkflowHistoryPath", () => {
  it("marks workflow history, legacy detail, and executions detail routes as active", () => {
    expect(isWorkflowHistoryPath("/workflows/history")).toBe(true);
    expect(isWorkflowHistoryPath("/workflows/wf-001")).toBe(true);
    expect(isWorkflowHistoryPath("/workflows/executions/wf-001")).toBe(true);
  });

  it("does not mark non-history workflow and non-workflow routes as active", () => {
    expect(isWorkflowHistoryPath("/workflows/definitions/claims-review")).toBe(false);
    expect(isWorkflowHistoryPath("/workflows/executions")).toBe(false);
    expect(isWorkflowHistoryPath("/entities/group")).toBe(false);
  });
});
