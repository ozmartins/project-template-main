-- Auth & RBAC contract tests.
--
-- Verifies three layers (ADR-0034):
--   1. Database grants  — anon has NO access; authenticated has full CRUD.
--   2. require_aal2()   — aal1 tokens are rejected; aal2 and service_role pass.
--   3. Default privs    — future tables inherit the posture automatically.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/auth_rbac.sql

begin;

do $$
declare
  v_rejected boolean;
  v_passed   boolean;
begin

  -- =========================================================================
  -- Layer 1: Database role grants
  -- =========================================================================

  -- anon must have NO access to any public table
  if has_table_privilege('anon', 'public.entities', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from entities';
  end if;
  raise notice 'PASS: anon cannot SELECT from entities';

  if has_table_privilege('anon', 'public.entities', 'INSERT') then
    raise exception 'FAIL: anon cannot INSERT into entities';
  end if;
  raise notice 'PASS: anon cannot INSERT into entities';

  if has_table_privilege('anon', 'public.entities', 'UPDATE') then
    raise exception 'FAIL: anon cannot UPDATE entities';
  end if;
  raise notice 'PASS: anon cannot UPDATE entities';

  if has_table_privilege('anon', 'public.entities', 'DELETE') then
    raise exception 'FAIL: anon cannot DELETE from entities';
  end if;
  raise notice 'PASS: anon cannot DELETE from entities';

  if has_table_privilege('anon', 'public.entity_versions', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from entity_versions';
  end if;
  raise notice 'PASS: anon cannot SELECT from entity_versions';

  if has_table_privilege('anon', 'public.relationships_v2', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from relationships_v2';
  end if;
  raise notice 'PASS: anon cannot SELECT from relationships_v2';

  if has_table_privilege('anon', 'public.fact_types', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from fact_types';
  end if;
  raise notice 'PASS: anon cannot SELECT from fact_types';

  if has_table_privilege('anon', 'public.entity_facts', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from entity_facts';
  end if;
  raise notice 'PASS: anon cannot SELECT from entity_facts';

  if has_table_privilege('anon', 'public.time_series_points', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from time_series_points';
  end if;
  raise notice 'PASS: anon cannot SELECT from time_series_points';

  if has_schema_privilege('anon', 'public', 'USAGE') then
    raise exception 'FAIL: anon cannot USAGE schema public';
  end if;
  raise notice 'PASS: anon cannot USAGE schema public';

  -- authenticated must have full CRUD on all public tables
  if not has_table_privilege('authenticated', 'public.entities', 'SELECT') then
    raise exception 'FAIL: authenticated can SELECT from entities';
  end if;
  raise notice 'PASS: authenticated can SELECT from entities';

  if not has_table_privilege('authenticated', 'public.entities', 'INSERT') then
    raise exception 'FAIL: authenticated can INSERT into entities';
  end if;
  raise notice 'PASS: authenticated can INSERT into entities';

  if not has_table_privilege('authenticated', 'public.entities', 'UPDATE') then
    raise exception 'FAIL: authenticated can UPDATE entities';
  end if;
  raise notice 'PASS: authenticated can UPDATE entities';

  if not has_table_privilege('authenticated', 'public.entities', 'DELETE') then
    raise exception 'FAIL: authenticated can DELETE from entities';
  end if;
  raise notice 'PASS: authenticated can DELETE from entities';

  if not has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'FAIL: authenticated can USAGE schema public';
  end if;
  raise notice 'PASS: authenticated can USAGE schema public';

  if not has_function_privilege('authenticated', 'public.require_aal2()', 'EXECUTE') then
    raise exception 'FAIL: authenticated can EXECUTE require_aal2';
  end if;
  raise notice 'PASS: authenticated can EXECUTE require_aal2';

  -- =========================================================================
  -- Layer 2: require_aal2() pre-request hook
  -- =========================================================================

  -- Hook is registered on the authenticator role
  if not exists (
    select 1 from pg_roles
    where rolname = 'authenticator'
      and 'pgrst.db_pre_request=public.require_aal2' = any(rolconfig)
  ) then
    raise exception 'FAIL: require_aal2 not registered as pgrst.db_pre_request on authenticator';
  end if;
  raise notice 'PASS: require_aal2 registered as pgrst.db_pre_request on authenticator';

  -- Function exists
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'require_aal2'
  ) then
    raise exception 'FAIL: require_aal2 function exists in public schema';
  end if;
  raise notice 'PASS: require_aal2 function exists in public schema';

  -- anon can execute require_aal2 (it must be callable as the pre-request hook
  -- runs before PostgREST switches roles)
  if not has_function_privilege('anon', 'public.require_aal2()', 'EXECUTE') then
    raise exception 'FAIL: anon can EXECUTE require_aal2 (required for pre-request hook)';
  end if;
  raise notice 'PASS: anon can EXECUTE require_aal2 (required for pre-request hook)';

  -- aal1 authenticated session → rejected
  v_rejected := false;
  perform set_config('request.jwt.claims',
    '{"role":"authenticated","aal":"aal1"}', true);
  begin
    perform public.require_aal2();
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: require_aal2 must reject authenticated aal1 session';
  end if;
  raise notice 'PASS: require_aal2 rejects authenticated aal1 session';

  -- aal2 authenticated session → passes
  v_passed := true;
  perform set_config('request.jwt.claims',
    '{"role":"authenticated","aal":"aal2"}', true);
  begin
    perform public.require_aal2();
  exception
    when insufficient_privilege then
      v_passed := false;
  end;
  if not v_passed then
    raise exception 'FAIL: require_aal2 must allow authenticated aal2 session';
  end if;
  raise notice 'PASS: require_aal2 allows authenticated aal2 session';

  -- service_role session → passes (no MFA check)
  v_passed := true;
  perform set_config('request.jwt.claims',
    '{"role":"service_role"}', true);
  begin
    perform public.require_aal2();
  exception
    when insufficient_privilege then
      v_passed := false;
  end;
  if not v_passed then
    raise exception 'FAIL: require_aal2 must allow service_role (no MFA check)';
  end if;
  raise notice 'PASS: require_aal2 allows service_role session';

  -- anon session → passes (grant layer handles denial, not the MFA hook)
  v_passed := true;
  perform set_config('request.jwt.claims',
    '{"role":"anon"}', true);
  begin
    perform public.require_aal2();
  exception
    when insufficient_privilege then
      v_passed := false;
  end;
  if not v_passed then
    raise exception 'FAIL: require_aal2 must pass anon (grant layer handles denial)';
  end if;
  raise notice 'PASS: require_aal2 passes anon session (grant layer handles denial)';

  -- empty/missing claims → passes (internal Postgres calls have no JWT)
  v_passed := true;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.require_aal2();
  exception
    when insufficient_privilege then
      v_passed := false;
  end;
  if not v_passed then
    raise exception 'FAIL: require_aal2 must pass empty JWT claims (internal path)';
  end if;
  raise notice 'PASS: require_aal2 passes empty JWT claims (internal path)';

  -- authenticated with missing aal field → rejected (treated same as aal1)
  v_rejected := false;
  perform set_config('request.jwt.claims',
    '{"role":"authenticated"}', true);
  begin
    perform public.require_aal2();
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: require_aal2 must reject authenticated session with no aal claim';
  end if;
  raise notice 'PASS: require_aal2 rejects authenticated session with no aal claim';

  -- =========================================================================
  -- service_role grants (used by Temporal workers, Edge Functions, admin tooling)
  -- =========================================================================

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not has_table_privilege('service_role', 'public.entities', 'SELECT') then
      raise exception 'FAIL: service_role can SELECT from entities';
    end if;
    raise notice 'PASS: service_role can SELECT from entities';

    if not has_table_privilege('service_role', 'public.entities', 'INSERT') then
      raise exception 'FAIL: service_role can INSERT into entities';
    end if;
    raise notice 'PASS: service_role can INSERT into entities';

    if not has_schema_privilege('service_role', 'public', 'USAGE') then
      raise exception 'FAIL: service_role can USAGE schema public';
    end if;
    raise notice 'PASS: service_role can USAGE schema public';
  else
    raise notice 'SKIP: service_role role not present (plain-Postgres CI)';
  end if;

  -- =========================================================================
  -- Layer 3: Default privileges — future tables inherit the posture
  -- =========================================================================

  create table if not exists public._auth_test_future_table (id serial primary key, val text);

  if has_table_privilege('anon', 'public._auth_test_future_table', 'SELECT') then
    raise exception 'FAIL: anon cannot SELECT from a newly created table';
  end if;
  raise notice 'PASS: anon cannot SELECT from newly created table (default privs enforce posture)';

  if not has_table_privilege('authenticated', 'public._auth_test_future_table', 'SELECT') then
    raise exception 'FAIL: authenticated can SELECT from a newly created table';
  end if;
  raise notice 'PASS: authenticated can SELECT from newly created table (default privs work)';

  drop table if exists public._auth_test_future_table;

  raise notice '=== All auth RBAC contract tests passed ===';

end;
$$;

rollback;
