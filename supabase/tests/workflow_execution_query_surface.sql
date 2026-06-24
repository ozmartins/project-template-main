-- Contract tests for workflow execution query surfaces:
--   public.get_workflow_executions()
--   public.get_workflow_execution_detail(workflow_id)

begin;

do $$
declare
  v_list               jsonb;
  v_list_page_1        jsonb;
  v_list_page_2        jsonb;
  v_detail_ok          jsonb;
  v_detail_failed      jsonb;
  v_auth_list          jsonb;
  v_auth_detail        jsonb;
  v_item               jsonb;
  v_has_signal_audit   boolean;
begin
  insert into workflow_definitions (name, version, definition, is_active)
  values
    ('workflow-query-contract', '1.0.0', '{"name":"workflow-query-contract","version":"1.0.0","steps":{"set_variable":{"name":"x","value":"ok"}}}'::jsonb, true),
    ('workflow-query-contract', '1.1.0', '{"name":"workflow-query-contract","version":"1.1.0","steps":{"set_variable":{"name":"x","value":"next"}}}'::jsonb, false);

  insert into workflow_executions (
    workflow_id,
    run_id,
    definition_name,
    definition_version,
    status,
    current_step,
    started_at,
    completed_at,
    input_payload,
    output_payload
  )
  values
    (
      'wf-running',
      'run-running',
      'workflow-query-contract',
      '1.1.0',
      'running',
      'wait_signal',
      now() - interval '30 seconds',
      null,
      '{"summary":"waiting for approval","domain":"running.test"}'::jsonb,
      null
    ),
    (
      'wf-completed',
      'run-completed',
      'workflow-query-contract',
      '1.0.0',
      'completed',
      'done',
      now() - interval '120 seconds',
      now() - interval '60 seconds',
      '{"summary":"classify domain stripe.com"}'::jsonb,
      '{
        "variables":{"classification":"fintech"},
        "output":{"result":"ok"},
        "llm_agent":{
          "provider":"anthropic",
          "model":"claude-sonnet-4-5",
          "prompt_tokens":123,
          "completion_tokens":45,
          "tool_calls":[{"name":"search_web"}],
          "parsed":{"vertical":"fintech"},
          "retries":1
        },
        "step_trace":[
          {"step":"fetch","status":"completed"},
          {"step":"llm_agent","status":"completed"}
        ]
      }'::jsonb
    ),
    (
      'wf-failed',
      'run-failed',
      'workflow-query-contract',
      '1.0.0',
      'failed',
      'llm_agent',
      now() - interval '180 seconds',
      now() - interval '150 seconds',
      '{"summary":"classify failing domain"}'::jsonb,
      '{
        "llm_agent":{
          "provider":"openai",
          "model":"gpt-4o",
          "prompt_tokens":50,
          "completion_tokens":0,
          "tool_call_rounds":2,
          "parsed":null,
          "retries":3,
          "error_state":true
        },
        "step_trace":[
          {"step":"fetch","status":"completed"},
          {"step":"llm_agent","status":"failed","error":"rate limit"}
        ],
        "error":{"type":"provider_error","message":"rate limit"}
      }'::jsonb
    ),
    (
      'wf-page-z',
      'run-page-z',
      'workflow-query-contract',
      '1.0.0',
      'completed',
      'done',
      '2026-01-01T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:40Z'::timestamptz,
      '{"summary":"page boundary z"}'::jsonb,
      '{"variables":{"page":"z"},"output":{"result":"ok"}}'::jsonb
    ),
    (
      'wf-page-y',
      'run-page-y',
      'workflow-query-contract',
      '1.0.0',
      'completed',
      'done',
      '2026-01-01T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:45Z'::timestamptz,
      '{"summary":"page boundary y"}'::jsonb,
      '{"variables":{"page":"y"},"output":{"result":"ok"}}'::jsonb
    ),
    (
      'wf-page-x',
      'run-page-x',
      'workflow-query-contract',
      '1.0.0',
      'completed',
      'done',
      '2026-01-01T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:50Z'::timestamptz,
      '{"summary":"page boundary x"}'::jsonb,
      '{"variables":{"page":"x"},"output":{"result":"ok"}}'::jsonb
    );

  update workflow_executions
     set error_message = 'LLM provider timeout'
   where workflow_id = 'wf-failed';

  insert into workflow_signals (workflow_id, signal_name, payload, sent_by, sent_at)
  values ('wf-failed', 'approve', '{"approved":false}'::jsonb, 'operator-1', now() - interval '160 seconds');

  -- List surface
  if not has_function_privilege('authenticated', 'public.get_workflow_executions(integer, timestamp with time zone, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE on get_workflow_executions';
  end if;
  if not has_function_privilege('authenticated', 'public.get_workflow_execution_detail(text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE on get_workflow_execution_detail';
  end if;

  set local role authenticated;
  v_auth_list := public.get_workflow_executions(1, null, null);
  v_auth_detail := public.get_workflow_execution_detail('wf-failed');
  set local role postgres;

  if v_auth_list->'data' is null then
    raise exception 'FAIL: authenticated role should be able to execute get_workflow_executions';
  end if;
  if v_auth_detail->'data' is null then
    raise exception 'FAIL: authenticated role should be able to execute get_workflow_execution_detail';
  end if;

  v_list := public.get_workflow_executions(10, null, null);
  if jsonb_typeof(v_list->'data') <> 'array' then
    raise exception 'FAIL: list.data must be an array';
  end if;
  if (select count(*) from jsonb_array_elements(v_list->'data')) <> 6 then
    raise exception 'FAIL: list.data expected 6 executions';
  end if;

  select elem
    into v_item
    from jsonb_array_elements(v_list->'data') elem
   where elem->>'workflow_id' = 'wf-completed'
   limit 1;
  if v_item is null then
    raise exception 'FAIL: completed execution missing from list';
  end if;
  if not starts_with(coalesce(v_item->>'input_summary', ''), 'classify domain stripe.com') then
    raise exception 'FAIL: list input_summary not populated from input payload';
  end if;
  if (v_item->>'duration')::numeric <= 0 then
    raise exception 'FAIL: list duration must be positive for completed run';
  end if;

  -- Deterministic keyset pagination over duplicate started_at boundary
  v_list_page_1 := public.get_workflow_executions(4, null, null);
  v_list_page_2 := public.get_workflow_executions(
    10,
    (v_list_page_1->'meta'->'pagination'->>'next_before_started_at')::timestamptz,
    v_list_page_1->'meta'->'pagination'->>'next_before_workflow_id'
  );

  if not exists (
    select 1
    from jsonb_array_elements(v_list_page_2->'data') elem
    where elem->>'workflow_id' = 'wf-page-y'
  ) then
    raise exception 'FAIL: keyset pagination skipped wf-page-y at duplicate timestamp boundary';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_list_page_2->'data') elem
    where elem->>'workflow_id' = 'wf-page-x'
  ) then
    raise exception 'FAIL: keyset pagination skipped wf-page-x at duplicate timestamp boundary';
  end if;

  -- Detail surface (completed)
  v_detail_ok := public.get_workflow_execution_detail('wf-completed');
  if v_detail_ok->'data'->>'workflow_id' <> 'wf-completed' then
    raise exception 'FAIL: detail should return wf-completed';
  end if;
  if jsonb_array_length(v_detail_ok->'data'->'trace_entries') < 2 then
    raise exception 'FAIL: detail trace_entries should include step trace rows';
  end if;
  if v_detail_ok->'data'->'llm_agent'->>'provider' <> 'anthropic' then
    raise exception 'FAIL: detail llm_agent provider mismatch';
  end if;
  if (v_detail_ok->'data'->'llm_agent'->>'prompt_tokens')::integer <> 123 then
    raise exception 'FAIL: detail llm_agent prompt_tokens mismatch';
  end if;

  -- Detail surface (failed)
  v_detail_failed := public.get_workflow_execution_detail('wf-failed');
  if v_detail_failed->'data'->'failure'->>'error_message' <> 'LLM provider timeout' then
    raise exception 'FAIL: failed detail should include failure metadata';
  end if;
  if coalesce((v_detail_failed->'data'->'llm_agent'->>'error_state')::boolean, false) is not true then
    raise exception 'FAIL: failed detail should flag llm_agent error_state';
  end if;
  if jsonb_array_length(v_detail_failed->'data'->'trace_entries') < 2 then
    raise exception 'FAIL: failed detail should include step + signal trace entries';
  end if;
  select exists (
    select 1
    from jsonb_array_elements(v_detail_failed->'data'->'trace_entries') elem
    where elem->>'source' = 'signal_audit'
      and elem->>'signal_name' = 'approve'
  ) into v_has_signal_audit;
  if not coalesce(v_has_signal_audit, false) then
    raise exception 'FAIL: failed detail must include signal_audit trace entry';
  end if;

  raise notice '=== Workflow execution query surface tests passed ===';
end;
$$;

rollback;
