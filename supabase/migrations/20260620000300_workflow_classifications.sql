create table if not exists workflow_classifications (
  id              uuid primary key default gen_random_uuid(),
  domain          text not null unique,
  name            text not null,
  domain_active   boolean not null default false,
  lifecycle_stage text,
  vertical        text,
  sub_vertical    text,
  classification_tags jsonb,
  confidence      double precision,
  classified_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_workflow_classifications_updated_at
  before update on workflow_classifications
  for each row execute function update_updated_at();
