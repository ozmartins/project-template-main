const mockStart = jest.fn();
const mockConnect = jest.fn();
const mockClose = jest.fn();

class MockWorkflowExecutionAlreadyStartedError extends Error {}

jest.mock("@temporalio/client", () => ({
  Client: jest.fn().mockImplementation(() => ({
    workflow: {
      start: mockStart,
    },
  })),
  WorkflowExecutionAlreadyStartedError: MockWorkflowExecutionAlreadyStartedError,
}));

jest.mock("@temporalio/worker", () => ({
  NativeConnection: {
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}));

import { resolveRunAt, schedule_trigger } from "../src/activities/schedule_trigger";

describe("resolveRunAt", () => {
  it("parses relative duration strings", () => {
    const resolved = resolveRunAt("2s", Date.parse("2026-01-01T00:00:00.000Z"));
    expect(resolved.startDelayMs).toBe(2000);
    expect(resolved.runAtIso).toBe("2026-01-01T00:00:02.000Z");
  });

  it("parses absolute timestamps", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const resolved = resolveRunAt("2026-01-01T00:00:05.250Z", now);
    expect(resolved.startDelayMs).toBe(5250);
    expect(resolved.runAtIso).toBe("2026-01-01T00:00:05.250Z");
  });
});

describe("schedule_trigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClose.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue({
      close: mockClose,
    });
    mockStart.mockResolvedValue({ workflowId: "ignored" });
  });

  it("schedules DSLWorkflow with deterministic workflow id", async () => {
    process.env.TEMPORAL_ADDRESS = "127.0.0.1:7233";
    process.env.TEMPORAL_NAMESPACE = "default";
    process.env.TEMPORAL_TASK_QUEUE = "main";

    const result = await schedule_trigger({
      workflow_id: "reminder",
      workflow_input: { definition: { name: "noop", version: "1.0.0", steps: {} }, input: {} },
      run_at: "1s",
      _idempotency_key: "abc-123",
    });

    expect(mockConnect).toHaveBeenCalledWith({ address: "127.0.0.1:7233" });
    expect(mockStart).toHaveBeenCalledWith(
      "DSLWorkflow",
      expect.objectContaining({
        taskQueue: "main",
        workflowId: "reminder:schedule_trigger:abc-123",
        args: [{ definition: { name: "noop", version: "1.0.0", steps: {} }, input: {} }],
      })
    );
    expect(result.scheduled_workflow_id).toBe("reminder:schedule_trigger:abc-123");
    expect(typeof result.run_at).toBe("string");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("returns success when duplicate schedule submission occurs", async () => {
    mockStart.mockRejectedValue(new MockWorkflowExecutionAlreadyStartedError("already exists"));

    const result = await schedule_trigger({
      workflow_id: "reminder",
      workflow_input: { definition: { name: "noop", version: "1.0.0", steps: {} }, input: {} },
      run_at: "3s",
      _idempotency_key: "stable-key",
    });

    expect(result).toEqual({
      scheduled_workflow_id: "reminder:schedule_trigger:stable-key",
      run_at: expect.any(String),
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("throws when _idempotency_key is missing", async () => {
    await expect(
      schedule_trigger({
        workflow_id: "reminder",
        workflow_input: { definition: { name: "noop", version: "1.0.0", steps: {} }, input: {} },
        run_at: "1s",
      } as unknown as Parameters<typeof schedule_trigger>[0])
    ).rejects.toThrow("schedule_trigger: _idempotency_key is required");

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("throws when _idempotency_key is blank", async () => {
    await expect(
      schedule_trigger({
        workflow_id: "reminder",
        workflow_input: { definition: { name: "noop", version: "1.0.0", steps: {} }, input: {} },
        run_at: "1s",
        _idempotency_key: "   ",
      })
    ).rejects.toThrow("schedule_trigger: _idempotency_key is required");

    expect(mockConnect).not.toHaveBeenCalled();
  });
});
