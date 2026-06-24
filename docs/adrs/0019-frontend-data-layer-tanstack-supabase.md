# ADR-0019: Frontend Data Layer — TanStack Router + TanStack Query + Supabase PostgREST

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The frontend needs a routing system, a data-fetching system, and a client for Supabase's PostgREST API. These choices shape the entire frontend architecture: how URLs map to components, how server state is cached and invalidated, and how the JSON engine (ADR-0018) resolves its data sources.

## Decision

**Routing:** [TanStack Router](https://tanstack.com/router) with Vite plugin for file-based route generation. Routes are fully TypeScript-typed via the generated `routeTree.gen.ts`. The file-based convention produces a route tree that the JSON engine can reference by path.

**Data fetching:** [TanStack Query](https://tanstack.com/query) v5 with:
- Default stale time: 5 minutes (configurable per data source in the JSON definition)
- Default GC time: 30 minutes
- Query keys derived from data source definitions (table, filters, order, limit) — deterministic caching without manual key management
- `QueryClient` exposed to the JSON engine's action handlers for targeted cache invalidation after mutations

**Supabase client:** `@supabase/supabase-js` with the anonymous key. The client is instantiated once and shared. Authenticated requests use the session JWT automatically injected by the client.

**Build tooling:** [Vite](https://vitejs.dev) with `@tanstack/router-plugin` for route tree generation. HMR for development; `vite build` for production. The production bundle is a static asset served by nginx (see ADR-0025).

## Consequences

**Positive:**
- TanStack Router's type-safe route tree eliminates a class of navigation bugs. Invalid routes are caught at compile time.
- TanStack Query's cache prevents redundant network requests when the same data is needed by multiple components or the JSON engine's multiple data sources.
- The supabase-js client handles JWT refresh, real-time subscriptions, and upload — no custom auth middleware needed for standard patterns.
- All three choices are well-maintained, widely used libraries with active communities and extensive documentation.

**Negative:**
- TanStack Router's generated `routeTree.gen.ts` must be committed or regenerated at build time. Forgetting to regenerate after adding a route is a common developer error.
- TanStack Query introduces React-specific patterns (hooks, QueryClient context). The JSON engine's data sources are coupled to this system — replacing it requires rewriting the engine's data resolution layer.
- Supabase's anonymous key is intentionally public, but RLS policies must be correctly written to prevent data leaks. A misconfigured policy is a security risk, not a client bug.

## Alternatives considered

**React Router (v6):** Mature and widely understood, but lacks TanStack Router's TypeScript-first route param typing. The JSON engine benefits from typed routes.

**SWR (Vercel):** Simpler API than TanStack Query but less feature-complete (no built-in devtools, weaker mutation support). TanStack Query's mutation + cache invalidation model integrates better with the JSON engine's action system.

**tRPC for the data layer:** Type-safe end-to-end API calls but requires a Node.js backend. The template uses Supabase PostgREST as the data API; tRPC adds a layer for no benefit.

## Evidence

- `frontend/package.json` — `@tanstack/react-router`, `@tanstack/react-query`, `@supabase/supabase-js`, `vite`
- `frontend/src/routes/` — file-based route definitions
- `frontend/src/engine/useDataSources.ts` — TanStack Query integration
- `frontend/vite.config.ts` — router plugin configuration
