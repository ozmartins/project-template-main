-- Behavioral access-control guard for public.documents and public.match_documents.
--
-- Proves that anon and authenticated roles have NO read, write, or execute
-- access to the backend-only documents table and match_documents RPC.
--
-- Skips gracefully when public.documents is absent (pgvector unavailable).
-- All assertions run inside a single transaction that is rolled back at the
-- end so no side-effects persist.

begin;

do $$
declare
  v_denied         boolean;
  v_func_oid       oid;
begin
  -- ── Guard: pgvector unavailable ───────────────────────────────────────────
  if to_regclass('public.documents') is null then
    raise notice 'SKIP: public.documents not present (pgvector unavailable); access-guard test skipped.';
    return;
  end if;

  -- ── 1. Table privilege checks (privilege system) ──────────────────────────

  -- SELECT
  if has_table_privilege('anon', 'public.documents', 'SELECT') then
    raise exception 'FAIL: anon must not have SELECT on public.documents';
  end if;
  if has_table_privilege('authenticated', 'public.documents', 'SELECT') then
    raise exception 'FAIL: authenticated must not have SELECT on public.documents';
  end if;

  -- INSERT / UPDATE / DELETE
  if has_table_privilege('anon', 'public.documents', 'INSERT') then
    raise exception 'FAIL: anon must not have INSERT on public.documents';
  end if;
  if has_table_privilege('authenticated', 'public.documents', 'INSERT') then
    raise exception 'FAIL: authenticated must not have INSERT on public.documents';
  end if;
  if has_table_privilege('anon', 'public.documents', 'UPDATE') then
    raise exception 'FAIL: anon must not have UPDATE on public.documents';
  end if;
  if has_table_privilege('authenticated', 'public.documents', 'UPDATE') then
    raise exception 'FAIL: authenticated must not have UPDATE on public.documents';
  end if;
  if has_table_privilege('anon', 'public.documents', 'DELETE') then
    raise exception 'FAIL: anon must not have DELETE on public.documents';
  end if;
  if has_table_privilege('authenticated', 'public.documents', 'DELETE') then
    raise exception 'FAIL: authenticated must not have DELETE on public.documents';
  end if;

  -- ── 2. Runtime read denial (role switching) ───────────────────────────────

  v_denied := false;
  begin
    set local role authenticated;
    -- Privilege is enforced before WHERE filtering; this tests permission denial
    -- without needing real rows or vector payloads.
    perform 1 from public.documents limit 0;
    set local role postgres;
  exception
    when insufficient_privilege then
      v_denied := true;
      set local role postgres;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated must not be able to SELECT from public.documents';
  end if;

  v_denied := false;
  begin
    set local role anon;
    perform 1 from public.documents limit 0;
    set local role postgres;
  exception
    when insufficient_privilege then
      v_denied := true;
      set local role postgres;
  end;
  if not v_denied then
    raise exception 'FAIL: anon must not be able to SELECT from public.documents';
  end if;

  -- ── 3. Runtime write denial (role switching) ──────────────────────────────

  v_denied := false;
  begin
    set local role authenticated;
    -- PostgreSQL checks privileges before evaluating WHERE false; the UPDATE
    -- will fail on insufficient_privilege rather than succeeding with zero rows.
    update public.documents set content = content where false;
    set local role postgres;
  exception
    when insufficient_privilege then
      v_denied := true;
      set local role postgres;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated direct writes to public.documents must be denied';
  end if;

  -- ── 4. match_documents RPC execute-privilege check ────────────────────────

  -- Look up the function OID; skip if match_documents was not created
  -- (e.g. migration skipped because pgvector loaded after table was created).
  select p.oid
    into v_func_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'match_documents'
   limit 1;

  if v_func_oid is null then
    raise notice 'SKIP: public.match_documents not found; RPC execute-grant check skipped.';
  else
    -- PUBLIC must not have execute (default grant revoked by the migration).
    if has_function_privilege('public', v_func_oid, 'execute') then
      raise exception 'FAIL: PUBLIC must not have EXECUTE on public.match_documents';
    end if;

    -- anon must not have execute.
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if has_function_privilege('anon', v_func_oid, 'execute') then
        raise exception 'FAIL: anon must not have EXECUTE on public.match_documents';
      end if;
    end if;

    -- authenticated must not have execute.
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      if has_function_privilege('authenticated', v_func_oid, 'execute') then
        raise exception 'FAIL: authenticated must not have EXECUTE on public.match_documents';
      end if;
    end if;
  end if;

  raise notice '=== documents access guard tests passed ===';
end;
$$;

rollback;
