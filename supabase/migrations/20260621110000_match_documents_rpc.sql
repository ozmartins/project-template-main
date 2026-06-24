-- Add match_documents RPC for the documents semantic-search table.
--
-- public.documents is created by 20260621034100_pgvector_documents.sql; this
-- migration only adds the RPC and locks down access.  If pgvector is not
-- available (documents table absent), the block exits with a NOTICE and the
-- migration succeeds with no error.
--
-- Access control:
--   PostgreSQL functions grant EXECUTE to PUBLIC by default.  This migration
--   explicitly revokes that grant so the function cannot be reached by any
--   PostgREST client or unauthenticated session, then removes anon and
--   authenticated as a belt-and-suspenders measure.  Only service_role (the
--   Temporal worker superuser path) retains execute rights.

do $$
declare
  r text;
begin
  if to_regclass('public.documents') is null then
    raise notice 'SKIP: public.documents not present (pgvector unavailable); '
                 'match_documents RPC not created.';
    return;
  end if;

  -- ── match_documents RPC ───────────────────────────────────────────────────
  -- Callable as: supabase.rpc('match_documents', { query_embedding, match_threshold, match_count })
  -- The parameter uses the base 'vector' type (no dimension modifier) so that
  -- REVOKE statements remain valid if the column dimension ever changes.
  -- Callers must supply a 1536-dimensional vector to match public.documents.embedding;
  -- pgvector will raise an error at runtime if dimensions differ.
  execute $ddl$
    create or replace function public.match_documents(
      query_embedding  vector,
      match_threshold  float   default 0.0,
      match_count      int     default 10
    )
    returns table (
      id          uuid,
      content     text,
      similarity  float
    )
    language sql stable
    as $fn$
      select
        id,
        content,
        1 - (embedding <=> query_embedding) as similarity
      from public.documents
      where 1 - (embedding <=> query_embedding) > match_threshold
      order by embedding <=> query_embedding
      limit match_count;
    $fn$
  $ddl$;

  -- ── Access control ────────────────────────────────────────────────────────
  -- Revoke the default PUBLIC execute grant that PostgreSQL applies to all
  -- new functions.  anon and authenticated are also denied explicitly.
  -- service_role retains access via the superuser bypass path.
  execute 'revoke execute on function public.match_documents(vector, float, int) from public';

  foreach r in array array['authenticated', 'anon'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.match_documents(vector, float, int) from %I', r);
    end if;
  end loop;

end $$;
