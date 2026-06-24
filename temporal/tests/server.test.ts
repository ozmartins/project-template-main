import { createWorkflowApiApp } from "../src/server";

describe("workflow API server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      TEMPORAL_TASK_QUEUE: "main",
      FRONTEND_ORIGIN: "http://localhost:3000",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  it("POST /workflows/trigger starts workflow and persists execution", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            name: "vertical-classification",
            version: "1.0.0",
            definition: {
              name: "vertical-classification",
              version: "1.0.0",
              steps: { sequence: { steps: [] } },
            },
          },
        ])
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "execution-id" }], 201));

    const startMock = jest.fn().mockResolvedValue({
      workflowId: "dsl-vertical-classification-1",
      firstExecutionRunId: "run-123",
    });

    const app = createWorkflowApiApp({
      fetchFn: fetchMock as typeof fetch,
      workflowClient: {
        start: startMock,
      },
      clock: () => new Date("2026-06-21T00:00:00.000Z"),
      randomId: () => "abcdef12",
    });

    const response = await app.request("/workflows/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        definition_name: "vertical-classification",
        input: {
          company_name: "Stripe Inc",
          domain: "stripe.com",
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      workflow_id: "dsl-vertical-classification-1782000000000-abcdef12",
      run_id: "run-123",
      definition_name: "vertical-classification",
    });

    expect(startMock).toHaveBeenCalledWith(
      "DSLWorkflow",
      expect.objectContaining({
        workflowId: "dsl-vertical-classification-1782000000000-abcdef12",
        taskQueue: "main",
      })
    );

    const insertCall = fetchMock.mock.calls[1];
    expect(String(insertCall[0])).toContain("/rest/v1/workflow_executions");
    expect(insertCall[1]?.method).toBe("POST");
    expect(JSON.parse(String(insertCall[1]?.body))).toEqual(
      expect.objectContaining({
        workflow_id: "dsl-vertical-classification-1782000000000-abcdef12",
        run_id: "run-123",
        definition_name: "vertical-classification",
        definition_version: "1.0.0",
        status: "running",
      })
    );
  });

  it("GET /workflows/executions returns filtered rows", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse([
        {
          workflow_id: "wf-1",
          status: "running",
        },
      ])
    );

    const app = createWorkflowApiApp({ fetchFn: fetchMock as typeof fetch });

    const response = await app.request(
      "/workflows/executions?definition_name=vertical-classification&status=running&limit=20"
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        workflow_id: "wf-1",
        status: "running",
      },
    ]);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/rest/v1/workflow_executions?");
    expect(url).toContain("definition_name=eq.vertical-classification");
    expect(url).toContain("status=eq.running");
    expect(url).toContain("limit=20");
    expect(url).toContain("order=started_at.desc");
  });

  it("GET /workflows/executions/:workflow_id returns detail with step trace", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse([
        {
          id: "row-1",
          workflow_id: "wf-1",
          run_id: "run-1",
          definition_name: "vertical-classification",
          definition_version: "1.0.0",
          status: "running",
          current_step: "classify",
          started_at: "2026-06-21T00:00:00.000Z",
          completed_at: null,
          input_payload: { company_name: "Stripe Inc" },
          output_payload: { step_trace: [{ step: "classify", status: "done" }] },
          error_message: null,
          created_at: "2026-06-21T00:00:00.000Z",
          updated_at: "2026-06-21T00:00:00.000Z",
        },
      ])
    );

    const app = createWorkflowApiApp({ fetchFn: fetchMock as typeof fetch });

    const response = await app.request("/workflows/executions/wf-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ workflow_id: "wf-1" }),
        step_trace: [{ step: "classify", status: "done" }],
      })
    );
  });

  it("OPTIONS preflight allows the configured frontend origin", async () => {
    const app = createWorkflowApiApp();

    const response = await app.request("/workflows/executions", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
