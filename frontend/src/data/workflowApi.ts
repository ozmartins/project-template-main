export const DEFAULT_WORKFLOW_API_URL = "http://localhost:3001";

export const workflowApiBaseUrl = (
  import.meta.env.VITE_WORKFLOW_API_URL ?? DEFAULT_WORKFLOW_API_URL
).replace(/\/$/, "");
