import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildWorkflowGraph, WorkflowGraph } from "@/components/WorkflowGraph";
import verticalClassificationDefinition from "@/data/definitions/vertical-classification.json";
import type { DSLDefinition, DSLStep, WorkflowExecutionStep } from "@/types/workflows";

describe("WorkflowGraph", () => {
  const definition = verticalClassificationDefinition as DSLDefinition;

  it("builds the expected node count for vertical-classification", () => {
    const graph = buildWorkflowGraph(definition);

    expect(graph.nodes).toHaveLength(8);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("renders failed and running execution overlays", () => {
    const steps: WorkflowExecutionStep[] = [
      { step_index: 0, step_name: "domain_probe", status: "completed" },
      {
        step_index: 1,
        step_name: "web_search",
        status: "failed",
        error_message: "Web search quota exceeded",
      },
      { step_index: 2, step_name: "llm_agent", status: "running" },
    ];

    render(<WorkflowGraph definition={definition} steps={steps} currentStep="llm_agent" />);

    expect(screen.getAllByTestId("workflow-graph-node")).toHaveLength(8);
    expect(screen.getByText("Web search quota exceeded")).toBeInTheDocument();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  });

  it("keeps overlays aligned when a condition branch is not taken", () => {
    const conditionalBranch = JSON.parse(`{
      "if": "$var.use_then == true",
      "then": {
        "activity": { "name": "untaken_then" }
      },
      "else": {
        "activity": { "name": "taken_else" }
      }
    }`) as { if: string; then: DSLStep; else: DSLStep };

    const conditionalDefinition: DSLDefinition = {
      name: "conditional-branch-alignment",
      version: "1.0.0",
      steps: {
        sequence: {
          steps: [
            { activity: { name: "start" } },
            {
              condition: conditionalBranch,
            },
            { activity: { name: "after_condition" } },
          ],
        },
      },
    };

    const steps: WorkflowExecutionStep[] = [
      { step_index: 0, step_name: "start", status: "completed" },
      { step_index: 1, step_name: "taken_else", status: "completed" },
      {
        step_index: 2,
        step_name: "after_condition",
        status: "failed",
        error_message: "Condition branch aligned correctly",
      },
    ];

    const graph = buildWorkflowGraph(conditionalDefinition, steps);
    const statuses = new Map(graph.nodes.map((node) => [node.data.label, node.data.status]));

    expect(statuses.get("start")).toBe("completed");
    expect(statuses.get("untaken_then")).toBe("pending");
    expect(statuses.get("taken_else")).toBe("completed");
    expect(statuses.get("after_condition")).toBe("failed");
    expect(
      graph.nodes.find((node) => node.data.label === "after_condition")?.data.errorMessage
    ).toBe("Condition branch aligned correctly");
  });
});
