/**
 * Auth types shared across the auth module.
 *
 * Role model (set in app_metadata.role by an administrator):
 *   - admin      — full access; can write everything and administer the system.
 *   - editor     — can write application data.
 *   - reviewer   — can write review/approval decisions, but not core data.
 *   - read_only  — view-only (default for all new users).
 *
 * Roles are stored in auth.users.app_metadata.role (set server-side only).
 * The tenant field in app_metadata.tenant supports multi-tenant isolation.
 * See ADR-0034.
 */

export type AppRole = "admin" | "editor" | "reviewer" | "read_only";

/** Minimal profile surfaced from auth user + app_metadata. */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  tenant: string;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  editor: "Editor",
  reviewer: "Reviewer",
  read_only: "Read Only",
};

/** Returns true when the given role has write capability on core data. */
export function canWrite(role: AppRole | undefined): boolean {
  return role === "admin" || role === "editor";
}

/** Returns true when the given role can record review/approval decisions. */
export function canReview(role: AppRole | undefined): boolean {
  return role === "admin" || role === "editor" || role === "reviewer";
}

/** Returns true when the given role can administer the system. */
export function canAdminister(role: AppRole | undefined): boolean {
  return role === "admin";
}
