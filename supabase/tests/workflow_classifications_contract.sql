-- Contract tests for workflow_classifications (migration 20260620000300).
--
-- Validates three layers:
--   1. Table shape      — expected columns, types, NOT NULL and UNIQUE constraints.
--   2. Trigger wiring   — updated_at advances on UPDATE via trg_workflow_classifications_updated_at.
--   3. Upsert write path — INSERT ... ON CONFLICT (domain) DO UPDATE merges fields and returns
--                          the persisted row, mirroring the PostgREST supabase_mutate path used
--                          by temporal/scripts/test-vertical-classification.ts.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_classifications_contract.sql

begin;

do $$
declare
  v_id          uuid;
  v_updated_at1 timestamptz;
  v_updated_at2 timestamptz;
  v_count       int;
  v_rejected    boolean;
begin

  -- =========================================================================
  -- 1. Table shape: all expected columns are present
  -- =========================================================================

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'workflow_classifications'
  ) then
    raise exception 'FAIL: workflow_classifications table does not exist';
  end if;
  raise notice 'PASS: workflow_classifications table exists';

  -- Required NOT NULL columns
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications'
      and column_name = 'id' and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: column id must be NOT NULL';
  end if;
  raise notice 'PASS: id is NOT NULL';

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications'
      and column_name = 'domain' and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: column domain must be NOT NULL';
  end if;
  raise notice 'PASS: domain is NOT NULL';

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications'
      and column_name = 'name' and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: column name must be NOT NULL';
  end if;
  raise notice 'PASS: name is NOT NULL';

  -- Nullable classification columns
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'vertical'
  ) then raise exception 'FAIL: column vertical missing from workflow_classifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'sub_vertical'
  ) then raise exception 'FAIL: column sub_vertical missing from workflow_classifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'lifecycle_stage'
  ) then raise exception 'FAIL: column lifecycle_stage missing from workflow_classifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'confidence'
  ) then raise exception 'FAIL: column confidence missing from workflow_classifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'classified_at'
  ) then raise exception 'FAIL: column classified_at missing from workflow_classifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'classification_tags'
  ) then raise exception 'FAIL: column classification_tags missing from workflow_classifications'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications' and column_name = 'domain_active'
  ) then raise exception 'FAIL: column domain_active missing from workflow_classifications'; end if;

  raise notice 'PASS: classification payload columns present (vertical, sub_vertical, lifecycle_stage, confidence, classified_at, classification_tags)';

  -- Timestamps
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications'
      and column_name = 'created_at' and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: column created_at must be NOT NULL';
  end if;
  raise notice 'PASS: created_at is NOT NULL';

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_classifications'
      and column_name = 'updated_at' and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: column updated_at must be NOT NULL';
  end if;
  raise notice 'PASS: updated_at is NOT NULL';

  -- =========================================================================
  -- 2. Uniqueness constraint: domain must be UNIQUE
  -- =========================================================================

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public'
      and t.relname = 'workflow_classifications'
      and c.contype = 'u'
      and a.attname = 'domain'
      and array_length(c.conkey, 1) = 1
  ) then
    raise exception 'FAIL: domain UNIQUE constraint is missing on workflow_classifications';
  end if;
  raise notice 'PASS: domain UNIQUE constraint exists';

  -- Insert a row to exercise the unique violation path
  insert into workflow_classifications (domain, name, vertical, sub_vertical, confidence)
    values ('acme.example', 'Acme Corp', 'fintech', 'payments', 0.95)
    returning id into v_id;
  raise notice 'PASS: initial insert succeeded, id=%', v_id;

  -- Duplicate domain must be rejected
  v_rejected := false;
  begin
    insert into workflow_classifications (domain, name)
      values ('acme.example', 'Acme Corp Duplicate');
  exception
    when unique_violation then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: duplicate domain insert must raise unique_violation';
  end if;
  raise notice 'PASS: duplicate domain insert correctly rejected with unique_violation';

  -- =========================================================================
  -- 3. Trigger wiring: updated_at advances on UPDATE
  -- =========================================================================

  if not exists (
    select 1 from pg_trigger trg
    join pg_class t on t.oid = trg.tgrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'workflow_classifications'
      and trg.tgname = 'trg_workflow_classifications_updated_at'
      and trg.tgenabled != 'D'
  ) then
    raise exception 'FAIL: trg_workflow_classifications_updated_at trigger is missing or disabled';
  end if;
  raise notice 'PASS: trg_workflow_classifications_updated_at trigger is present and enabled';

  -- Backdate updated_at by temporarily disabling triggers (session_replication_role
  -- suppresses row triggers without removing them). This lets us set a sentinel past
  -- value and then verify the trigger overwrites it on the next normal UPDATE.
  set session_replication_role = 'replica';
  update workflow_classifications
     set updated_at = '2000-01-01 00:00:00+00'::timestamptz
   where id = v_id;
  set session_replication_role = 'origin';

  select updated_at into v_updated_at1
    from workflow_classifications where id = v_id;

  if v_updated_at1 <> '2000-01-01 00:00:00+00'::timestamptz then
    raise exception 'FAIL: test setup — expected sentinel updated_at 2000-01-01, got %', v_updated_at1;
  end if;

  -- Normal UPDATE — trigger must fire and overwrite the sentinel value
  update workflow_classifications
     set confidence = 0.98
   where id = v_id;

  select updated_at into v_updated_at2
    from workflow_classifications where id = v_id;

  if v_updated_at2 = '2000-01-01 00:00:00+00'::timestamptz then
    raise exception 'FAIL: updated_at still shows sentinel after UPDATE — trigger did not fire';
  end if;
  raise notice 'PASS: updated_at advanced on UPDATE (trigger fired correctly). sentinel=2000-01-01, after=%',
    v_updated_at2;

  -- =========================================================================
  -- 4. Upsert write path: INSERT ... ON CONFLICT (domain) DO UPDATE
  --    Mirrors the PostgREST upsert used by supabase_mutate in
  --    temporal/src/activities/supabase_query.ts.
  -- =========================================================================

  -- Upsert the same domain with new classification fields
  insert into workflow_classifications (domain, name, vertical, sub_vertical, confidence, domain_active)
    values ('acme.example', 'Acme Corp', 'fintech', 'b2b-payments', 0.97, true)
    on conflict (domain) do update
      set name          = excluded.name,
          vertical      = excluded.vertical,
          sub_vertical  = excluded.sub_vertical,
          confidence    = excluded.confidence,
          domain_active = excluded.domain_active;

  -- Confirm there is still exactly one row for this domain
  select count(*) into v_count
    from workflow_classifications
   where domain = 'acme.example';

  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 row after upsert, got %', v_count;
  end if;
  raise notice 'PASS: upsert produced exactly 1 row (no duplicate created)';

  -- Confirm the updated fields were merged correctly
  if not exists (
    select 1 from workflow_classifications
     where domain = 'acme.example'
       and sub_vertical = 'b2b-payments'
       and confidence = 0.97
       and domain_active = true
  ) then
    raise exception 'FAIL: upserted row does not contain the expected merged field values';
  end if;
  raise notice 'PASS: upserted row contains correct merged field values';

  raise notice '=== All workflow_classifications contract tests passed ===';

end;
$$;

rollback;
