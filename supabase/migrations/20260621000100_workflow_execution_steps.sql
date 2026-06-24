-- Step-level execution trace for DSL workflow runs.
-- Each activity step in a running DSL workflow writes one row here via
-- the record_step Temporal activity.

create table workflow_execution_steps (
  id             uuid        primary key default gen_random_uuid(),
  workflow_id    text        not null references workflow_executions (workflow_id),
  step_index     int         not null,
  step_name      text        not null,
  status         text        not null
                               check (status in ('running', 'completed', 'failed', 'skipped')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  duration_ms    int,
  input_preview  jsonb,
  output_preview jsonb,
  error_message  text,

  constraint uq_wf_steps_workflow_step unique (workflow_id, step_index)
);

create index idx_wf_steps_workflow_id on workflow_execution_steps (workflow_id, step_index);
create index idx_wf_steps_status      on workflow_execution_steps (status, started_at desc);

grant select on workflow_execution_steps to authenticated;
