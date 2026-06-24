-- RPC helper: create an entity + its first version in one call
-- Called by the JSON UI Engine when a user creates a new entity from the list page.

create or replace function public.create_entity_with_version(
  p_entity_type text,
  p_data        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id  uuid;
  v_version_id uuid;
begin
  -- 1. Insert the identity row
  insert into public.entities (entity_type)
  values (p_entity_type)
  returning id into v_entity_id;

  -- 2. Insert version 1 (trigger set_entity_version_validity handles SCD2 housekeeping)
  insert into public.entity_versions (entity_id, version_number, data, is_current)
  values (v_entity_id, 1, p_data, true)
  returning id into v_version_id;

  return jsonb_build_object(
    'entity_id',  v_entity_id,
    'version_id', v_version_id
  );
end;
$$;

-- Grant execute to authenticated users (matches existing RLS posture)
grant execute on function public.create_entity_with_version(text, jsonb) to authenticated;
