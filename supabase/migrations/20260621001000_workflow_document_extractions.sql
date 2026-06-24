create table if not exists workflow_document_extractions (
  id               uuid primary key default gen_random_uuid(),
  source_url       text not null unique,
  extracted_fields jsonb not null,
  confidence       double precision,
  extracted_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_workflow_document_extractions_updated_at
  before update on workflow_document_extractions
  for each row execute function update_updated_at();

revoke INSERT, UPDATE, DELETE on table workflow_document_extractions from authenticated, anon;
