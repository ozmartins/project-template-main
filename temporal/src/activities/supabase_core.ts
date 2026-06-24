import { log } from "@temporalio/activity";

export interface EntityResult {
  entity_id: string;
  version_id: string;
  success: boolean;
  error?: string;
}

export async function create_entity(args: {
  entity_type: string;
  attributes: Record<string, unknown>;
  created_by?: string;
  _idempotency_key?: string;
}): Promise<EntityResult> {
  log.info("[STUB] create_entity", { entity_type: args.entity_type, created_by: args.created_by });
  return { entity_id: "mock-entity-id", version_id: "mock-version-id", success: true };
}

export async function update_entity_scd2(args: {
  entity_id: string;
  attributes: Record<string, unknown>;
  updated_by?: string;
  _idempotency_key?: string;
}): Promise<EntityResult> {
  log.info("[STUB] update_entity_scd2", { entity_id: args.entity_id, updated_by: args.updated_by });
  return { entity_id: args.entity_id, version_id: "mock-version-id", success: true };
}

export async function get_entity(args: {
  entity_id: string;
  _idempotency_key?: string;
}): Promise<Record<string, unknown>> {
  log.info("[STUB] get_entity", { entity_id: args.entity_id });
  return { entity_id: args.entity_id, name: "Mock Entity" };
}

export async function append_event(args: {
  entity_id: string;
  entity_type: string;
  event_type: string;
  event_data: Record<string, unknown>;
  actor_id?: string;
  correlation_id?: string;
  _idempotency_key?: string;
}): Promise<boolean> {
  log.info("[STUB] append_event", {
    entity_id: args.entity_id,
    event_type: args.event_type,
    actor_id: args.actor_id,
  });
  return true;
}

export async function create_relationship(args: {
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
  attributes?: Record<string, unknown>;
  _idempotency_key?: string;
}): Promise<Record<string, unknown>> {
  log.info("[STUB] create_relationship", {
    from: args.from_entity_id,
    to: args.to_entity_id,
    relationship_type: args.relationship_type,
  });
  return { relationship_id: "mock-relationship-id", success: true };
}
