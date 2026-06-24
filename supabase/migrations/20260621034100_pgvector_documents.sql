-- pgvector may be unavailable in some CI/local postgres environments; skip gracefully there.
do $$
begin
  begin
    create extension if not exists vector;
  exception
    -- 0A000: feature_not_supported, 58P01: undefined_file (missing extension control file)
    when sqlstate '0A000' or sqlstate '58P01' then
      -- Without pgvector installed, the vector-backed documents table is intentionally not created.
      raise notice 'Skipping pgvector documents migration: extension "vector" is not available';
      return;
  end;

  create table if not exists public.documents (
    id uuid primary key default gen_random_uuid(),
    content text not null,
    embedding vector(1536) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists idx_documents_embedding_hnsw
    on public.documents
    using hnsw (embedding vector_cosine_ops);

  drop trigger if exists trg_documents_updated_at on public.documents;
  create trigger trg_documents_updated_at
  before update on public.documents
  for each row execute function update_updated_at();

  -- documents are backend-owned; do not expose direct table access to API roles.
  revoke all on table public.documents from anon;
  revoke all on table public.documents from authenticated;
  grant select, insert, update, delete on table public.documents to service_role;
end $$;
