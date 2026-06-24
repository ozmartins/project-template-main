import verticalClassificationDefinition from "@/data/definitions/vertical-classification.json";
import type { DSLDefinition } from "@/types/workflows";
import smokeClassificationDefinition from "@/workflows/definitions/smoke-classification.json";

const workflowDefinitions: Record<string, DSLDefinition> = {
  "smoke-classification": smokeClassificationDefinition as DSLDefinition,
  "vertical-classification": verticalClassificationDefinition as DSLDefinition,
};

export function getWorkflowDefinition(name: string): DSLDefinition | undefined {
  return workflowDefinitions[name];
}

export function listWorkflowDefinitions(): string[] {
  return Object.keys(workflowDefinitions);
}
