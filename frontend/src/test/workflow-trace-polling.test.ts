import { describe, expect, it } from "vitest";
import { getWorkflowTraceRefetchInterval } from "@/routes/workflows/$workflowId";

describe("getWorkflowTraceRefetchInterval", () => {
  it("keeps polling only while execution is running", () => {
    expect(getWorkflowTraceRefetchInterval(undefined)).toBe(2000);
    expect(getWorkflowTraceRefetchInterval("RUNNING")).toBe(2000);
    expect(getWorkflowTraceRefetchInterval("running")).toBe(2000);
    expect(getWorkflowTraceRefetchInterval("COMPLETED")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("completed")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("FAILED")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("failed")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("CANCELLED")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("cancelled")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("CANCELED")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("canceled")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("TIMED_OUT")).toBe(false);
    expect(getWorkflowTraceRefetchInterval("timed_out")).toBe(false);
  });
});
