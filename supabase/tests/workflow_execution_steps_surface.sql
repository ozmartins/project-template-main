-- Behavioral access-surface tests for public.workflow_execution_steps.
--
-- Verifies:
--   1. authenticated can read workflow_execution_steps.
--   2. authenticated writes are denied (INSERT/UPDATE/DELETE).
--   3. denied writes raise insufficient_privilege when running as authenticated.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_execution_steps_surface.sql

begin;

do $$
declare
  v_rejected boolean;
  v_count int;
begin
  if not has_table_privilege('authenticated', 'public.workflow_execution_steps', 'SELECT') then
    raise exception 'FAIL: authenticated must be able to SELECT from workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated can SELECT from workflow_execution_steps';

  if has_table_privilege('authenticated', 'public.workflow_execution_steps', 'INSERT') then
    raise exception 'FAIL: authenticated must NOT be able to INSERT into workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated cannot INSERT into workflow_execution_steps';

  if has_table_privilege('authenticated', 'public.workflow_execution_steps', 'UPDATE') then
    raise exception 'FAIL: authenticated must NOT be able to UPDATE workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated cannot UPDATE workflow_execution_steps';

  if has_table_privilege('authenticated', 'public.workflow_execution_steps', 'DELETE') then
    raise exception 'FAIL: authenticated must NOT be able to DELETE from workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated cannot DELETE from workflow_execution_steps';

  insert into public.workflow_definitions (
    name, version, definition, description
  ) values (
    'workflow_guard_surface_test',
    '1.0.0',
    '{"name":"workflow_guard_surface_test","version":"1.0.0","steps":[]}'::jsonb,
    'Guard surface test fixture'
  );

  insert into public.workflow_executions (
    workflow_id, run_id, definition_name, definition_version, status, started_at, input_payload
  ) values (
    'wf_guard_surface_test',
    'run_guard_surface_test',
    'workflow_guard_surface_test',
    '1.0.0',
    'running',
    now(),
    '{}'::jsonb
  );

  insert into public.workflow_execution_steps (
    workflow_id, step_index, step_name, status, started_at, input_preview
  ) values (
    'wf_guard_surface_test', 0, 'initial_step', 'running', now(), '{}'::jsonb
  );

  perform set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "app_metadata": {"role": "editor"}}',
    true
  );

  set local role authenticated;
  select count(*) into v_count
  from public.workflow_execution_steps
  where workflow_id = 'wf_guard_surface_test';
  set local role postgres;

  perform set_config('request.jwt.claims', '', true);

  if v_count <> 1 then
    raise exception 'FAIL: authenticated SELECT should return seeded workflow_execution_steps row';
  end if;
  raise notice 'PASS: authenticated can read workflow_execution_steps rows';

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "app_metadata": {"role": "editor"}}',
      true
    );
    set local role authenticated;
    insert into public.workflow_execution_steps (
      workflow_id, step_index, step_name, status, started_at
    ) values (
      'wf_guard_surface_test', 1, 'write_attempt', 'running', now()
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: authenticated INSERT must be denied on workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated INSERT denied with insufficient_privilege';

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "app_metadata": {"role": "editor"}}',
      true
    );
    set local role authenticated;
    update public.workflow_execution_steps
      set status = 'completed'
    where workflow_id = 'wf_guard_surface_test' and step_index = 0;
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: authenticated UPDATE must be denied on workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated UPDATE denied with insufficient_privilege';

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "app_metadata": {"role": "editor"}}',
      true
    );
    set local role authenticated;
    delete from public.workflow_execution_steps
    where workflow_id = 'wf_guard_surface_test' and step_index = 0;
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: authenticated DELETE must be denied on workflow_execution_steps';
  end if;
  raise notice 'PASS: authenticated DELETE denied with insufficient_privilege';

  raise notice '=== workflow_execution_steps access-surface tests passed ===';
end;
$$;

rollback;
