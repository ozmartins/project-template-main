-- Workflow definition promotion: review_status column, audit log, and approval RPCs.
-- Implements the staging → production promotion gate for workflow definitions.
-- See issue #79 and design approval in that thread.

-- ── review_status on workflow_definitions ─────────────────────────────────

alter table workflow_definitions
  add column if not exists review_status text not null default 'draft'
    check (review_status in ('draft', 'pending-review', 'approved', 'rejected'));

-- ── workflow_definition_audit_log ─────────────────────────────────────────

create table if not exists workflow_definition_audit_log (
  id               uuid primary key default gen_random_uuid(),
  definition_id    uuid not null references workflow_definitions (id),
  definition_name  text not null,
  action           text not null
                     check (action in ('submit', 'approve', 'reject', 'promote', 'delete')),
  actor_id         text not null,
  version          text not null,
  reason           text,
  created_at       timestamptz not null default now()
);

create index idx_wfdef_audit_definition_id
  on workflow_definition_audit_log (definition_id, created_at desc);

create index idx_wfdef_audit_actor
  on workflow_definition_audit_log (actor_id, created_at desc);

grant select on workflow_definition_audit_log to authenticated;

-- The audit log is written exclusively by the SECURITY DEFINER RPCs below.
-- Prevent authenticated callers from writing rows directly (ADR-0034).
-- SECURITY DEFINER functions run as the function owner (postgres) and bypass
-- RLS, so the write path through the RPCs is unaffected.
alter table workflow_definition_audit_log enable row level security;

create policy "workflow_definition_audit_authenticated_select"
  on workflow_definition_audit_log
  for select
  to authenticated
  using (true);

-- No insert / update / delete policies for authenticated — RLS default-denies
-- all writes from that role.  service_role has BYPASSRLS and remains unaffected.

-- ── submit_definition_for_review ──────────────────────────────────────────
-- Requires writer role (admin or editor); actor derived from JWT sub claim.

create or replace function submit_definition_for_review(
  p_id uuid
)
returns workflow_definitions
security definer
set search_path = public
language plpgsql
as $$
declare
  v_claims_text text := current_setting('request.jwt.claims', true);
  v_claims      json;
  v_jwt_role    text;
  v_app_role    text;
  v_actor_id    text;
  v_row         workflow_definitions;
begin
  -- Safe JSON parse: absent/malformed claims means service_role / direct Postgres path.
  begin
    v_claims := nullif(v_claims_text, '')::json;
  exception when others then
    v_claims := null;
  end;

  v_jwt_role := coalesce(v_claims ->> 'role', '');
  v_app_role := coalesce(v_claims -> 'app_metadata' ->> 'role', '');
  v_actor_id := coalesce(v_claims ->> 'sub', '');

  -- Authorization guard: PostgREST authenticated sessions must have writer role.
  if v_jwt_role = 'authenticated' then
    if v_app_role not in ('admin', 'editor') then
      raise insufficient_privilege
        using message =
          'submit_definition_for_review: app role ''' || coalesce(v_app_role, '') ||
          ''' is not authorized; requires admin or editor';
    end if;
  end if;

  update workflow_definitions
     set review_status = 'pending-review', updated_at = now()
   where id = p_id
     and review_status in ('draft', 'rejected')
  returning * into v_row;

  if not found then
    raise exception 'definition % not found or is not in draft/rejected state', p_id;
  end if;

  insert into workflow_definition_audit_log
    (definition_id, definition_name, action, actor_id, version)
  values
    (v_row.id, v_row.name, 'submit', v_actor_id, v_row.version);

  return v_row;
end;
$$;

grant execute on function submit_definition_for_review(uuid) to authenticated;

-- ── approve_workflow_definition ───────────────────────────────────────────
-- Requires review-capable role (admin, editor, or reviewer); actor from JWT.

create or replace function approve_workflow_definition(
  p_id     uuid,
  p_reason text default null
)
returns workflow_definitions
security definer
set search_path = public
language plpgsql
as $$
declare
  v_claims_text text := current_setting('request.jwt.claims', true);
  v_claims      json;
  v_jwt_role    text;
  v_app_role    text;
  v_actor_id    text;
  v_row         workflow_definitions;
begin
  -- Safe JSON parse: absent/malformed claims means service_role / direct Postgres path.
  begin
    v_claims := nullif(v_claims_text, '')::json;
  exception when others then
    v_claims := null;
  end;

  v_jwt_role := coalesce(v_claims ->> 'role', '');
  v_app_role := coalesce(v_claims -> 'app_metadata' ->> 'role', '');
  v_actor_id := coalesce(v_claims ->> 'sub', '');

  -- Authorization guard: PostgREST authenticated sessions must have review-capable role.
  if v_jwt_role = 'authenticated' then
    if v_app_role not in ('admin', 'editor', 'reviewer') then
      raise insufficient_privilege
        using message =
          'approve_workflow_definition: app role ''' || coalesce(v_app_role, '') ||
          ''' is not authorized; requires admin, editor, or reviewer';
    end if;
  end if;

  -- Load the pending definition.
  select * into v_row from workflow_definitions
   where id = p_id and review_status = 'pending-review';

  if not found then
    raise exception 'definition % not found or is not pending review', p_id;
  end if;

  -- Deactivate any currently active version of the same definition name.
  update workflow_definitions
     set is_active = false, updated_at = now()
   where name = v_row.name and is_active = true and id <> p_id;

  -- Activate this version.
  update workflow_definitions
     set is_active = true,
         review_status = 'approved',
         deployed_at = now(),
         updated_at = now()
   where id = p_id
  returning * into v_row;

  insert into workflow_definition_audit_log
    (definition_id, definition_name, action, actor_id, version, reason)
  values
    (v_row.id, v_row.name, 'approve', v_actor_id, v_row.version, p_reason);

  return v_row;
end;
$$;

grant execute on function approve_workflow_definition(uuid, text) to authenticated;

-- ── reject_workflow_definition ────────────────────────────────────────────
-- Requires review-capable role (admin, editor, or reviewer); actor from JWT.

create or replace function reject_workflow_definition(
  p_id     uuid,
  p_reason text default null
)
returns workflow_definitions
security definer
set search_path = public
language plpgsql
as $$
declare
  v_claims_text text := current_setting('request.jwt.claims', true);
  v_claims      json;
  v_jwt_role    text;
  v_app_role    text;
  v_actor_id    text;
  v_row         workflow_definitions;
begin
  -- Safe JSON parse: absent/malformed claims means service_role / direct Postgres path.
  begin
    v_claims := nullif(v_claims_text, '')::json;
  exception when others then
    v_claims := null;
  end;

  v_jwt_role := coalesce(v_claims ->> 'role', '');
  v_app_role := coalesce(v_claims -> 'app_metadata' ->> 'role', '');
  v_actor_id := coalesce(v_claims ->> 'sub', '');

  -- Authorization guard: PostgREST authenticated sessions must have review-capable role.
  if v_jwt_role = 'authenticated' then
    if v_app_role not in ('admin', 'editor', 'reviewer') then
      raise insufficient_privilege
        using message =
          'reject_workflow_definition: app role ''' || coalesce(v_app_role, '') ||
          ''' is not authorized; requires admin, editor, or reviewer';
    end if;
  end if;

  update workflow_definitions
     set review_status = 'rejected', updated_at = now()
   where id = p_id and review_status = 'pending-review'
  returning * into v_row;

  if not found then
    raise exception 'definition % not found or is not pending review', p_id;
  end if;

  insert into workflow_definition_audit_log
    (definition_id, definition_name, action, actor_id, version, reason)
  values
    (v_row.id, v_row.name, 'reject', v_actor_id, v_row.version, p_reason);

  return v_row;
end;
$$;

grant execute on function reject_workflow_definition(uuid, text) to authenticated;
