# ADR-0015: Self-Hosted Supabase as the Database and Auth Layer

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The template needs a Postgres database, a REST/GraphQL API layer, and an auth system. Options range from managed cloud databases to self-hosted open-source stacks. The choice must work locally (in Docker Compose) and in Kubernetes production, without requiring a paid cloud database account just to run locally.

## Decision

Use [Supabase](https://supabase.com) — the open-source self-hostable stack — as the database and auth layer. This provides:

- **Postgres** as the underlying database (all schema/migration work is standard SQL)
- **PostgREST** for auto-generated REST API from the Postgres schema (used by the frontend data layer)
- **GoTrue** for auth (JWT issuance, magic links, OAuth providers)
- **Supabase Studio** for local database inspection during development
- **Realtime** for optional subscription-based live queries

**Local development:** Supabase runs via the Supabase CLI (`supabase start`), managed separately from Docker Compose (see ADR-0020). The Supabase CLI handles migrations and seed application on reset.

**Production:** Supabase is deployed in-cluster via Helm (see ADR-0016) or as a managed Supabase Cloud instance. The template is compatible with both; swap the connection strings.

The frontend connects to Supabase via the `@supabase/supabase-js` client using the anonymous key and PostgREST. Write operations that require elevated privilege use SECURITY DEFINER RPCs (see ADR-0022).

## Consequences

**Positive:**
- Full local dev stack with no cloud account required. `supabase start` brings up Postgres + API + Auth + Studio.
- Standard Postgres underneath — all SQL knowledge, tooling (psql, pgAdmin, pg_dump), and libraries apply. No proprietary query language.
- The anonymous key + RLS model gives a safe default for frontend data access. Tables are denied by default; RLS policies selectively open access.
- PostgREST eliminates the need to write CRUD endpoints for straightforward data access patterns.
- Open source — no vendor lock-in on the database layer. The Postgres schema is portable.

**Negative:**
- Self-hosting Supabase in production is more operational work than using Supabase Cloud. Requires managing the Supabase Helm chart, connection pooling (PgBouncer), and backup strategy.
- PostgREST auto-generation means the API shape is derived from the schema. Breaking schema changes break the API without a deployment gate. Schema design must be API-aware.
- Supabase Auth is opinionated about session management (JWTs, storage in `localStorage` or cookies). Projects with complex auth requirements (OIDC federation, enterprise SSO) need additional adapter work.

## Alternatives considered

**Supabase Cloud (managed):** Simpler to operate but introduces a paid dependency from day one and prevents fully offline local dev. Not suitable as a template default.

**Plain Postgres + custom REST API:** Portable but requires writing all CRUD endpoints manually. PostgREST eliminates significant boilerplate for the typical read-heavy frontend pattern.

**Firebase / PlanetScale / Neon:** Managed-only options with proprietary query layers or limited local dev support. Postgres portability is a hard requirement.

## Evidence

- `supabase/config.toml` — project and auth configuration
- `supabase/migrations/` — schema migrations (standard SQL)
- `supabase/seed.sql` — demo baseline seed
- `Makefile` — `supabase start` / `supabase stop` integration
- `docker-compose.yml` — worker connects to Supabase at `host.docker.internal:54321`
