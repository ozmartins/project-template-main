import { createClient } from "npm:@supabase/supabase-js@2.58.0";

interface TriggerWorkflowRequest {
  definition_name: string;
  input: Record<string, unknown>;
}

interface TriggerWorkflowResponse {
  workflow_id: string;
  run_id: string;
}

const TRIGGERABLE_DEFINITIONS = new Set<string>(["smoke-classification"]);

export function isTriggerableDefinition(definitionName: string): boolean {
  return TRIGGERABLE_DEFINITIONS.has(definitionName);
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function handleTriggerWorkflowRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, {});
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "Missing bearer token" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    const missingVariables = ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((name) =>
      !Deno.env.get(name)
    );
    return jsonResponse(500, {
      error: `Supabase auth configuration is missing: ${missingVariables.join(", ")}`,
    });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse(401, { error: "Invalid auth token" });
  }

  let payload: TriggerWorkflowRequest;
  try {
    payload = (await request.json()) as TriggerWorkflowRequest;
  } catch {
    return jsonResponse(400, { error: "Body must be valid JSON" });
  }

  if (
    !payload.definition_name ||
    typeof payload.definition_name !== "string" ||
    !payload.definition_name.trim()
  ) {
    return jsonResponse(400, { error: "definition_name must be a non-empty string" });
  }

  if (!payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) {
    return jsonResponse(400, { error: "input must be a JSON object" });
  }

  if (!isTriggerableDefinition(payload.definition_name)) {
    return jsonResponse(403, { error: "definition_name is not allowed for triggering" });
  }

  const temporalTriggerUrl = Deno.env.get("TEMPORAL_TRIGGER_URL");
  if (!temporalTriggerUrl) {
    return jsonResponse(503, {
      error: "Workflow trigger service is unavailable: TEMPORAL_TRIGGER_URL is not configured.",
    });
  }

  const temporalResponse = await fetch(temporalTriggerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const temporalPayload = (await temporalResponse.json()) as Partial<TriggerWorkflowResponse> & {
    error?: string;
  };

  if (!temporalResponse.ok || !temporalPayload.workflow_id || !temporalPayload.run_id) {
    return jsonResponse(502, {
      error: temporalPayload.error ?? "Temporal trigger endpoint returned an invalid response.",
    });
  }

  return jsonResponse(200, {
    workflow_id: temporalPayload.workflow_id,
    run_id: temporalPayload.run_id,
  });
}

if (import.meta.main) {
  Deno.serve(handleTriggerWorkflowRequest);
}
