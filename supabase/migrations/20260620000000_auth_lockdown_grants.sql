-- Auth lockdown: unauthenticated (anon) gets NO access to application data;
-- only authenticated (logged-in) sessions may use the app.
--
-- PostgREST switches to the `anon` role for unauthenticated requests and
-- `authenticated` for valid-JWT requests, so role grants are the enforcement
-- point. The Temporal worker connects directly to Postgres as a superuser (not
-- via PostgREST) and is unaffected. See ADR-0034 for the role model, ADR-0023
-- for the SECURITY DEFINER write path.
--
-- Idempotent: safe to re-run.

-- 0. Ensure the PostgREST roles exist. On the live Supabase stack these are
--    created by the platform; in plain-Postgres CI they are absent, so create
--    them as NOLOGIN no-ops to keep this migration self-contained.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

-- 1. Strip all unauthenticated access on the application schema.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all tables in schema public from public;       -- pseudo-role inheritance
revoke usage on schema public from anon;
-- The `public` pseudo-role is granted USAGE on `public` schema by default in
-- Postgres; anon inherits it via the pg_roles membership chain. Strip it so
-- has_schema_privilege('anon') returns false and unauthenticated sessions truly
-- cannot resolve any objects.
revoke usage on schema public from public;

-- 2. Authenticated (logged-in) users may operate the application.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- 2b. service_role is used by Temporal workers, Edge Functions, and admin tooling.
--     It bypasses RLS but still needs explicit object grants (Postgres GRANT ≠ RLS bypass).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'grant usage, select on all sequences in schema public to service_role';
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;

-- 3. Apply the same posture to objects created by future migrations.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
-- service_role default privileges (applies to objects created by future migrations)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'alter default privileges in schema public grant select, insert, update, delete on tables to service_role';
    execute 'alter default privileges in schema public grant usage, select on sequences to service_role';
    execute 'alter default privileges in schema public grant execute on functions to service_role';
  end if;
end $$;
