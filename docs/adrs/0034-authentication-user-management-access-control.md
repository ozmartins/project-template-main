# ADR-0034: Authentication, User Management, and Access Control

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The template stack uses Supabase as its database and auth layer (ADR-0015). Until now the frontend used the anonymous key for all PostgREST queries, meaning any request — authenticated or not — could read and write all application data. The template needs a reusable, opinionated auth baseline so that applications built on it are not deployed without login and access control.

The pattern was first built and validated in the mna-app project, which needed email/password login, mandatory TOTP MFA for every user, and a role model stored in JWT app_metadata that gates UI actions and API writes.

## Decision

Authentication and access control is implemented in three coordinated layers:

### Layer 1: Database — role grants (migration `20260620000000_auth_lockdown_grants.sql`)

PostgREST maps unauthenticated requests to the `anon` role and authenticated (valid-JWT) requests to the `authenticated` role. The migration:

- Revokes all privileges on the public schema from `anon` (and the `public` pseudo-role).
- Grants `SELECT / INSERT / UPDATE / DELETE` on all public tables and sequences, and `EXECUTE` on all public functions, to `authenticated`.
- Sets `ALTER DEFAULT PRIVILEGES` so every object created by future migrations inherits the same posture without additional grant statements.

The Temporal worker and any server-side process connect directly to Postgres as a superuser, bypassing PostgREST roles entirely — they are unaffected by this change.

### Layer 2: Database — mandatory MFA hook (migration `20260620000100_require_aal2_mfa.sql`)

A `public.require_aal2()` PL/pgSQL function is registered as the PostgREST `db_pre_request` hook (via `ALTER ROLE authenticator SET pgrst.db_pre_request`). On every API request it reads the JWT claims from `current_setting('request.jwt.claims')`:

- If `role = 'authenticated'` and `aal ≠ 'aal2'`, it raises `insufficient_privilege`.
- All other requests (service_role, internal Postgres paths, unauthenticated) pass through unchanged.

This enforces MFA at the data layer independently of whether the frontend gate is working correctly — a compromised or bypassed frontend cannot reach the database with a password-only token.

### Layer 3: Frontend — auth module (`frontend/src/auth/`)

Four files compose the frontend auth surface:

| File | Responsibility |
|---|---|
| `types.ts` | `AppRole` type, `UserProfile` interface, `canWrite / canReview / canAdminister` predicates |
| `AuthContext.tsx` | `AuthProvider` — session lifecycle, AAL tracking, `signIn / signOut`; `useAuth` hook; `useAuthCapabilities` hook |
| `AuthGate.tsx` | Full-screen login form; blocks the router until a session exists; hands off to `MfaGate` |
| `MfaGate.tsx` | TOTP enrollment (QR + secret) and challenge screens; blocks the router until `aal2` is satisfied |

`main.tsx` wraps the router in `<AuthProvider><AuthGate>` so the entire application is behind auth. No route is reachable without a valid aal2 session.

**Role model.** Roles are stored server-side in `auth.users.app_metadata.role` (never in user_metadata, which is writable by the user). The four roles are:

| Role | canWrite | canReview | canAdminister |
|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ |
| `editor` | ✓ | ✓ | — |
| `reviewer` | — | ✓ | — |
| `read_only` | — | — | — |

New users default to `read_only`. An admin sets roles via the Supabase dashboard or a SECURITY DEFINER RPC (ADR-0023). The `tenant` field in app_metadata supports multi-tenant isolation if needed by the application.

**AAL tracking.** After sign-in the session is `aal1`. `AuthContext.refreshAal()` calls `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` and `listFactors()`. If no verified TOTP factor exists, `mfaRequired` is set to `true` and `MfaGate` presents the enrollment flow. If a verified factor exists but the session is still `aal1`, `MfaGate` presents the challenge flow. Only when `currentLevel === 'aal2'` does `mfaRequired` become `false` and the app render.

## Consequences

**Positive:**
- No application data is reachable without a valid aal2 session. Both the frontend gate and the database hook enforce this independently.
- The role model is in one place (`types.ts`). `useAuthCapabilities()` gives components a stable, memoized capability object — no ad-hoc `role === 'admin'` checks scattered through the codebase.
- New applications built on the template start with a secure baseline rather than an open one.
- The migration pattern is idempotent and CI-safe: it creates the PostgREST roles only if they are absent, so plain-Postgres CI environments don't break.

**Negative:**
- MFA is mandatory for all users, including developers. Local dev requires enrolling a TOTP factor. This is intentional and consistent with the production posture, but adds setup friction.
- Roles are managed via the Supabase dashboard or a direct Postgres update. There is no user-management UI in the template — applications must build one or use the Supabase Studio.
- The `require_aal2` hook adds a tiny overhead (one JWT parse) to every PostgREST request.

## Alternatives considered

**Optional MFA (not mandatory):** Reduces friction but leaves an entire class of credential-theft attacks unmitigated. Rejected — MFA as the default is the right call for applications built on this stack.

**RLS-only access control (no role grants):** RLS policies can express fine-grained ownership rules but require every table to have its own policy. The role-grant approach gives a baseline deny-all-anon / allow-authenticated posture that applies automatically to every new table — simpler and less likely to be forgotten on a new migration.

**Role stored in a profiles table (not app_metadata):** A profiles table is more flexible (joins, audit log, etc.) but requires an extra query on every page load to resolve the role. `app_metadata` is embedded in the JWT and available client-side without an extra round-trip. Applications that need richer profile data should add a profiles table alongside this pattern.

**Separate auth service:** Unnecessary; Supabase GoTrue handles token issuance, refresh, and MFA natively.

## Evidence

- `supabase/migrations/20260620000000_auth_lockdown_grants.sql`
- `supabase/migrations/20260620000100_require_aal2_mfa.sql`
- `frontend/src/auth/` — types, context, gates
- `frontend/src/main.tsx` — `<AuthProvider><AuthGate>` wrapping
- ADR-0015 — Supabase as the auth and database layer
- ADR-0023 — SECURITY DEFINER RPCs for privileged writes
- mna-app — first production deployment of this pattern
