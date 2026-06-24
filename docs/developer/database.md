# Database development guide

This guide is the day-to-day playbook for contributors changing the Supabase/Postgres schema in this repository.

For deeper schema philosophy and data-model details, use:
- [`DATABASE.md`](../../DATABASE.md)
- [`Guide_for_agents_using_supabase_template.md`](../../Guide_for_agents_using_supabase_template.md)
- [`Generalisable_schema.md`](../../Generalisable_schema.md)

## 1) Expected migration workflow

1. Generate a new migration file using the Supabase CLI (automatically timestamps the file):
   ```bash
   supabase migration new <description>
   # Example: supabase migration new add_user_preferences_table
   # Creates: supabase/migrations/20260623120000_add_user_preferences_table.sql
   ```
   Alternatively, create the file manually in `supabase/migrations/` following the `YYYYMMDDHHMMSS_description.sql` naming convention.
2. Keep migrations **additive and reversible** by default (new tables/columns/indexes/functions over destructive rewrites).
3. Use local reset to validate the full replay path:
   ```bash
   supabase db reset --config supabase/config.toml
   ```
4. If your change affects seeded reference data, update `supabase/seed.sql` and re-run reset.
5. Include only the new migration (and required seed changes) in your PR. Do not edit shipped migrations unless a ticket explicitly calls for a pre-release correction.

## 2) Repository database conventions

Follow these conventions in every migration:
- Use `snake_case` for table/column names.
- Prefer UUID primary keys with `default gen_random_uuid()`.
- Include `created_at` and `updated_at` timestamps where appropriate.
- Preserve SCD2 expectations (`entity_versions`, `relationships_v2`): append new version rows, keep history, and maintain a single current row per identity tuple.
- Bias toward additive/reversible changes. Treat drops, hard deletes, and type rewrites as exceptional and explicitly justified.
- Prefer `jsonb` for flexible payloads (`entity_versions.data`, `time_series_points.data`); use numeric facts in `entity_facts` with clear `fact_type` references.

### How SCD2 triggers work

The repository uses database triggers to automate SCD2 history management. You do **not** need to manually close the previous current row — the trigger handles it:

1. Insert a new row into `entity_versions` for an `entity_id`.
2. `trg_entity_versions_scd2` fires and sets `is_current = false` + `valid_to = now()` on any existing current row for that entity.
3. The new row becomes the sole current version (`is_current = true`).

Relationships in `relationships_v2` follow the same pattern for the `(parent_entity_id, child_entity_id, relationship_type)` tuple.

Do **not** manually flip `is_current` or `valid_to` in application code — let the trigger maintain history consistency. If you add new versioned tables, apply the same SCD2 trigger pattern rather than managing state manually.

## 3) Local apply/reset and seed-data safety

For Supabase-only work (schema, migrations, RPCs, policies):
- `supabase start` boots only the Supabase stack (Postgres + Auth + API).
- `supabase db reset --config supabase/config.toml` is the source-of-truth check for migration order + seed compatibility.

For full-stack validation (Supabase + Temporal worker + frontend together):
- `make up` — starts the full stack via the Supabase CLI and Docker Compose.
- `make down` — stops the stack without destroying volumes.
- `make reset` — full wipe: tears down Docker Compose volumes and the Supabase stack, then recreates everything from scratch (migrations + seed re-applied). Use this when you suspect stale state or need a clean-room validation.

- Keep `supabase/seed.sql` idempotent and safe to replay.
- Seed only baseline/dev-safe data required for local and CI flows; avoid environment-specific credentials or production-only assumptions.

After any schema, RPC, or policy change, validate the affected surface using the test scripts in `supabase/tests/`:

The contract-level scripts spin up a throwaway Postgres container via Docker (no running Supabase instance required):
```bash
# Validate RPC write-path guard contracts (requires Docker)
bash supabase/tests/run_direct_db_write_rpc_guards.sh

# Validate auth and RBAC policies (requires Docker)
bash supabase/tests/run_auth_rbac.sh

# Validate workflow classification schema contracts (requires Docker)
bash supabase/tests/run_workflow_classifications_contract.sh

# Validate create_entity_with_version RPC grant/guard semantics via reset (requires supabase CLI + Docker)
bash supabase/tests/run_create_entity_with_version_reset.sh

# Validate the demo baseline seed applies cleanly from scratch (requires Docker)
bash supabase/tests/run_demo_baseline_seed.sh

# Validate demo user roles and permissions are provisioned correctly (requires Docker)
bash supabase/tests/run_seed_demo_users.sh
```

For a full integration run against a live Supabase instance (requires `supabase start` or `make up` to be running first):
```bash
bash supabase/tests/run_auth_integration.sh
```

Run the relevant script after reset to confirm your changes behave as expected before opening a PR.

> **Note:** In CI the Supabase CLI resolves `supabase/config.toml` from the repository root automatically. When running `supabase db reset` locally from a non-root directory, pass `--config supabase/config.toml` explicitly.

## 4) RLS vs SECURITY DEFINER RPCs

Use the repository auth pattern consistently:
- **RLS for reads (and simple ownership-scoped writes):** policies enforce tenant/user row access for PostgREST clients.
- **SECURITY DEFINER RPCs for privileged or multi-step writes:** use RPCs when operations need elevated permission checks, cross-table invariants, or atomic transaction boundaries.

Practical mapping to app layers:
- **Frontend (`supabase-js`):** read via RLS-governed tables/views; call RPCs for privileged writes via `supabase.rpc('function_name', params)`.
- **Temporal worker:** coordinates backend workflows and can execute richer write paths, but must still respect tenant/data-boundary contracts and avoid introducing bypass routes for user-scoped data.

Every SECURITY DEFINER function **must**:
1. Include `set search_path = public` in the function signature to prevent schema injection attacks.
2. Validate the caller's identity and permissions at the top of the function body before executing any business logic.

```sql
create or replace function public.my_privileged_write(
  p_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public   -- required: prevents schema injection via shadowing
as $$
declare
  v_claims_text text := current_setting('request.jwt.claims', true);
  v_claims      json;
  v_jwt_role    text;
  v_app_role    text;
begin
  -- Safe JSON parse: absent or malformed claims = direct Postgres / service_role path
  begin
    v_claims := nullif(v_claims_text, '')::json;
  exception when others then
    v_claims := null;
  end;

  v_jwt_role := coalesce(v_claims ->> 'role', '');
  v_app_role := coalesce(v_claims -> 'app_metadata' ->> 'role', '');

  -- Enforce role authorization for authenticated PostgREST sessions
  if v_jwt_role = 'authenticated' then
    if v_app_role not in ('admin', 'editor') then
      raise insufficient_privilege
        using message =
          'my_privileged_write: role ''' || coalesce(v_app_role, '') ||
          ''' is not authorized';
    end if;
  end if;

  -- Business logic here
  ...
end;
$$;

-- Grant execute only to authenticated users — anon gets nothing
grant execute on function public.my_privileged_write(text) to authenticated;
```

Missing the role guard is a privilege escalation path. Missing `set search_path = public` is a schema injection risk. Both are security-review blockers. See the canonical reference in `supabase/migrations/20260620100001_create_entity_with_version_rpc_role_guard.sql`.

See ADR-0023 for the authoritative write-path decision:
- [`docs/adrs/0023-authenticated-write-path-security-definer-rpc.md`](../adrs/0023-authenticated-write-path-security-definer-rpc.md)

## 5) PR pitfalls that commonly block review

Avoid these during implementation and review:
- Editing old migrations instead of adding a new one.
- Destructive schema changes without explicit issue approval and rollback notes.
- Bypassing tenant/data-access boundaries (for example, broad grants or RPCs without caller validation).
- Adding SECURITY DEFINER functions without strict input/role checks at function entry.
- Omitting `set search_path = public` in a SECURITY DEFINER function — this leaves the function vulnerable to schema-injection attacks where a caller creates an object that shadows a `public` table or function inside the execution context.
- Forgetting reset-path validation after changing schema, RPCs, policies, or seed data.
- Not running the relevant `supabase/tests/` script to verify RPC and policy contracts after changes.

When in doubt: prefer additive migration + reset-path validation + least-privilege access controls.

## Quick reference

| Task | Command |
|---|---|
| Create a new migration file | `supabase migration new <description>` |
| Start local Supabase stack (only) | `supabase start` |
| Start full stack (Supabase + Temporal + frontend) | `make up` |
| Stop full stack | `make down` |
| Full wipe and recreate from scratch | `make reset` |
| Replay all migrations + seed | `supabase db reset --config supabase/config.toml` |
| Check which migrations are applied | `supabase migration list` |
| Validate RPC write-path guards | `bash supabase/tests/run_direct_db_write_rpc_guards.sh` |
| Validate auth/RBAC policies | `bash supabase/tests/run_auth_rbac.sh` |
| Validate workflow classification schema | `bash supabase/tests/run_workflow_classifications_contract.sh` |
| Validate create_entity_with_version RPC | `bash supabase/tests/run_create_entity_with_version_reset.sh` |
| Validate demo baseline seed | `bash supabase/tests/run_demo_baseline_seed.sh` |
| Validate demo user provisioning | `bash supabase/tests/run_seed_demo_users.sh` |
| Full integration run (stack must be up) | `bash supabase/tests/run_auth_integration.sh` |
