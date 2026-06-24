-- Behavioral contract tests for workflow_document_extractions table privileges.
--
-- Verifies:
--   1. authenticated cannot INSERT/UPDATE/DELETE.
--   2. denied writes raise insufficient_privilege under authenticated role with JWT claims set.
--   3. authenticated can still SELECT persisted rows.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_document_extractions_access.sql

begin;

do $$
declare
  v_rejected boolean;
  v_count    integer;
begin
  if has_table_privilege('authenticated', 'public.workflow_document_extractions', 'INSERT') then
    raise exception 'FAIL: authenticated must NOT have INSERT on workflow_document_extractions';
  end if;
  if has_table_privilege('authenticated', 'public.workflow_document_extractions', 'UPDATE') then
    raise exception 'FAIL: authenticated must NOT have UPDATE on workflow_document_extractions';
  end if;
  if has_table_privilege('authenticated', 'public.workflow_document_extractions', 'DELETE') then
    raise exception 'FAIL: authenticated must NOT have DELETE on workflow_document_extractions';
  end if;
  if not has_table_privilege('authenticated', 'public.workflow_document_extractions', 'SELECT') then
    raise exception 'FAIL: authenticated should retain SELECT on workflow_document_extractions';
  end if;
  raise notice 'PASS: authenticated write grants revoked and read grant retained';

  insert into workflow_document_extractions (
    source_url,
    extracted_fields,
    confidence,
    extracted_at
  )
  values (
    'https://example.com/original',
    '{"title":"Original"}'::jsonb,
    0.95,
    now()
  );

  perform set_config(
    'request.jwt.claims',
    '{"role":"authenticated","app_metadata":{"role":"editor"}}',
    true
  );
  set local role authenticated;
  select count(*) into v_count
  from workflow_document_extractions
  where source_url = 'https://example.com/original';
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);

  if v_count <> 1 then
    raise exception 'FAIL: authenticated should be able to read workflow_document_extractions rows';
  end if;
  raise notice 'PASS: authenticated can read workflow_document_extractions rows';

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role":"authenticated","app_metadata":{"role":"editor"}}',
      true
    );
    set local role authenticated;
    insert into workflow_document_extractions (source_url, extracted_fields)
    values ('https://example.com/denied-insert', '{"title":"Denied"}'::jsonb);
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: authenticated INSERT must raise insufficient_privilege';
  end if;
  raise notice 'PASS: authenticated INSERT denied with insufficient_privilege';

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role":"authenticated","app_metadata":{"role":"editor"}}',
      true
    );
    set local role authenticated;
    update workflow_document_extractions
       set confidence = 0.80
     where source_url = 'https://example.com/original';
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: authenticated UPDATE must raise insufficient_privilege';
  end if;
  raise notice 'PASS: authenticated UPDATE denied with insufficient_privilege';

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role":"authenticated","app_metadata":{"role":"editor"}}',
      true
    );
    set local role authenticated;
    delete from workflow_document_extractions
     where source_url = 'https://example.com/original';
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: authenticated DELETE must raise insufficient_privilege';
  end if;
  raise notice 'PASS: authenticated DELETE denied with insufficient_privilege';

  raise notice '=== workflow_document_extractions access contract tests passed ===';
end;
$$;

rollback;
