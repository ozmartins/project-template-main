import smokeClassificationDefinition from "./definitions/smoke-classification.json";
import smokePipelineDefinition from "./definitions/smoke-pipeline.json";

export interface WorkflowDefinition {
  name: string;
  version: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export const workflowDefinitions = [
  smokeClassificationDefinition,
  smokePipelineDefinition,
] as WorkflowDefinition[];
