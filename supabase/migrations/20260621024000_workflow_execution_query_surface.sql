-- Read/query surface for workflow execution UI list/detail screens.
-- Contract-aligned with:
--   GET /workflows/executions
--   GET /workflows/executions/:workflow_id

create or replace function public.get_workflow_executions(
  p_limit integer default 50,
  p_before_started_at timestamptz default null,
  p_before_workflow_id text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
with params as (
  select
    greatest(1, least(coalesce(p_limit, 50), 200)) as page_limit,
    -- Keep input previews compact for list views while remaining informative.
    160::integer as input_summary_limit
),
rows as (
  select
    we.workflow_id,
    we.definition_name,
    we.definition_version,
    we.status,
    we.started_at,
    we.completed_at,
    round(extract(epoch from (coalesce(we.completed_at, now()) - we.started_at))::numeric, 3) as duration,
    left(
      coalesce(
        nullif(we.input_payload->>'summary', ''),
        nullif(we.input_payload->>'prompt', ''),
        nullif(we.input_payload->>'domain', ''),
        nullif(we.input_payload->>'name', ''),
        nullif(we.input_payload->>'id', ''),
        nullif(we.input_payload::text, '{}')
      ),
      (select input_summary_limit from params)
    ) as input_summary,
    we.updated_at
  from workflow_executions we
  where
    p_before_started_at is null
    or (
      p_before_workflow_id is null
      and we.started_at < p_before_started_at
    )
    or (
      p_before_workflow_id is not null
      and (we.started_at, we.workflow_id) < (p_before_started_at, p_before_workflow_id)
    )
  order by we.started_at desc, we.workflow_id desc
  limit (select page_limit from params)
),
page as (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'workflow_id', workflow_id,
          'definition_name', definition_name,
          'definition_version', definition_version,
          'status', status,
          'started_at', started_at,
          'completed_at', completed_at,
          'duration', duration,
          'input_summary', input_summary
        )
        order by started_at desc, workflow_id desc
      ),
      '[]'::jsonb
    ) as items,
    case
      when count(*) >= (select page_limit from params)
        then (array_agg(started_at order by started_at desc, workflow_id desc))[(select page_limit from params)]
      else null
    end as next_before_started_at,
    case
      when count(*) >= (select page_limit from params)
        then (array_agg(workflow_id order by started_at desc, workflow_id desc))[(select page_limit from params)]
      else null
    end as next_before_workflow_id,
    max(updated_at) as cursor,
    count(*) as returned_count
  from rows
)
select jsonb_build_object(
  'data', page.items,
  'meta', jsonb_build_object(
    'as_of', now(),
    'poll', jsonb_build_object('cursor', page.cursor),
    'stream', jsonb_build_object('cursor', page.cursor),
    'pagination', jsonb_build_object(
      'next_before_started_at', page.next_before_started_at,
      'next_before_workflow_id', page.next_before_workflow_id,
      'returned', page.returned_count
    )
  )
)
from page;
$$;

create or replace function public.get_workflow_execution_detail(
  p_workflow_id text
)
returns jsonb
language sql
stable
set search_path = public
as $$
with base as (
  select
    we.workflow_id,
    we.run_id,
    we.definition_name,
    we.definition_version,
    we.status,
    we.current_step,
    we.started_at,
    we.completed_at,
    round(extract(epoch from (coalesce(we.completed_at, now()) - we.started_at))::numeric, 3) as duration,
    we.input_payload,
    we.output_payload,
    we.error_message,
    we.updated_at
  from workflow_executions we
  where we.workflow_id = p_workflow_id
  limit 1
),
output_trace_source as (
  select
    b.workflow_id,
    e.value as item,
    e.ordinality as ord
  from base b
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(b.output_payload->'step_trace') = 'array' then b.output_payload->'step_trace'
      when jsonb_typeof(b.output_payload->'trace') = 'array' then b.output_payload->'trace'
      else '[]'::jsonb
    end
  ) with ordinality as e(value, ordinality)
),
output_trace as (
  select
    workflow_id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source', 'execution_output',
          'index', ord,
          'step', coalesce(item->>'step', item->>'step_name', item->>'name'),
          'status', item->>'status',
          'event', item
        )
        order by ord
      ),
      '[]'::jsonb
    ) as entries
  from output_trace_source
  group by workflow_id
),
signal_trace as (
  select
    ws.workflow_id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source', 'signal_audit',
          'signal_name', ws.signal_name,
          'sent_at', ws.sent_at,
          'sent_by', ws.sent_by,
          'payload', ws.payload
        )
        order by ws.sent_at asc
      ),
      '[]'::jsonb
    ) as entries
  from workflow_signals ws
  where ws.workflow_id = p_workflow_id
  group by ws.workflow_id
),
trace_entries as (
  select
    b.workflow_id,
    coalesce(ot.entries, '[]'::jsonb) || coalesce(st.entries, '[]'::jsonb) as entries
  from base b
  left join output_trace ot on ot.workflow_id = b.workflow_id
  left join signal_trace st on st.workflow_id = b.workflow_id
),
detail as (
  select jsonb_build_object(
    'workflow_id', b.workflow_id,
    'run_id', b.run_id,
    'definition_name', b.definition_name,
    'definition_version', b.definition_version,
    'status', b.status,
    'current_step', b.current_step,
    'started_at', b.started_at,
    'completed_at', b.completed_at,
    'duration', b.duration,
    'input_payload', b.input_payload,
    'final_variables', coalesce(b.output_payload->'variables', b.output_payload->'final_variables', '{}'::jsonb),
    'final_output_payload', coalesce(b.output_payload->'output', b.output_payload->'final_output', b.output_payload),
    'trace_entries', coalesce(t.entries, '[]'::jsonb),
    'failure', case
      when b.status in ('failed', 'timed_out', 'cancelled') or b.error_message is not null then jsonb_build_object(
        'error_message', b.error_message,
        'status', b.status,
        'raw', coalesce(b.output_payload->'error', '{}'::jsonb)
      )
      else null
    end,
    'llm_agent', jsonb_build_object(
      'provider', coalesce(
        b.output_payload#>>'{llm_agent,provider}',
        b.output_payload#>>'{provider}'
      ),
      'model', coalesce(
        b.output_payload#>>'{llm_agent,model}',
        b.output_payload#>>'{model}'
      ),
      'prompt_tokens', coalesce(
        (b.output_payload#>>'{llm_agent,prompt_tokens}')::integer,
        (b.output_payload#>>'{prompt_tokens}')::integer
      ),
      'completion_tokens', coalesce(
        (b.output_payload#>>'{llm_agent,completion_tokens}')::integer,
        (b.output_payload#>>'{completion_tokens}')::integer
      ),
      'tool_call_rounds', coalesce(
        (b.output_payload#>>'{llm_agent,tool_call_rounds}')::integer,
        case
          when jsonb_typeof(b.output_payload#>'{llm_agent,tool_calls}') = 'array'
            then jsonb_array_length(b.output_payload#>'{llm_agent,tool_calls}')
          else null
        end
      ),
      'parsed_output', coalesce(
        b.output_payload#>'{llm_agent,parsed}',
        b.output_payload#>'{parsed}'
      ),
      'retries', coalesce(
        (b.output_payload#>>'{llm_agent,retries}')::integer,
        (b.output_payload#>>'{retries}')::integer,
        0
      ),
      'error_state', (
        b.status in ('failed', 'timed_out', 'cancelled')
        or b.error_message is not null
        or coalesce((b.output_payload#>>'{llm_agent,error_state}')::boolean, false)
      )
    )
  ) as data,
  b.updated_at as cursor
  from base b
  left join trace_entries t on t.workflow_id = b.workflow_id
)
select case
  when exists (select 1 from detail) then jsonb_build_object(
    'data', (select d.data from detail d),
    'meta', jsonb_build_object(
      'as_of', now(),
      'poll', jsonb_build_object('cursor', (select d.cursor from detail d)),
      'stream', jsonb_build_object('cursor', (select d.cursor from detail d))
    )
  )
  else jsonb_build_object(
    'data', null,
    'meta', jsonb_build_object(
      'as_of', now(),
      'poll', jsonb_build_object('cursor', null),
      'stream', jsonb_build_object('cursor', null)
    )
  )
end;
$$;

revoke all on function public.get_workflow_executions(integer, timestamptz, text) from public;
revoke all on function public.get_workflow_execution_detail(text) from public;

grant execute on function public.get_workflow_executions(integer, timestamptz, text) to authenticated, service_role;
grant execute on function public.get_workflow_execution_detail(text) to authenticated, service_role;
