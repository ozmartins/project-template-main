import { log } from "@temporalio/activity";
import {
  config,
  MISSING_SUPABASE_SERVICE_ROLE_KEY,
  UNINJECTED_SUPABASE_SERVICE_ROLE_KEY,
} from "../config";

export interface SupabaseQueryArgs {
  query: string;
  params?: unknown[];
  mode?: "sql" | "rpc";
  result_shape?: "list" | "one" | "count";
  _idempotency_key?: string;
}

export interface EntityMutateArgs {
  operation: "insert" | "update" | "upsert";
  entity_type: string;
  data: Record<string, unknown>;
  entity_id?: string;
  source_record_id?: string;
  created_by?: string;
  updated_by?: string;
  _idempotency_key?: string;
}

export interface TableMutateArgs {
  operation: "insert" | "update" | "upsert";
  table: string;
  values: Record<string, unknown>;
  match?: Record<string, unknown>;
  _idempotency_key?: string;
}

export type SupabaseMutateArgs = EntityMutateArgs | TableMutateArgs;

function safeLogInfo(message: string, attributes: Record<string, unknown>): void {
  try {
    log.info(message, attributes);
  } catch {
    // Unit tests call these helpers outside a Temporal activity context.
  }
}

export async function supabase_query(args: SupabaseQueryArgs): Promise<unknown> {
  safeLogInfo("[STUB] supabase_query", { query: args.query.slice(0, 80) });
  // Real implementation would use pg driver directly or Supabase RPC.
  // Returning a stub list for now — replace with actual pg call.
  return args.result_shape === "one" ? null : args.result_shape === "count" ? 0 : [];
}

function isTableMutateArgs(args: SupabaseMutateArgs): args is TableMutateArgs {
  return "table" in args && "values" in args;
}

function assertSupabaseConfig(): void {
  if (!config.supabaseUrl) {
    throw new Error("supabase_mutate: SUPABASE_URL is required");
  }
  if (
    !config.supabaseServiceKey ||
    config.supabaseServiceKey === MISSING_SUPABASE_SERVICE_ROLE_KEY ||
    config.supabaseServiceKey === UNINJECTED_SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "supabase_mutate: SUPABASE_SERVICE_ROLE_KEY is required; export it from your local Supabase instance before running this workflow"
    );
  }
}

function buildMatchParams(match: Record<string, unknown> = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(match)) {
    if (value === null) {
      params.set(key, "is.null");
      continue;
    }
    params.set(key, `eq.${String(value)}`);
  }
  return params;
}

function buildSupabaseHeaders(prefer: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
    Prefer: prefer,
  };
}

async function parseRows(
  response: Response,
  context: string
): Promise<Array<Record<string, unknown>>> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${context}: HTTP ${response.status}: ${text.slice(0, 400)}`);
  }

  const rows = (await response.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) {
    throw new Error(`${context}: expected PostgREST array response`);
  }
  return rows;
}

async function fetchRows(
  table: string,
  params: URLSearchParams,
  context: string
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
    headers: buildSupabaseHeaders("return=representation"),
  });
  return parseRows(response, context);
}

async function insertRow(
  table: string,
  values: Record<string, unknown>,
  context: string
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: buildSupabaseHeaders("return=representation"),
    body: JSON.stringify(values),
  });
  const rows = await parseRows(response, context);
  if (rows.length === 0) {
    throw new Error(`${context}: insert returned no rows`);
  }
  return rows[0];
}

function normalizeSourceRecordId(args: EntityMutateArgs): string | undefined {
  if (typeof args.source_record_id === "string" && args.source_record_id.trim().length > 0) {
    return args.source_record_id.trim();
  }
  if (args.operation === "upsert" && args._idempotency_key) {
    return args._idempotency_key;
  }
  return undefined;
}

async function findEntity(args: EntityMutateArgs): Promise<Record<string, unknown> | null> {
  if (args.entity_id) {
    const params = new URLSearchParams({
      select: "id,entity_type,source_record_id",
      id: `eq.${args.entity_id}`,
      limit: "1",
    });
    const rows = await fetchRows("entities", params, "supabase_mutate: lookup entity by id");
    return rows[0] ?? null;
  }

  const sourceRecordId = normalizeSourceRecordId(args);
  if (!sourceRecordId) return null;

  const params = new URLSearchParams({
    select: "id,entity_type,source_record_id",
    entity_type: `eq.${args.entity_type}`,
    source_record_id: `eq.${sourceRecordId}`,
    limit: "1",
  });
  const rows = await fetchRows(
    "entities",
    params,
    `supabase_mutate: lookup entity by source_record_id for "${args.entity_type}"`
  );
  return rows[0] ?? null;
}

async function createEntity(args: EntityMutateArgs): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    entity_type: args.entity_type,
  };
  const sourceRecordId = normalizeSourceRecordId(args);
  if (sourceRecordId) values.source_record_id = sourceRecordId;
  return insertRow("entities", values, `supabase_mutate: create entity "${args.entity_type}"`);
}

async function resolveEntityForMutation(args: EntityMutateArgs): Promise<Record<string, unknown>> {
  const existingEntity = await findEntity(args);
  if (existingEntity) return existingEntity;

  if (args.operation === "update") {
    throw new Error(
      `supabase_mutate: update on entity_type "${args.entity_type}" requires an existing entity_id or source_record_id`
    );
  }

  try {
    return await createEntity(args);
  } catch (error) {
    if (
      args.operation === "upsert" &&
      error instanceof Error &&
      error.message.includes("HTTP 409")
    ) {
      const entity = await findEntity(args);
      if (entity) return entity;
    }
    throw error;
  }
}

async function fetchLatestEntityVersionNumber(entityId: string): Promise<number> {
  const params = new URLSearchParams({
    select: "version_number",
    entity_id: `eq.${entityId}`,
    order: "version_number.desc",
    limit: "1",
  });
  const rows = await fetchRows(
    "entity_versions",
    params,
    `supabase_mutate: fetch latest version for entity "${entityId}"`
  );
  const versionNumber = rows[0]?.version_number;
  return typeof versionNumber === "number" ? versionNumber : 0;
}

async function mutateEntity(args: EntityMutateArgs): Promise<Record<string, unknown>> {
  const entity = await resolveEntityForMutation(args);
  const entityId = entity.id;
  if (typeof entityId !== "string" || entityId.length === 0) {
    throw new Error(
      `supabase_mutate: entity mutation for "${args.entity_type}" returned no entity id`
    );
  }

  const latestVersionNumber = await fetchLatestEntityVersionNumber(entityId);
  const nextVersionNumber = latestVersionNumber + 1;

  safeLogInfo("supabase_mutate", {
    operation: args.operation,
    entity_type: args.entity_type,
    entity_id: entityId,
    source_record_id: entity.source_record_id ?? normalizeSourceRecordId(args) ?? null,
    version_number: nextVersionNumber,
  });

  const version = await insertRow(
    "entity_versions",
    {
      entity_id: entityId,
      version_number: nextVersionNumber,
      data: args.data,
    },
    `supabase_mutate: create entity version for "${args.entity_type}"`
  );

  return {
    entity_id: entityId,
    version_id: version.id,
    version_number: version.version_number,
    success: true,
  };
}

export async function supabase_mutate(args: SupabaseMutateArgs): Promise<Record<string, unknown>> {
  assertSupabaseConfig();

  if (!isTableMutateArgs(args)) {
    return mutateEntity(args);
  }

  const match = args.match ?? {};
  const headers = buildSupabaseHeaders(
    args.operation === "upsert"
      ? "resolution=merge-duplicates,return=representation"
      : "return=representation"
  );

  let method: "POST" | "PATCH";
  let url = `${config.supabaseUrl}/rest/v1/${args.table}`;
  let body: Record<string, unknown>;

  if (args.operation === "update") {
    if (!Object.keys(match).length) {
      throw new Error(
        `supabase_mutate: update on "${args.table}" requires a non-empty match filter`
      );
    }
    method = "PATCH";
    const params = buildMatchParams(match);
    url += `?${params.toString()}`;
    body = args.values;
  } else {
    method = "POST";
    body = { ...match, ...args.values };

    if (args.operation === "upsert") {
      if (!Object.keys(match).length) {
        throw new Error(
          `supabase_mutate: upsert on "${args.table}" requires at least one match key`
        );
      }
      const params = new URLSearchParams({
        on_conflict: Object.keys(match).join(","),
      });
      url += `?${params.toString()}`;
    }
  }

  safeLogInfo("supabase_mutate", {
    operation: args.operation,
    table: args.table,
    match_keys: Object.keys(match),
    value_keys: Object.keys(args.values),
  });

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  const rows = await parseRows(response, "supabase_mutate");
  if (rows.length === 0) {
    throw new Error(`supabase_mutate: "${args.table}" ${args.operation} returned no rows`);
  }

  return rows[0];
}
