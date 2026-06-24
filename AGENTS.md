# Repository Guidelines

## Foundational reference
- [`docs/vision.md`](docs/vision.md) — Read this before acting on any ticket. These principles govern all decisions.

## Project Structure & Module Organization
- Docs live at the repo root (`README.md`, `Guide_for_agents_using_supabase_template.md`, `DATABASE.md`, `Generalisable_schema.md`) and are the fastest way to understand the schema and roadmap. Reusable doc templates live under `doc_templates/`.
- Supabase assets sit in `supabase/`: `config.toml` (CLI config), `migrations/*.sql` (ordered by timestamp), and `seed.sql` (loads after migrations).
- Application code is checked in: `frontend/` (Vite + React + TanStack, JSON-driven UI engine under `src/engine/`) and `temporal/` (Python Temporal worker under `src/`).
- Migrations follow a modular pattern (`core` model first, `analytics` next). Keep new domain-specific tables in new migration files rather than editing shipped ones.

## Build, Test, and Development Commands
- `supabase start` — Launch local Supabase stack (Postgres, Studio, API, Realtime) using `supabase/config.toml`. Requires Docker and the Supabase CLI.
- `supabase db reset --config supabase/config.toml` — Recreate the local database, apply all migrations in order, then run `seed.sql`. Run before opening a PR to ensure migrations stay green.
- Full stack (Supabase stub + Temporal + frontend) — use the Makefile wrappers: `make up` to start (`USE_DEV=1 make up` for live-reload), `make down` to stop, `make reset` to tear down volumes and recreate. These wrap `docker compose -f docker-compose.yml` (plus `docker-compose.dev.yml` when `USE_DEV=1`).

## Coding Style & Naming Conventions
- SQL uses snake_case with UUID primary keys (`default gen_random_uuid()`), timestamp columns `created_at`/`updated_at`, and booleans like `is_current` for SCD2 status.
- Prefer `jsonb` for flexible payloads (`entity_versions.data`, `time_series_points.data`); use numeric facts in `entity_facts` with clear `fact_type` references.
- Migration files are timestamped `YYYYMMDDHHMMSS_description.sql`; keep them idempotent where practical (`create table if not exists`) and group related changes together.

## Testing Guidelines
- There is no automated test suite yet; rely on the Supabase CLI for safety checks. Run `supabase db reset --config supabase/config.toml` to verify migrations and seeds apply cleanly.
- For manual QA, start the stack (`supabase start`), connect via `psql` or Supabase Studio, and spot-check new tables/functions before committing.

## Logging Guidelines
- **One-line rule:** All log messages should be formatted as single-line entries rather than spanning multiple lines. This ensures grep efficiency and makes log parsing easier.
- If a `docs/Logging.md` file exists in this repository, follow those formatting and conventions instead of the one-line rule above.
- Single-line logs improve searchability, enable efficient filtering with standard Unix tools, and simplify automated log analysis.

## Commit & Pull Request Guidelines
- Git history favors short, imperative subjects (e.g., “Renamed parent_entity_id…”, “Add project overview”) with the occasional `feat:` prefix. Keep subjects ≤72 characters; add context in the body when needed.
- In PR descriptions, include: purpose, summary of schema changes (tables, columns, constraints), migration file names, seed data impact, and any follow-up tasks. Link issues if applicable; screenshots are only needed when UI changes are involved.

## Security & Configuration Tips
- Do not commit secrets (JWT signing keys, Twilio tokens, etc.). Use environment variables referenced in `supabase/config.toml` comments.
- Keep production and local configs separate; avoid hard-coding URLs or credentials inside migration files or seeds.

## Infrastructure & Deployment Environment
**Read `README.md` first** — it links the full deployment spec at `docs/specs/platform-deployment-spec.md`.

Key facts every agent must know before touching infrastructure:
- **Three targets:** Docker Desktop (local), Azure AKS (`aks-selfheal-staging`, `rg-selfheal-staging`, `eastus2`), AWS EKS (`dev-eks-cluster`, `us-east-1`). All differences are minimized and documented.
- **IaC baseline:** Use Terraform for all infrastructure. Ad-hoc `kubectl` or `aws` commands are only for diagnosis, never for provisioning. Terraform state is in S3 (`10x-stack-tfstate-354918379520`) and Azure blob storage.
- **Terraform layout:** `terraform/platform/aws-staging/` and `terraform/platform/azure-staging/` provision shared cluster services (Temporal, ESO, node groups). `terraform/stacks/10x-stack-aws-dev/` and `terraform/stacks/10x-stack-dev/` provision per-app stacks via the `terraform/modules/app-instance/` reusable module.
- **Temporal:** Use the local `charts/temporal/` wrapper chart (wraps `temporalio/server:1.25.0` via `temporalio/temporal-0.46.0`). Do NOT use the Temporal Cloud or a remote Helm repo. On AKS use `values-dev.yaml`; on EKS use `values-aws-dev.yaml` (no Istio PeerAuthentication).
- **Container registry:** Azure uses ACR (`acrselfhealstg.azurecr.io`) with `acr-pull` imagePullSecret. AWS uses ECR (`354918379520.dkr.ecr.us-east-1.amazonaws.com`) — node IAM role handles auth, no pull secret needed.
- **Secrets:** OpenBao + External Secrets Operator. Never use plain Kubernetes secrets for app credentials. Credentials are auto-generated by Terraform (`random_password`, `random_bytes`).
- **Helm charts:** `charts/app/` is the main app chart. `charts/postgres/` and `charts/temporal/` are platform charts. `charts/supabase/` wraps the upstream Supabase chart.
- **Workers are Node.js:** `temporal/` is the TypeScript worker. Entrypoint is `node dist/worker.js` (not Python, not `dist/server.js`).
