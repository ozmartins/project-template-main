describe("execution_tracking", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  // ── record_step ────────────────────────────────────────────────────────────

  describe("record_step", () => {
    it("upserts a running step row", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      await record_step({
        workflow_id: "wf-123",
        step_index: 0,
        step_name: "create_entity",
        status: "running",
        input_preview: { entity_type: "customer" },
      });

      // First call: upsert into workflow_execution_steps
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/rest/v1/workflow_execution_steps"),
        expect.objectContaining({ method: "POST" })
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.workflow_id).toBe("wf-123");
      expect(body.step_index).toBe(0);
      expect(body.step_name).toBe("create_entity");
      expect(body.status).toBe("running");
      expect(body.input_preview).toEqual({ entity_type: "customer" });
      // started_at is stamped by the activity on the running call
      expect(typeof body.started_at).toBe("string");
      expect(body.completed_at).toBeUndefined();
    });

    it("patches workflow_executions.current_step when step starts running", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      await record_step({
        workflow_id: "wf-123",
        step_index: 0,
        step_name: "create_entity",
        status: "running",
      });

      // Second call: PATCH workflow_executions to set current_step
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(patchUrl).toContain("/rest/v1/workflow_executions");
      expect(patchUrl).toContain("wf-123");
      expect(patchInit.method).toBe("PATCH");
      const patchBody = JSON.parse(patchInit.body as string);
      expect(patchBody.current_step).toBe("create_entity");
    });

    it("does not patch workflow_executions.current_step for completed status", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      await record_step({
        workflow_id: "wf-123",
        step_index: 0,
        step_name: "create_entity",
        status: "completed",
      });

      // Only one fetch call (the upsert) — no PATCH to workflow_executions
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/rest/v1/workflow_execution_steps"),
        expect.anything()
      );
    });

    it("upserts a running step row and returns started_at ISO string", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      const result = await record_step({
        workflow_id: "wf-ts",
        step_index: 0,
        step_name: "create_entity",
        status: "running",
      });

      // Return value is the started_at ISO for the interpreter to pass back
      expect(typeof result).toBe("string");
      expect(() => new Date(result as string)).not.toThrow();
    });

    it("upserts a completed step row with duration computed from started_at", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const startedAt = new Date(Date.now() - 150).toISOString();
      const { record_step } = await import("../src/activities/execution_tracking");
      await record_step({
        workflow_id: "wf-123",
        step_index: 0,
        step_name: "create_entity",
        status: "completed",
        output_preview: { entity_id: "abc", success: true },
        started_at: startedAt,
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.status).toBe("completed");
      // duration_ms is computed activity-side from started_at — must be >= 0
      expect(typeof body.duration_ms).toBe("number");
      expect(body.duration_ms).toBeGreaterThanOrEqual(0);
      expect(body.output_preview).toEqual({ entity_id: "abc", success: true });
      // completed_at must be set by the activity for non-running statuses
      expect(typeof body.completed_at).toBe("string");
      // started_at must NOT be in the body for non-running calls
      expect(body.started_at).toBeUndefined();
    });

    it("upserts a failed step row with error_message", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      await record_step({
        workflow_id: "wf-456",
        step_index: 1,
        step_name: "llm_agent",
        status: "failed",
        error_message: "LLM rate limit exceeded",
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.status).toBe("failed");
      expect(body.error_message).toBe("LLM rate limit exceeded");
      expect(typeof body.completed_at).toBe("string");
      // started_at must NOT be in the body for failed calls
      expect(body.started_at).toBeUndefined();
    });

    it("truncates large output_preview to 2 KB", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const largeData = { content: "x".repeat(4000) };
      const { record_step } = await import("../src/activities/execution_tracking");
      await record_step({
        workflow_id: "wf-789",
        step_index: 0,
        step_name: "llm_agent",
        status: "completed",
        output_preview: largeData,
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      const previewJson = JSON.stringify(body.output_preview);
      // Should be truncated (wrapped in { _truncated, preview })
      expect((body.output_preview as Record<string, unknown>)._truncated).toBe(true);
      expect(previewJson.length).toBeLessThan(3000);
    });

    it("skips write and does not throw when Supabase is not configured", async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const fetchMock = jest.fn();
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      await expect(
        record_step({
          workflow_id: "wf-no-config",
          step_index: 0,
          step_name: "some_activity",
          status: "running",
        })
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not throw on HTTP error responses", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Bad request",
      });
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      // Should not throw and running calls still return a started_at string
      const result = await record_step({
        workflow_id: "wf-err",
        step_index: 0,
        step_name: "some_activity",
        status: "running",
      });
      expect(typeof result).toBe("string");
    });

    it("does not throw on network errors", async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      global.fetch = fetchMock as typeof fetch;

      const { record_step } = await import("../src/activities/execution_tracking");
      await expect(
        record_step({
          workflow_id: "wf-net-err",
          step_index: 0,
          step_name: "some_activity",
          status: "completed",
        })
      ).resolves.toBeUndefined();
    });
  });

  // ── complete_execution ─────────────────────────────────────────────────────

  describe("complete_execution", () => {
    it("PATCHes workflow_executions with completed status", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { complete_execution } = await import("../src/activities/execution_tracking");
      await complete_execution({
        workflow_id: "wf-done",
        run_id: "run-abc",
        definition_name: "vertical-classification",
        definition_version: "1.0.0",
        status: "completed",
        output_payload: { result: "finance" },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/rest/v1/workflow_executions?workflow_id=eq.wf-done"),
        expect.objectContaining({ method: "PATCH" })
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.status).toBe("completed");
      expect(body.output_payload).toEqual({ result: "finance" });
      expect(typeof body.completed_at).toBe("string");
    });

    it("PATCHes workflow_executions with failed status and error_message", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "" });
      global.fetch = fetchMock as typeof fetch;

      const { complete_execution } = await import("../src/activities/execution_tracking");
      await complete_execution({
        workflow_id: "wf-failed",
        run_id: "run-xyz",
        definition_name: "vertical-classification",
        definition_version: "1.0.0",
        status: "failed",
        error_message: "step 2 failed: timeout",
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.status).toBe("failed");
      expect(body.error_message).toBe("step 2 failed: timeout");
    });

    it("does not throw when Supabase is not configured", async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const fetchMock = jest.fn();
      global.fetch = fetchMock as typeof fetch;

      const { complete_execution } = await import("../src/activities/execution_tracking");
      await expect(
        complete_execution({
          workflow_id: "wf-no-config",
          run_id: "run-no-config",
          definition_name: "test",
          definition_version: "1.0.0",
          status: "completed",
        })
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not throw on HTTP error responses", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not found",
      });
      global.fetch = fetchMock as typeof fetch;

      const { complete_execution } = await import("../src/activities/execution_tracking");
      await expect(
        complete_execution({
          workflow_id: "wf-missing",
          run_id: "run-missing",
          definition_name: "test",
          definition_version: "1.0.0",
          status: "completed",
        })
      ).resolves.toBeUndefined();
    });
  });
});
