import { randomUUID } from "node:crypto";
import { type ServerType, serve } from "@hono/node-server";
import { Connection, WorkflowClient } from "@temporalio/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  config,
  MISSING_SUPABASE_SERVICE_ROLE_KEY,
  UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
} from "./config";
import type { DSLInput } from "./workflows/dsl/interpreter";

interface TriggerRequest {
  definition_name: string;
  input: Record<string, unknown>;
}

interface DefinitionRow {
  name: string;
  version: string;
  definition: Record<string, unknown>;
}

interface WorkflowExecutionRow {
  id: string;
  workflow_id: string;
  run_id: string;
  definition_name: string;
  definition_version: string;
  status: string;
  current_step: string | null;
  started_at: string;
  completed_at: string | null;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowClientLike {
  start(
    workflowType: string,
    options: {
      args: [DSLInput];
      workflowId: string;
      taskQueue: string;
      memo: Record<string, string>;
    }
  ): Promise<{
    workflowId: string;
    firstExecutionRunId: string;
  }>;
}

interface ServerDependencies {
  fetchFn?: typeof fetch;
  workflowClient?: WorkflowClientLike;
  clock?: () => Date;
  randomId?: () => string;
}

let cachedWorkflowClient: WorkflowClient | undefined;

function assertSupabaseConfig(): void {
  if (
    !config.supabaseServiceKey ||
    config.supabaseServiceKey === MISSING_SUPABASE_SERVICE_ROLE_KEY ||
    config.supabaseServiceKey === UNINJECTED_SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required; export local Supabase env before starting the workflow API server"
    );
  }
}

function supabaseHeaders(): Record<string, string> {
  assertSupabaseConfig();
  return {
    "Content-Type": "application/json",
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
  };
}

async function supabaseJson<T>(
  fetchFn: typeof fetch,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetchFn(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      ...supabaseHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase request failed: HTTP ${response.status}: ${text.slice(0, 400)}`);
  }

  return (await response.json()) as T;
}

async function getWorkflowClient(): Promise<WorkflowClient> {
  if (cachedWorkflowClient) {
    return cachedWorkflowClient;
  }

  const connection = await Connection.connect({ address: config.temporalAddress });
  cachedWorkflowClient = new WorkflowClient({
    connection,
    namespace: config.temporalNamespace,
  });
  return cachedWorkflowClient;
}

function buildWorkflowId(definitionName: string, now: Date, suffix: string): string {
  const safeName = definitionName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `dsl-${safeName}-${now.getTime()}-${suffix.slice(0, 8)}`;
}

async function loadActiveDefinition(
  fetchFn: typeof fetch,
  definitionName: string
): Promise<DefinitionRow | null> {
  const params = new URLSearchParams({
    select: "name,version,definition",
    name: `eq.${definitionName}`,
    is_active: "eq.true",
    limit: "1",
  });

  const rows = await supabaseJson<DefinitionRow[]>(
    fetchFn,
    `/rest/v1/workflow_definitions?${params.toString()}`
  );
  return rows[0] ?? null;
}

async function insertWorkflowExecution(
  fetchFn: typeof fetch,
  execution: {
    workflow_id: string;
    run_id: string;
    definition_name: string;
    definition_version: string;
    input_payload: Record<string, unknown>;
  }
): Promise<void> {
  await supabaseJson<WorkflowExecutionRow[]>(fetchFn, "/rest/v1/workflow_executions", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      ...execution,
      status: "running",
    }),
  });
}

function parseTriggerRequest(payload: unknown): TriggerRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Request body must be an object");
  }

  const definitionName = (payload as Record<string, unknown>).definition_name;
  const input = (payload as Record<string, unknown>).input;

  if (!definitionName || typeof definitionName !== "string") {
    throw new Error("definition_name is required and must be a string");
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input is required and must be an object");
  }

  return {
    definition_name: definitionName,
    input: input as Record<string, unknown>,
  };
}

function getStepTrace(row: WorkflowExecutionRow): unknown[] {
  const payload = row.output_payload;
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = (payload as Record<string, unknown>).step_trace;
  return Array.isArray(candidate) ? candidate : [];
}

export function createWorkflowApiApp(dependencies: ServerDependencies = {}): Hono {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const randomId = dependencies.randomId ?? randomUUID;
  const getClient = async (): Promise<WorkflowClientLike> => {
    return dependencies.workflowClient ?? (await getWorkflowClient());
  };

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.post("/workflows/trigger", async (context) => {
    let trigger: TriggerRequest;
    try {
      trigger = parseTriggerRequest(await context.req.json());
    } catch (error) {
      return context.json({ error: (error as Error).message }, 400);
    }

    const definition = await loadActiveDefinition(fetchFn, trigger.definition_name);
    if (!definition) {
      return context.json(
        { error: `No active definition found for ${trigger.definition_name}` },
        404
      );
    }

    const workflowId = buildWorkflowId(definition.name, clock(), randomId());
    const workflowClient = await getClient();
    const handle = await workflowClient.start("DSLWorkflow", {
      args: [
        {
          definition: definition.definition,
          input: trigger.input,
        },
      ],
      workflowId,
      taskQueue: config.temporalTaskQueue,
      memo: {
        definition_name: definition.name,
        definition_version: definition.version,
      },
    });

    await insertWorkflowExecution(fetchFn, {
      workflow_id: workflowId,
      run_id: handle.firstExecutionRunId,
      definition_name: definition.name,
      definition_version: definition.version,
      input_payload: trigger.input,
    });

    return context.json(
      {
        workflow_id: workflowId,
        run_id: handle.firstExecutionRunId,
        definition_name: definition.name,
      },
      201
    );
  });

  app.get("/workflows/executions", async (context) => {
    const definitionName = context.req.query("definition_name");
    const status = context.req.query("status");
    const limitRaw = context.req.query("limit");

    const params = new URLSearchParams({
      select: "*",
      order: "started_at.desc",
    });

    if (definitionName) {
      params.set("definition_name", `eq.${definitionName}`);
    }
    if (status) {
      params.set("status", `eq.${status}`);
    }
    if (limitRaw) {
      const limit = Number.parseInt(limitRaw, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        return context.json({ error: "limit must be a positive integer" }, 400);
      }
      params.set("limit", String(limit));
    }

    const rows = await supabaseJson<WorkflowExecutionRow[]>(
      fetchFn,
      `/rest/v1/workflow_executions?${params.toString()}`
    );

    return context.json(rows);
  });

  app.get("/workflows/executions/:workflow_id", async (context) => {
    const workflowId = context.req.param("workflow_id");
    const params = new URLSearchParams({
      select: "*",
      workflow_id: `eq.${workflowId}`,
      limit: "1",
    });

    const rows = await supabaseJson<WorkflowExecutionRow[]>(
      fetchFn,
      `/rest/v1/workflow_executions?${params.toString()}`
    );
    const row = rows[0];

    if (!row) {
      return context.json({ error: `Execution not found for workflow_id ${workflowId}` }, 404);
    }

    return context.json({
      execution: row,
      step_trace: getStepTrace(row),
    });
  });

  app.get("/health", (context) => {
    return context.json({ ok: true });
  });

  app.onError((error, context) => {
    return context.json({ error: error.message }, 500);
  });

  return app;
}

export function startWorkflowApiServer(): ServerType {
  const app = createWorkflowApiApp();
  const port = Number.parseInt(process.env.HTTP_PORT ?? "3001", 10);
  const server = serve(
    {
      fetch: app.fetch,
      port: Number.isFinite(port) ? port : 3001,
    },
    (info) => {
      process.stdout.write(`Workflow API server started {"port":${info.port}}\n`);
    }
  );
  return server;
}
