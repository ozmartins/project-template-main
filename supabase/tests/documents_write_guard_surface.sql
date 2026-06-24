-- Contract test for public.documents direct-write guard.
-- If pgvector is unavailable and documents is not created, skip.

begin;

do $$
declare
  v_denied boolean := false;
begin
  if to_regclass('public.documents') is null then
    raise notice 'SKIP: public.documents not present (pgvector unavailable)';
    return;
  end if;

  if has_table_privilege('authenticated', 'public.documents', 'INSERT, UPDATE, DELETE') then
    raise exception 'FAIL: authenticated must not have INSERT/UPDATE/DELETE on public.documents';
  end if;
  if has_table_privilege('anon', 'public.documents', 'INSERT, UPDATE, DELETE') then
    raise exception 'FAIL: anon must not have INSERT/UPDATE/DELETE on public.documents';
  end if;

  begin
    set local role authenticated;
    -- Privileges are checked before row filtering; WHERE false validates denied
    -- write permission without needing a real vector payload or fixture rows.
    update public.documents set content = content where false;
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'FAIL: authenticated direct writes to public.documents must be denied';
  end if;

  raise notice '=== documents direct-write guard test passed ===';
end;
$$;

rollback;
