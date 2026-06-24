import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW_API_URL } from "@/data/workflowApi";
import { getWorkflowExecutionEndpoint } from "@/routes/workflows/$workflowId";

describe("getWorkflowExecutionEndpoint", () => {
  it("uses configured workflow execution API path instead of legacy /api/workflows", () => {
    const workflowId = "wf/001";
    const endpoint = getWorkflowExecutionEndpoint(workflowId);

    expect(endpoint).toBe(`${DEFAULT_WORKFLOW_API_URL}/workflows/executions/wf%2F001`);
    expect(endpoint).not.toContain("/api/workflows/");
  });
});
