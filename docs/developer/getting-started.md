# Getting Started — Local Development

This guide walks a new contributor through bootstrapping the full stack locally: Supabase (auth + database + API), Temporal (workflow orchestration), and the React frontend. After following these steps you will have everything running on your machine and be ready to make changes.

> For cloud deployment, Helm chart configuration, and Kubernetes targets see `docs/specs/platform-deployment-spec.md`.

---

## Prerequisites

Install these tools before you begin. The versions below are the minimum tested.

| Tool | Minimum version | Notes |
|---|---|---|
| [Docker Desktop](https://docs.docker.com/get-docker/) | 4.x with Compose v2 | Required; `make up` relies on `docker compose` (v2 syntax) |
| `make` | any | macOS ships it; install via `xcode-select --install` if missing |
| [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) | 1.x | `brew install supabase/tap/supabase` (macOS) or see docs |
| [Node.js](https://nodejs.org/) | 18+ | Required for frontend dev, `make setup`, and `make bootstrap-users` |
| [lefthook](https://github.com/evilmartians/lefthook) | any | `brew install lefthook` — installed by `make setup` if absent |
| [gitleaks](https://github.com/gitleaks/gitleaks) | any | `brew install gitleaks` — installed by `make setup` if absent |

> **Linux note:** Docker Desktop on Linux exposes Supabase at `host.docker.internal` only if Docker is configured with `--add-host=host-gateway`. If the frontend or worker cannot reach Supabase from inside Docker, see the [Troubleshooting guide](../troubleshooting.md).

---

## First-run setup

Run these steps once after cloning. They install git hooks, pull Node dependencies for the frontend and Temporal worker, and set up your local environment file.

```bash
# 1. Copy the example environment file
cp .env.example .env

# 2. Install git hooks (lefthook + gitleaks) and npm deps for frontend and Temporal
make setup
```

If you want classic local Temporal naming instead of the default dev-K8s naming, create `.env.temporal` and set:

```bash
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=main
```

`make setup` installs `lefthook` and `gitleaks` via Homebrew if they are not already present (macOS), runs `lefthook install`, and runs `npm install` inside both `frontend/` and `temporal/`.

---

## Starting the stack

```bash
make up
```

`make up` runs two orchestrators in sequence:

1. **`supabase start --exclude studio`** — the Supabase CLI starts all Supabase containers (Postgres, PostgREST/API, GoTrue/Auth, Storage). Migrations in `supabase/migrations/` and the seed in `supabase/seed.sql` are applied automatically. Studio is excluded because it has no authentication; use `make bootstrap-users` to create dev users instead.

2. **`docker compose up -d`** — starts the application layer: Temporal server, Temporal UI, Temporal worker, and the frontend. Supabase connection strings and API keys are injected automatically from `scripts/supabase-env.sh` before Compose starts.

When the command finishes you will see:

```
Stack up. Frontend http://localhost:3000 | Temporal UI http://localhost:8081
Run 'make bootstrap-users' to create dev users.
```

### Service endpoints

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:3000 | React app |
| Temporal UI | http://localhost:8081 | Workflow inspection |
| Supabase API (PostgREST) | http://localhost:54321 | REST + Auth endpoint |
| Supabase Postgres | `localhost:54322` | Direct Postgres access |

### HTTPS overlay (optional)

`make up-https` starts an additional Traefik TLS proxy on `https://localhost` with a self-signed cert generated automatically on first run. Use this when testing flows that require HTTPS (e.g. OAuth redirects). See `README.md` for the full port map.

---

## Creating dev users

After `make up` you need at least one user to log in. The `bootstrap-users` script creates a fixed set of dev accounts with known credentials and TOTP secrets (MFA is enforced by the schema).

```bash
make bootstrap-users
```

The script prints each user's email, password, and TOTP URI. Use an authenticator app or `oathtool` to generate the TOTP code on login. Re-running the script resets all credentials.

---

## Verifying the stack

Check that all services are healthy:

```bash
make supabase-status   # shows Supabase URLs, anon key, service role key
docker compose ps      # shows Temporal, worker, frontend container states
```

Tail logs from a specific layer:

```bash
make logs              # all Compose services
make logs-temporal     # Temporal server + worker only
make logs-frontend     # frontend only
```

For Supabase container logs use `supabase logs` (not `docker compose logs`) because Supabase containers are managed by the CLI, not by Compose.

---

## Stopping and resetting

```bash
make down    # stop all services (Compose + Supabase)
make reset   # full wipe: tear down volumes, stop Supabase, and restart from scratch
```

`make reset` is the fastest way to recover from a broken database state or a failed migration. It runs `make down -v` (removes Compose volumes), `supabase stop --no-backup`, then `make up`, which re-applies all migrations and the seed.

To reset only the database without restarting all services:

```bash
supabase db reset
```

This re-runs all migrations and seed against the running Supabase instance without touching the Temporal or frontend containers.

---

## Live-reload mode

Prefix `make up` with `USE_DEV=1` to mount source directories into the containers for hot-reload:

```bash
USE_DEV=1 make up
```

This activates `docker-compose.dev.yml` in addition to `docker-compose.yml`, which binds `frontend/` and `temporal/src/` into their respective containers so changes are picked up without a rebuild.

---

## Key configuration files

These are the files a new contributor is most likely to need to touch first.

| File | Purpose |
|---|---|
| `.env` | Local runtime secrets and service URLs — copy from `.env.example` once, then edit as needed. **Never commit this file.** |
| `.env.example` | Template for `.env` with all expected variables and inline documentation. Start here. |
| `.env.temporal` | Optional local override for Temporal namespace/task queue naming used by `docker-compose.yml`. **Never commit this file.** |
| `.env.temporal.example` | Template with Temporal namespace/task queue defaults aligned to dev Kubernetes naming (`10x-stack-dev` / `10x-stack-dev-main`). |
| `supabase/config.toml` | Supabase CLI project configuration: Auth settings, email templates, local port assignments. See `supabase/` for details. |
| `supabase/migrations/` | Ordered SQL migrations. Add new files here; never edit shipped migrations. |
| `supabase/seed.sql` | Baseline seed data applied after migrations on `make up` and `supabase db reset`. |
| `docker-compose.yml` | Application layer services (Temporal, worker, frontend). Does **not** include Supabase containers. |
| `docker-compose.dev.yml` | Dev overrides — live-reload volume mounts. Applied automatically with `USE_DEV=1 make up`. |

### Environment variable quick reference

Most variables in `.env` come with documentation comments. The ones most relevant on first run:

**Supabase**

| Variable | Default | When to change |
|---|---|---|
| `SUPABASE_URL` | `http://host.docker.internal:54321` | Only if Supabase is not reachable from inside Docker (e.g. Linux host networking quirk) |
| `VITE_SUPABASE_URL` | `http://localhost:54321` | Only if you change the Supabase CLI listen port in `supabase/config.toml` |
| `SUPABASE_ANON_KEY` | `injected-by-make-up` | Injected automatically; only fill in if running `docker compose up` directly without `make` |
| `VITE_SUPABASE_ANON_KEY` | `injected-by-make-up` | Same key as above, but surfaced to the browser via Vite. Injected automatically by `make up`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `injected-by-make-up` | Injected automatically by `make up`; only fill in for direct `docker compose up` runs |
| `VITE_API_URL` | `http://localhost:54321/functions/v1` | Base URL for Supabase Edge Functions, used by the frontend's workflow trigger route. Only change if you remap the Supabase API port. |

**Temporal**

| Variable | Default | When to change |
|---|---|---|
| `TEMPORAL_ADDRESS` | `temporal:7233` | Docker Compose service name — only change if the service name in `docker-compose.yml` changes |
| `TEMPORAL_NAMESPACE` | `10x-stack-dev` (`.env.temporal.example`) | Set to `default` in `.env.temporal` if you want classic local Temporal naming |
| `TEMPORAL_TASK_QUEUE` | `10x-stack-dev-main` (`.env.temporal.example`) | Set to `main` in `.env.temporal` if you want classic local Temporal naming |
| `VITE_WORKFLOW_API_URL` | `http://localhost:3001` | URL the browser uses to reach the Temporal worker HTTP server — change if you remap port `3001` |

**LLM / AI activities**

| Variable | Default | When to change |
|---|---|---|
| `PIAGENT_PROVIDER` | `anthropic` | Change to `openai`, `amazon-bedrock`, `google`, etc. to swap the LLM backend for the `llm_agent` activity |
| `PIAGENT_MODEL_ID` | `claude-sonnet-4-6` | Override the specific model used by the chosen provider (e.g. `gpt-4o-mini` for OpenAI, or the Azure deployment name such as `gpt-4o` for Azure OpenAI) |
| `ANTHROPIC_API_KEY` | _(empty)_ | Fill in to enable LLM activities using the Anthropic provider |
| `OPENAI_API_KEY` | _(empty)_ | Fill in when `PIAGENT_PROVIDER=openai` |
| `EXA_API_KEY` | _(empty)_ | Fill in to enable the `web_search` and `web_crawl` activities; without it those activities return empty results gracefully |

Other provider keys (`AZURE_OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `GOOGLE_API_KEY`, etc.) are documented with inline comments in `.env.example`.

---

## How the pieces fit together

```
Browser
  └── Frontend (http://localhost:3000)
        ├── Supabase Auth  → GoTrue  (http://localhost:54321/auth/v1)
        ├── Supabase Data  → PostgREST (http://localhost:54321/rest/v1)
        └── Workflow API   → Temporal worker HTTP server (http://localhost:3001)
                                └── Temporal server (localhost:7234)
                                      └── Activities reach Supabase at
                                          http://host.docker.internal:54321
```

- **Supabase** is the source of truth for auth tokens, user data, and application entities. The database schema is managed via migrations in `supabase/migrations/`.
- **Temporal worker** (`temporal/src/worker.ts`) connects to the Temporal server over `TEMPORAL_ADDRESS` and registers all workflow and activity implementations. It also exposes a small HTTP server (port `3001`) used by the frontend to start workflows.
- **Frontend** (`frontend/src/`) is a Vite + React app using TanStack Router and TanStack Query. The JSON-driven UI engine in `frontend/src/engine/` renders screens from configuration objects — see the engine source and `docs/developer/README.md` for the full guide index.

---

## Running tests

```bash
# Frontend unit tests (Vitest)
npm --prefix frontend test

# Temporal worker unit tests
npm --prefix temporal test

# Lint both packages in one command (mirrors CI)
make lint

# Temporal worker lint + typecheck
npm --prefix temporal run lint
npm --prefix temporal run typecheck

# Frontend lint + build (matches CI)
npm --prefix frontend run lint
npm --prefix frontend run build
```

---

## Further reading

- [`README.md`](../../README.md) — top-level overview, HTTPS overlay, make target reference
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — branch and PR workflow, commit conventions, review expectations
- [`DATABASE.md`](../../DATABASE.md) — schema conventions, SCD2 versioning, migration workflow
- [`Guide_for_agents_using_supabase_template.md`](../../Guide_for_agents_using_supabase_template.md) — Supabase template conventions used throughout the codebase
- [`docs/troubleshooting.md`](../troubleshooting.md) — common local-dev failures and fixes
- [`docs/adrs/0025-local-dev-supabase-cli-hybrid-compose.md`](../adrs/0025-local-dev-supabase-cli-hybrid-compose.md) — why the stack uses two orchestrators (Supabase CLI + Compose)
- [`docs/adrs/0015-self-hosted-supabase.md`](../adrs/0015-self-hosted-supabase.md) — rationale for self-hosted Supabase
- [`docs/developer/README.md`](README.md) — full index of developer guides
- [`docs/specs/platform-deployment-spec.md`](../specs/platform-deployment-spec.md) — cloud deployment (AKS, EKS)
