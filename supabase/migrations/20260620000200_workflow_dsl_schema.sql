-- DSL workflow definition registry and audit tables.
-- See docs/specs/temporal-dsl-spec.md §12.

-- ── workflow_definitions ──────────────────────────────────────────────────

create table workflow_definitions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version      text not null,
  definition   jsonb not null,
  description  text,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,
  deployed_at  timestamptz,

  constraint uq_workflow_definitions_name_version unique (name, version),
  constraint chk_version_semver     check (version ~ '^\d+\.\d+\.\d+'),
  constraint chk_definition_structure check (
    definition ? 'name'
    and definition ? 'version'
    and definition ? 'steps'
  )
);

create trigger trg_workflow_definitions_updated_at
  before update on workflow_definitions
  for each row execute function update_updated_at();

-- Only one active version per name at a time.
create unique index uq_workflow_definitions_active
  on workflow_definitions (name) where is_active = true;

create index idx_workflow_definitions_name_active
  on workflow_definitions (name, is_active, deployed_at desc);

create index idx_workflow_definitions_fts
  on workflow_definitions using gin (
    to_tsvector('english', name || ' ' || coalesce(description, ''))
  );

-- ── decision_tables ───────────────────────────────────────────────────────

create table decision_tables (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version      text not null,
  description  text,
  inputs       jsonb not null default '[]',
  outputs      jsonb not null default '[]',
  hit_policy   text not null default 'first'
                 check (hit_policy in ('first', 'all', 'unique')),
  rules        jsonb not null default '[]',
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,
  deployed_at  timestamptz,

  constraint uq_decision_tables_name_version unique (name, version),
  constraint chk_dt_version_semver check (version ~ '^\d+\.\d+\.\d+')
);

create trigger trg_decision_tables_updated_at
  before update on decision_tables
  for each row execute function update_updated_at();

create unique index uq_decision_tables_active
  on decision_tables (name) where is_active = true;

-- ── workflow_executions ───────────────────────────────────────────────────

create table workflow_executions (
  id                  uuid primary key default gen_random_uuid(),
  workflow_id         text not null unique,
  run_id              text not null,
  definition_name     text not null,
  definition_version  text not null,
  status              text not null default 'running'
                        check (status in ('running','completed','failed','cancelled','timed_out')),
  current_step        text,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  input_payload       jsonb not null default '{}',
  output_payload      jsonb,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint fk_wf_exec_definition
    foreign key (definition_name, definition_version)
    references workflow_definitions (name, version)
);

create trigger trg_workflow_executions_updated_at
  before update on workflow_executions
  for each row execute function update_updated_at();

create index idx_wf_exec_definition on workflow_executions (definition_name, definition_version);
create index idx_wf_exec_status     on workflow_executions (status, started_at desc);
create index idx_wf_exec_workflow_id on workflow_executions (workflow_id);

-- ── workflow_signals ──────────────────────────────────────────────────────

create table workflow_signals (
  id          uuid primary key default gen_random_uuid(),
  workflow_id text not null,
  signal_name text not null,
  payload     jsonb not null default '{}',
  sent_by     text,
  sent_at     timestamptz not null default now(),

  constraint fk_wf_signal_execution
    foreign key (workflow_id) references workflow_executions (workflow_id)
);

create index idx_wf_signals_workflow_id on workflow_signals (workflow_id, sent_at desc);

-- ── Access control ────────────────────────────────────────────────────────

grant select on workflow_definitions, decision_tables, workflow_executions, workflow_signals
  to authenticated;

-- Write path for definitions is via deploy_workflow_definition() only.
-- Direct INSERT/UPDATE from authenticated clients is intentionally not granted.

-- ── deploy_workflow_definition ────────────────────────────────────────────

create or replace function deploy_workflow_definition(
  p_name    text,
  p_version text
)
returns workflow_definitions
security definer
language plpgsql
as $$
declare
  v_row workflow_definitions;
begin
  -- Deactivate current active version.
  update workflow_definitions
     set is_active = false, updated_at = now()
   where name = p_name and is_active = true;

  -- Activate the requested version and mark it deployed.
  update workflow_definitions
     set is_active = true, deployed_at = now(), updated_at = now()
   where name = p_name and version = p_version
  returning * into v_row;

  if not found then
    raise exception 'workflow definition % version % not found', p_name, p_version;
  end if;

  return v_row;
end;
$$;
