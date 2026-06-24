-- email_imports — per-message tracking for the email-order-import workflow.
--
-- One row per Gmail message processed by the `email-order-import` DSL workflow,
-- recording the terminal outcome (imported / ignored+reason / error). This is the
-- status surface behind the SPEC's /imports/email-orders/{id} view and provides
-- idempotency via the unique (gmail_account, message_id) key used by the workflow's
-- supabase_mutate upsert.
--
-- Additive migration only (see ADR-0024). Mirrors the access posture of
-- workflow_executions: read access for `authenticated`; the Temporal worker writes
-- with the service-role key, which bypasses RLS/grants.

create table email_imports (
  id            uuid primary key default gen_random_uuid(),
  gmail_account text not null,
  message_id    text not null,
  status        text not null default 'imported'
                  check (status in ('imported','ignored','error')),
  ignore_reason text,
  order_ref     text,
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint uq_email_imports_account_message unique (gmail_account, message_id)
);

create trigger trg_email_imports_updated_at
  before update on email_imports
  for each row execute function update_updated_at();

create index idx_email_imports_account on email_imports (gmail_account, created_at desc);
create index idx_email_imports_status  on email_imports (status, created_at desc);

grant select on email_imports to authenticated;
