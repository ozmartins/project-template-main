import { describe, expect, it } from "vitest";
import {
  resolveCurrentGraphStep,
  toWorkflowGraphSteps,
} from "@/routes/workflows/executions/$workflowId";

describe("workflow execution graph overlay mapping", () => {
  it("maps execution steps into workflow graph overlay steps", () => {
    const mapped = toWorkflowGraphSteps([
      {
        index: 2,
        step_path: "steps.sequence.steps[2]",
        activity_name: "web_search",
        status: "FAILED",
        error_message: "Request timed out",
      },
      {
        step_name: "llm_agent",
        status: "running",
      },
    ]);

    expect(mapped).toEqual([
      {
        step_index: 2,
        step_name: "web_search",
        step_path: "steps.sequence.steps[2]",
        status: "failed",
        error_message: "Request timed out",
        duration_ms: undefined,
        started_at: undefined,
        completed_at: undefined,
      },
      {
        step_index: 1,
        step_name: "llm_agent",
        step_path: undefined,
        status: "running",
        error_message: undefined,
        duration_ms: undefined,
        started_at: undefined,
        completed_at: undefined,
      },
    ]);
  });

  it("only resolves current graph step when execution is running", () => {
    const steps = toWorkflowGraphSteps([
      { step_name: "domain_probe", status: "completed" },
      { step_name: "web_search", status: "running" },
    ]);

    expect(resolveCurrentGraphStep(steps, "running")).toBe("web_search");
    expect(resolveCurrentGraphStep(steps, "completed")).toBeUndefined();
  });
});
