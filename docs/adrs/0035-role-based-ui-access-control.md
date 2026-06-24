# ADR-0035: Role-Based UI Access Control via useAuthCapabilities

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

ADR-0034 establishes the auth baseline (session gate, MFA, database-level enforcement). Applications built on the template also need a consistent way to gate UI actions by the user's role — showing or disabling buttons, hiding admin panels, and preventing writes from non-write roles — without scattering role-string comparisons through component code.

## Decision

Role-based UI gating is handled exclusively through the `useAuthCapabilities()` hook exported from `frontend/src/auth/`. The hook returns a memoized `AuthCapabilities` object:

```typescript
interface AuthCapabilities {
  canWrite: boolean;       // admin | editor
  canReview: boolean;      // admin | editor | reviewer
  canAdminister: boolean;  // admin only
  role: AppRole | undefined;
}
```

Components consume this hook and render or disable controls based on the boolean fields. Direct comparisons against role strings (`role === 'admin'`) are not used in component code.

The hook is safe to call outside an `<AuthProvider>` — when no session is available, all capabilities default to `false` (most restrictive). The returned object reference is stable as long as the role does not change, so it is safe to pass as a prop or dependency array entry.

**Adding capabilities.** When a new permission boundary is needed (e.g. `canExport`), add a predicate function to `types.ts` and a field to `AuthCapabilities`. Do not add `role` string checks to components.

**Server-side enforcement.** `useAuthCapabilities` is a UI convenience only — it does not replace server-side enforcement. Database grants (ADR-0034, Layer 1) and RLS policies enforce access at the data layer. A write that `canWrite` should gate must also be protected by RLS or a SECURITY DEFINER RPC (ADR-0023).

## Consequences

**Positive:**
- All role-to-capability mappings live in one file (`types.ts`). Changing what `editor` can do is a one-line change.
- Components express intent (`canWrite`) not identity (`role === 'editor'`), making them resilient to role name changes.
- The stable reference from `useMemo` prevents unnecessary re-renders in deeply nested trees.

**Negative:**
- Applications that need many distinct capabilities may end up with a long `AuthCapabilities` interface. Prefer grouping related capabilities (write, review, administer) over adding many granular flags.
- UI gating is opt-in. A component that forgets to check `canWrite` will display an action that the server will reject. The failure mode is a user-facing error, not a data breach — but it is still poor UX.

## Alternatives considered

**Permission strings / RBAC library:** Adds a dependency and abstraction layer for what amounts to three predicates. Overkill for the current role model.

**Route-level guards:** Protects navigation but not individual actions within a page. Both are needed; `useAuthCapabilities` covers the intra-page case. TanStack Router `beforeLoad` guards can use `useAuth` for coarse route protection if needed.

**Role in a context separate from session:** Would require a second provider and an extra fetch. The role is already in the JWT (app_metadata), so deriving it in `AuthContext` costs nothing.

## Evidence

- `frontend/src/auth/types.ts` — `AppRole`, predicates, `ROLE_LABELS`
- `frontend/src/auth/AuthContext.tsx` — `useAuthCapabilities` implementation
- ADR-0034 — Auth baseline (session gate, MFA, database enforcement)
- ADR-0023 — Server-side write enforcement via SECURITY DEFINER RPCs
