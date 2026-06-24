# ADR-0023: Authenticated Write Path via SECURITY DEFINER RPCs

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Supabase's frontend client (ADR-0019) uses the anonymous key and the authenticated user's JWT for data access. PostgREST enforces Row Level Security (RLS) policies on all table access. This works well for reads: RLS filters rows by user/tenant context automatically.

For writes, the default anonymous-key path is too weak for some operations: business logic that must run in a single transaction (insert entity + create version + create relationship), operations that require elevated privileges temporarily, or writes that must validate invariants before committing. Granting the anon/user role direct write access to core tables to cover these cases would either over-privilege the role or require complex RLS policy combinations.

## Decision

Complex write operations are exposed as **PostgreSQL functions with `SECURITY DEFINER`**. The function runs with the permissions of its creator (typically the postgres superuser role at migration time), not the calling user's role. The function:
1. Validates the caller's identity and permissions explicitly at the top of the function body
2. Executes the business logic in a single transaction
3. Returns a structured result

PostgREST exposes these functions as RPC endpoints (`/rpc/function_name`). The `@supabase/supabase-js` client calls them via `supabase.rpc('function_name', params)`.

**Direct table writes** via the anon/user role remain available for simple, RLS-covered operations (e.g., inserting a row that belongs to the caller's tenant). `SECURITY DEFINER` RPCs are reserved for operations that cross privilege boundaries or require transactional business logic.

## Consequences

**Positive:**
- Complex multi-table write operations are atomic and consistent. The entire operation succeeds or fails together.
- Business invariants can be checked in SQL before the write commits, without a round-trip to the application layer.
- The RPC surface is explicit and auditable — the full list of privileged write operations is visible in `supabase/migrations/`.
- Supabase's built-in RPC testing support (`supabase/tests/`) enables CI gates for write-path behaviour (see `supabase/tests/run_direct_db_write_rpc_guards.sh`).

**Negative:**
- `SECURITY DEFINER` functions require careful input validation at the top of every function. A missing check is a privilege escalation path. Code review must treat these functions as security-sensitive.
- Functions run in the migration user's schema. Changes to function bodies require new migration files — they cannot be edited in place without a new migration.
- PostgREST's RPC calling convention requires JSON parameters. This is less ergonomic than a typed ORM for complex inputs.

## Alternatives considered

**All writes via a backend API (Node.js/FastAPI):** Moves business logic out of Postgres but adds a backend service dependency for every write. For a Supabase-first stack, this duplicates the infrastructure.

**RLS-only on direct table writes:** Works for simple ownership checks but cannot enforce multi-table transactional invariants. Leads to either over-complex RLS policies or race conditions.

**Postgres triggers for business logic:** Triggers run on every row operation, not just the specific write paths that need business logic. Hard to test in isolation; complex trigger chains are difficult to debug.

## Evidence

- `supabase/migrations/` — SECURITY DEFINER function definitions
- `supabase/tests/run_direct_db_write_rpc_guards.sh` — CI gate for write-path contracts
- ADR-0015 — Supabase as the auth and database layer
