# ADR-0069: Authenticated workflow triggers are read-only by default

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

This PR introduces an authenticated server-side workflow trigger endpoint
(`supabase/functions/trigger-workflow`) and a frontend trigger UI
(`frontend/src/routes/workflows/trigger.tsx`). Authenticated callers can invoke
the edge function directly, so the server-side trigger surface is a security
boundary that must constrain which workflow definitions are executable.

Some definitions (for example `vertical-classification`) execute mutating
activities (`supabase_mutate`) that can upsert data through server-side
Temporal/Supabase integrations. Exposing those definitions through a generic
public trigger endpoint without dedicated authorization and persistence scoping
would create a privileged write path.

## Decision

We keep the authenticated workflow-trigger surface server-side allowlisted and
limited to non-mutating definitions by default. Mutating workflows remain off
the public trigger surface until a separate server-side authorization model and
user-scoped persistence boundary are designed.

## Consequences

- The initial trigger surface is constrained to read-only smoke execution paths.
- The edge function remains responsible for enforcing triggerability; frontend
  catalog visibility is not treated as a security control.
- Any future exposure of mutating definitions requires a separate ADR and
  implementation for explicit authorization and user-scoped persistence
  boundaries.

**Rollback:** If this boundary must tighten further, reduce the allowlist to an
empty set (or remove endpoint access) until an approved authorization model is
implemented.

## Alternatives considered

- Allow all checked-in definitions to be triggered by any authenticated caller:
  rejected because mutating definitions can become a service-role-backed write
  path.
- Keep mutating definitions in the public trigger surface behind UI-only
  filtering: rejected because callers can bypass UI constraints and invoke the
  edge function directly.

## Evidence

- `supabase/functions/trigger-workflow/index.ts` — server-side
  `TRIGGERABLE_DEFINITIONS` allowlist and rejection for unlisted definitions
- `supabase/functions/trigger-workflow/index.test.ts` — test coverage that
  mutating `vertical-classification` is rejected
- `frontend/src/workflows/definitions.ts` — frontend trigger catalog includes
  only `smoke-classification`
- Commits: `6f63a1e`, `df3a40f`
