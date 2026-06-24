-- Behavioral guard tests for public.create_entity_with_version(text, jsonb).
--
-- Verifies four layers:
--   1. Grant surface      — anon has no EXECUTE; authenticated does.
--   2. Anon denial        — calling as anon raises insufficient_privilege.
--   3. Role denial        — authenticated callers with read_only or reviewer
--                           app_metadata.role are denied by the RPC guard.
--   4. Writer correctness — admin and editor app_metadata roles can create
--                           entities; resulting rows are structurally valid
--                           (version_number=1, is_current=true, SCD2 upheld).
--
-- The app_metadata.role field is set via set_config('request.jwt.claims', ...)
--    The app_metadata.role field is set via set_config('request.jwt.claims', ...)
--    to simulate the PostgREST JWT-claims injection (ADR-0023 / ADR-0034).
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rpc_create_entity_with_version.sql

begin;

do $$
declare
  v_rejected  boolean;
  v_result    jsonb;
  v_entity_id uuid;
  v_count     int;
begin

  -- =========================================================================
  -- 1. Grant surface: anon must NOT have USAGE on the public schema.
  --    The auth-lockdown migration denies anon via schema-level USAGE revocation
  --    (not by stripping the function EXECUTE bit, which is inherited via the
  --    PUBLIC pseudo-role and therefore always reports true for all roles).
  --    Checking schema USAGE is the correct proxy for "can anon reach the RPC".
  -- =========================================================================

  if has_schema_privilege('anon', 'public', 'USAGE') then
    raise exception 'FAIL: anon must NOT have USAGE on the public schema (auth-lockdown violation)';
  end if;
  raise notice 'PASS: anon has no public schema USAGE (cannot resolve or call any public function)';

  -- =========================================================================
  -- 2. Grant surface: authenticated MUST have EXECUTE on the function
  -- =========================================================================

  if not has_function_privilege('authenticated', 'public.create_entity_with_version(text, jsonb)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE on create_entity_with_version';
  end if;
  raise notice 'PASS: authenticated has EXECUTE grant on create_entity_with_version';

  -- =========================================================================
  -- 3. Runtime denial: calling as anon raises insufficient_privilege
  --    SET LOCAL ROLE inside the inner block so it is rolled back with the
  --    subtransaction when the exception is caught.
  -- =========================================================================

  v_rejected := false;
  begin
    set local role anon;
    perform public.create_entity_with_version(
      'test_type',
      '{"name": "anon-attempt"}'::jsonb
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: anon must be denied EXECUTE on create_entity_with_version at runtime';
  end if;
  raise notice 'PASS: anon execution denied at runtime (insufficient_privilege raised)';

  -- =========================================================================
  -- 4. Role-based denial: read_only authenticated caller must be rejected
  --    Simulate PostgREST JWT injection via set_config.
  -- =========================================================================

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "app_metadata": {"role": "read_only"}}',
      true
    );
    set local role authenticated;
    perform public.create_entity_with_version(
      'test_type',
      '{"name": "read-only-attempt"}'::jsonb
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: read_only role must be denied by create_entity_with_version RPC guard';
  end if;
  raise notice 'PASS: read_only app role denied at runtime (insufficient_privilege raised)';

  -- =========================================================================
  -- 5. Role-based denial: reviewer authenticated caller must be rejected
  -- =========================================================================

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "app_metadata": {"role": "reviewer"}}',
      true
    );
    set local role authenticated;
    perform public.create_entity_with_version(
      'test_type',
      '{"name": "reviewer-attempt"}'::jsonb
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: reviewer role must be denied by create_entity_with_version RPC guard';
  end if;
  raise notice 'PASS: reviewer app role denied at runtime (insufficient_privilege raised)';

  -- =========================================================================
  -- 6. Correctness: admin app role succeeds and creates entity + version rows
  -- =========================================================================

  perform set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "app_metadata": {"role": "admin"}}',
    true
  );
  set local role authenticated;
  v_result := public.create_entity_with_version(
    'portfolio',
    '{"name": "Guard Test Portfolio (admin)", "description": "Created by rpc_create_entity_with_version.sql"}'::jsonb
  );
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);

  v_entity_id := (v_result->>'entity_id')::uuid;
  if v_entity_id is null then
    raise exception 'FAIL: admin call: returned entity_id must not be null';
  end if;
  if (v_result->>'version_id')::uuid is null then
    raise exception 'FAIL: admin call: returned version_id must not be null';
  end if;
  raise notice 'PASS: admin call: returned entity_id and version_id are valid non-null UUIDs';

  select count(*) into v_count
  from public.entities
  where id = v_entity_id and entity_type = 'portfolio';
  if v_count <> 1 then
    raise exception 'FAIL: admin call: expected 1 entity row with entity_type=portfolio, got %', v_count;
  end if;
  raise notice 'PASS: admin call: entity row created with correct entity_type';

  select count(*) into v_count
  from public.entity_versions
  where entity_id      = v_entity_id
    and version_number = 1
    and is_current     = true
    and data->>'name'  = 'Guard Test Portfolio (admin)';
  if v_count <> 1 then
    raise exception
      'FAIL: admin call: expected entity_versions row with version_number=1, is_current=true for entity %',
      v_entity_id;
  end if;
  raise notice 'PASS: admin call: entity_versions row has version_number=1, is_current=true, data correct';

  select count(*) into v_count
  from public.entity_versions
  where entity_id = v_entity_id and is_current = true;
  if v_count <> 1 then
    raise exception
      'FAIL: admin call: expected exactly 1 current version (SCD2), got % for entity %',
      v_count, v_entity_id;
  end if;
  raise notice 'PASS: admin call: exactly one current version exists (SCD2 partial unique index upheld)';

  -- =========================================================================
  -- 7. Correctness: editor app role also succeeds
  -- =========================================================================

  perform set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "app_metadata": {"role": "editor"}}',
    true
  );
  set local role authenticated;
  v_result := public.create_entity_with_version(
    'portfolio',
    '{"name": "Guard Test Portfolio (editor)"}'::jsonb
  );
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);

  v_entity_id := (v_result->>'entity_id')::uuid;
  if v_entity_id is null then
    raise exception 'FAIL: editor call: returned entity_id must not be null';
  end if;

  select count(*) into v_count
  from public.entity_versions
  where entity_id      = v_entity_id
    and version_number = 1
    and is_current     = true
    and data->>'name'  = 'Guard Test Portfolio (editor)';
  if v_count <> 1 then
    raise exception
      'FAIL: editor call: expected entity_versions row with version_number=1, is_current=true for entity %',
      v_entity_id;
  end if;
  raise notice 'PASS: editor call: entity row and version created correctly';

  raise notice '=== All create_entity_with_version RPC guard tests passed ===';

end;
$$;

rollback;
