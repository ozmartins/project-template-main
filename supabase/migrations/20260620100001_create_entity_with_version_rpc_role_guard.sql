-- Adds a server-side writer-role guard to public.create_entity_with_version.
--
-- Implements ADR-0023 requirement: SECURITY DEFINER functions MUST validate
-- the caller's identity at the top of the function body; the frontend
-- capability check (canWrite) is not sufficient.
--
-- Allowed callers (ADR-0034 role model):
--   admin   — canWrite + canAdminister
--   editor  — canWrite
-- Denied callers (raise insufficient_privilege):
--   reviewer, read_only — cannot write entities
--   anon — no EXECUTE grant (already blocked before the function runs)
--
-- Service-role and direct Postgres connections carry no JWT claims; those
-- trusted paths pass through the guard unchanged (Temporal workers, Edge
-- Functions, migration tooling).

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
  v_claims_text text := current_setting('request.jwt.claims', true);
  v_claims      json;
  v_jwt_role    text;
  v_app_role    text;
  v_entity_id   uuid;
  v_version_id  uuid;
begin
  -- Safe JSON parse: absent or malformed claims are treated as no-claims
  -- (service_role / direct Postgres paths), which bypasses the PostgREST
  -- role check below. PostgREST always injects valid JSON before calling,
  -- so this branch is only reached in direct-SQL / test contexts.
  begin
    v_claims := nullif(v_claims_text, '')::json;
  exception when others then
    v_claims := null;
  end;

  v_jwt_role := coalesce(v_claims ->> 'role', '');
  v_app_role := coalesce(v_claims -> 'app_metadata' ->> 'role', '');

  -- -------------------------------------------------------------------------
  -- Authorization guard (ADR-0023 / ADR-0034)
  -- Apply only for authenticated PostgREST sessions (JWT present with
  -- role = 'authenticated').  Direct Postgres connections (service_role,
  -- Temporal workers, superuser) have no JWT claims and bypass this check —
  -- they carry their own trust at the database layer.
  -- -------------------------------------------------------------------------
  if v_jwt_role = 'authenticated' then
    if v_app_role not in ('admin', 'editor') then
      raise insufficient_privilege
        using message =
          'create_entity_with_version: app role ''' || coalesce(v_app_role, '') ||
          ''' is not authorized to create entities; requires admin or editor';
    end if;
  end if;

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

-- EXECUTE grant is already applied to authenticated by the auth-lockdown
-- migration's ALTER DEFAULT PRIVILEGES, but keep the explicit grant here so
-- the function is self-documenting.
grant execute on function public.create_entity_with_version(text, jsonb) to authenticated;
