-- Behavioral guard tests for the workflow definition promotion RPCs:
--   public.submit_definition_for_review(uuid)
--   public.approve_workflow_definition(uuid, text)
--   public.reject_workflow_definition(uuid, text)
--
-- Verifies five layers:
--   1. Grant surface      — authenticated has EXECUTE on all three RPCs.
--   2. RLS enforcement    — authenticated cannot INSERT into the audit log
--                           directly; SELECT is permitted.
--   3. Role denial        — read_only / reviewer callers are denied on write
--                           RPCs that require admin/editor; read_only is denied
--                           on reviewer-capable RPCs.
--   4. Correct denial     — reviewer cannot submit (submit requires admin/editor).
--   5. Writer correctness — authorized editor/reviewer calls succeed and
--                           produce the expected state transitions + audit rows.
--
-- JWT claims are injected via set_config('request.jwt.claims', ..., true)
-- to simulate PostgREST behavior (ADR-0023 / ADR-0034).
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_definition_review_surface.sql

begin;

do $$
declare
  v_rejected       boolean;
  v_def_id_draft   uuid;
  v_def_id_pending uuid;
  v_def_id_reject  uuid;
  v_def_row        workflow_definitions;
  v_audit_count    int;
begin

  -- =========================================================================
  -- Setup: insert workflow definitions at the required starting states.
  -- These are written by postgres (superuser) which bypasses RLS.
  -- =========================================================================

  insert into workflow_definitions (name, version, definition)
  values (
    'promo-guard-submit',
    '1.0.0',
    '{"name":"promo-guard-submit","version":"1.0.0","steps":{"set_variable":{"name":"x","value":"ok"}}}'::jsonb
  )
  returning id into v_def_id_draft;

  insert into workflow_definitions (name, version, definition, review_status)
  values (
    'promo-guard-approve',
    '1.0.0',
    '{"name":"promo-guard-approve","version":"1.0.0","steps":{"set_variable":{"name":"x","value":"ok"}}}'::jsonb,
    'pending-review'
  )
  returning id into v_def_id_pending;

  insert into workflow_definitions (name, version, definition, review_status)
  values (
    'promo-guard-reject',
    '1.0.0',
    '{"name":"promo-guard-reject","version":"1.0.0","steps":{"set_variable":{"name":"x","value":"ok"}}}'::jsonb,
    'pending-review'
  )
  returning id into v_def_id_reject;

  -- =========================================================================
  -- 1. Grant surface: authenticated must have EXECUTE on all three RPCs.
  -- =========================================================================

  if not has_function_privilege('authenticated', 'public.submit_definition_for_review(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE on submit_definition_for_review';
  end if;
  raise notice 'PASS: authenticated has EXECUTE on submit_definition_for_review';

  if not has_function_privilege('authenticated', 'public.approve_workflow_definition(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE on approve_workflow_definition';
  end if;
  raise notice 'PASS: authenticated has EXECUTE on approve_workflow_definition';

  if not has_function_privilege('authenticated', 'public.reject_workflow_definition(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE on reject_workflow_definition';
  end if;
  raise notice 'PASS: authenticated has EXECUTE on reject_workflow_definition';

  -- =========================================================================
  -- 2a. RLS enforcement: authenticated cannot INSERT into the audit log directly.
  -- =========================================================================

  v_rejected := false;
  begin
    set local role authenticated;
    insert into workflow_definition_audit_log
      (definition_id, definition_name, action, actor_id, version)
    values
      (v_def_id_draft, 'promo-guard-submit', 'submit', 'spoofed-actor', '1.0.0');
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: authenticated direct INSERT into workflow_definition_audit_log must be denied by RLS';
  end if;
  raise notice 'PASS: authenticated direct INSERT into audit log denied by RLS';

  -- =========================================================================
  -- 2b. RLS enforcement: authenticated CAN SELECT from the audit log.
  -- =========================================================================

  -- Insert a row as postgres (bypasses RLS) so there is something to read.
  insert into workflow_definition_audit_log
    (definition_id, definition_name, action, actor_id, version)
  values
    (v_def_id_draft, 'promo-guard-submit', 'promote', 'system', '1.0.0');

  set local role authenticated;
  select count(*) into v_audit_count
  from workflow_definition_audit_log
  where definition_id = v_def_id_draft;
  set local role postgres;

  if v_audit_count < 1 then
    raise exception 'FAIL: authenticated must be able to SELECT from workflow_definition_audit_log';
  end if;
  raise notice 'PASS: authenticated can SELECT from the audit log';

  -- =========================================================================
  -- 3a. Role denial: read_only cannot call submit_definition_for_review.
  -- =========================================================================

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "sub": "user-read-only", "app_metadata": {"role": "read_only"}}',
      true
    );
    set local role authenticated;
    perform public.submit_definition_for_review(v_def_id_draft);
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: read_only must be denied by submit_definition_for_review RPC guard';
  end if;
  raise notice 'PASS: read_only denied by submit_definition_for_review';

  -- =========================================================================
  -- 3b. Role denial: read_only cannot call approve_workflow_definition.
  -- =========================================================================

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "sub": "user-read-only", "app_metadata": {"role": "read_only"}}',
      true
    );
    set local role authenticated;
    perform public.approve_workflow_definition(v_def_id_pending, null);
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: read_only must be denied by approve_workflow_definition RPC guard';
  end if;
  raise notice 'PASS: read_only denied by approve_workflow_definition';

  -- =========================================================================
  -- 3c. Role denial: read_only cannot call reject_workflow_definition.
  -- =========================================================================

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "sub": "user-read-only", "app_metadata": {"role": "read_only"}}',
      true
    );
    set local role authenticated;
    perform public.reject_workflow_definition(v_def_id_reject, null);
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: read_only must be denied by reject_workflow_definition RPC guard';
  end if;
  raise notice 'PASS: read_only denied by reject_workflow_definition';

  -- =========================================================================
  -- 4. Correct denial: reviewer cannot call submit_definition_for_review.
  --    Submit requires admin or editor; reviewer is only allowed to approve/reject.
  -- =========================================================================

  v_rejected := false;
  begin
    perform set_config(
      'request.jwt.claims',
      '{"role": "authenticated", "sub": "user-reviewer", "app_metadata": {"role": "reviewer"}}',
      true
    );
    set local role authenticated;
    perform public.submit_definition_for_review(v_def_id_draft);
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_rejected then
    raise exception 'FAIL: reviewer must be denied by submit_definition_for_review (requires admin/editor)';
  end if;
  raise notice 'PASS: reviewer denied by submit_definition_for_review (requires admin/editor)';

  -- =========================================================================
  -- 5a. Writer correctness: editor can submit a draft definition for review.
  -- =========================================================================

  perform set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "user-editor", "app_metadata": {"role": "editor"}}',
    true
  );
  set local role authenticated;
  v_def_row := public.submit_definition_for_review(v_def_id_draft);
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);

  if v_def_row.review_status <> 'pending-review' then
    raise exception 'FAIL: submit should transition review_status to pending-review, got %', v_def_row.review_status;
  end if;
  raise notice 'PASS: editor call: review_status transitioned to pending-review';

  select count(*) into v_audit_count
  from workflow_definition_audit_log
  where definition_id = v_def_id_draft and action = 'submit';
  if v_audit_count <> 1 then
    raise exception 'FAIL: submit should create exactly 1 audit log entry, found %', v_audit_count;
  end if;
  raise notice 'PASS: editor call: audit log entry created for submit action';

  -- =========================================================================
  -- 5b. Writer correctness: reviewer can approve a pending-review definition.
  -- =========================================================================

  perform set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "user-reviewer", "app_metadata": {"role": "reviewer"}}',
    true
  );
  set local role authenticated;
  v_def_row := public.approve_workflow_definition(v_def_id_pending, 'Verified against staging run');
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);

  if v_def_row.review_status <> 'approved' then
    raise exception 'FAIL: approve should set review_status to approved, got %', v_def_row.review_status;
  end if;
  if v_def_row.is_active is not true then
    raise exception 'FAIL: approve should set is_active to true';
  end if;
  raise notice 'PASS: reviewer call: definition approved and activated';

  select count(*) into v_audit_count
  from workflow_definition_audit_log
  where definition_id = v_def_id_pending and action = 'approve';
  if v_audit_count <> 1 then
    raise exception 'FAIL: approve should create exactly 1 audit log entry, found %', v_audit_count;
  end if;
  raise notice 'PASS: reviewer call: audit log entry created for approve action';

  -- =========================================================================
  -- 5c. Writer correctness: reviewer can reject a pending-review definition.
  -- =========================================================================

  perform set_config(
    'request.jwt.claims',
    '{"role": "authenticated", "sub": "user-reviewer", "app_metadata": {"role": "reviewer"}}',
    true
  );
  set local role authenticated;
  v_def_row := public.reject_workflow_definition(v_def_id_reject, 'Needs revision');
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);

  if v_def_row.review_status <> 'rejected' then
    raise exception 'FAIL: reject should set review_status to rejected, got %', v_def_row.review_status;
  end if;
  raise notice 'PASS: reviewer call: definition rejected';

  select count(*) into v_audit_count
  from workflow_definition_audit_log
  where definition_id = v_def_id_reject and action = 'reject';
  if v_audit_count <> 1 then
    raise exception 'FAIL: reject should create exactly 1 audit log entry, found %', v_audit_count;
  end if;
  raise notice 'PASS: reviewer call: audit log entry created for reject action';

  raise notice '=== All workflow definition review surface tests passed ===';

end;
$$;

rollback;
