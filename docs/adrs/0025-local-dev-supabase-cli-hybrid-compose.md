# ADR-0025: Local Dev Stack — Supabase CLI + Docker Compose Hybrid

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The application stack has two distinct subsystems: the Supabase layer (Postgres, PostgREST, GoTrue auth, Storage, Studio, Realtime) and the application layer (Temporal server, Temporal worker, frontend). Both must run locally for development. Running all of Supabase via Docker Compose is possible but requires manually managing ~8 Supabase containers, their networking, and their startup ordering — the Supabase CLI already does this better.

## Decision

**Local development uses two orchestrators in sequence:**

1. **Supabase CLI** (`supabase start`) — manages all Supabase containers. Applies migrations and seed automatically. Exposes Postgres at `localhost:54322`, PostgREST at `localhost:54321`, Studio at `localhost:54323`.

2. **Docker Compose** (`docker compose up`) — manages the application layer: Temporal server, Temporal UI, Temporal worker, frontend. The worker reaches Supabase at `host.docker.internal:54321` (the host machine's Supabase endpoint visible from inside Docker containers on Mac/Windows; Linux requires `--add-host`).

**`make up`** runs both in sequence, exporting Supabase env vars (connection strings, anon key, service role key) via `scripts/supabase-env.sh` before starting Compose. **`make down`** tears both down. **`make reset`** does a full wipe and restart.

Supabase is intentionally not a Compose service — this avoids maintaining a parallel definition of the Supabase stack and keeps the two orchestrators' state separate.

## Consequences

**Positive:**
- `supabase start` manages all Supabase complexity (service ordering, health checks, migration application). Engineers get a full Supabase stack with a single command.
- Migrations and seed are applied automatically on `make up`. The local database is always at the current schema.
- `docker-compose.yml` stays small and readable — only the application layer.
- Supabase Studio at `localhost:54323` provides a UI for database inspection during development.

**Negative:**
- The `host.docker.internal` hostname works on Docker Desktop (Mac/Windows) but requires `extra_hosts: host-gateway` on Linux. This is documented but is a common developer pain point on Linux machines.
- Two orchestration tools means two sets of logs, two `down` commands wrapped by `make down`, and two sources of "why isn't this starting" debugging.
- The Supabase CLI's container management is opaque — when a Supabase service misbehaves, `supabase logs` (not `docker compose logs`) is the diagnostic path.

## Alternatives considered

**Full Docker Compose for everything (including Supabase):** Possible but requires maintaining all Supabase service definitions in `docker-compose.yml`. The Supabase team maintains a reference Compose file but it changes with each release. Using the CLI avoids this maintenance burden.

**Supabase Cloud for local dev:** Eliminates local Supabase setup entirely but requires a paid account and an internet connection for every local dev session. Not suitable for offline work or for developers in bandwidth-constrained environments.

**Devcontainer / Codespaces:** Valid complement to this approach but out of scope for the template. The hybrid Compose + CLI approach works without devcontainer support.

## Evidence

- `Makefile` — `up`, `down`, `reset` targets
- `docker-compose.yml` — application layer only (Temporal, worker, frontend)
- `scripts/supabase-env.sh` — exports Supabase env vars for Compose
- `DATABASE.md` — `supabase start` / `db reset` instructions
