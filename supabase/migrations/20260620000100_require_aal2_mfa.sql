-- Enforce MFA (assurance level aal2) at the data layer.
-- PostgREST runs this as a db-pre-request hook for every request; an
-- `authenticated` session whose JWT is not aal2 (i.e. password-only, MFA not
-- completed) is rejected before any data is touched. service_role and internal
-- paths pass; the Temporal worker connects directly as a superuser (not via
-- PostgREST) and is unaffected. Pairs with the frontend aal2 gate
-- (frontend/src/auth/). See ADR-0034.

create or replace function public.require_aal2() returns void
  language plpgsql stable
  as $fn$
declare
  v_claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
  v_role   text := coalesce(v_claims ->> 'role', '');
  v_aal    text := coalesce(v_claims ->> 'aal', '');
begin
  if v_role = 'authenticated' and v_aal <> 'aal2' then
    raise insufficient_privilege using message = 'MFA required: this session is not aal2';
  end if;
end;
$fn$;

-- Grants + pre-request wiring, guarded so this also runs on plain-Postgres CI
-- (where the PostgREST roles do not exist).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.require_aal2() to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.require_aal2() to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.require_aal2() to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.require_aal2''';
  end if;
end $$;

notify pgrst, 'reload config';
