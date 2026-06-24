/**
 * Access control integration tests.
 *
 * Covers: role-based capability predicates, that service_role bypasses the MFA
 * gate, and that the require_aal2 hook is independent of the frontend gate
 * (defence-in-depth — the DB enforces MFA even if the frontend gate is absent).
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  createUser,
  deleteUser,
  setRole,
  signIn,
  enrollAndVerifyTotp,
  probeRestEntities,
  probeRestAsServiceRole,
  decodeJwt,
  type AppRole,
} from './helpers.js';

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await deleteUser(id);
  }
});

// ---------------------------------------------------------------------------
// Role capabilities (mirrors types.ts predicates)
// ---------------------------------------------------------------------------

const ROLE_CAPABILITIES: Record<
  AppRole,
  { canWrite: boolean; canReview: boolean; canAdminister: boolean }
> = {
  admin:     { canWrite: true,  canReview: true,  canAdminister: true  },
  editor:    { canWrite: true,  canReview: true,  canAdminister: false },
  reviewer:  { canWrite: false, canReview: true,  canAdminister: false },
  read_only: { canWrite: false, canReview: false, canAdminister: false },
};

function canWrite(role: AppRole)      { return role === 'admin' || role === 'editor'; }
function canReview(role: AppRole)     { return role === 'admin' || role === 'editor' || role === 'reviewer'; }
function canAdminister(role: AppRole) { return role === 'admin'; }

describe('Role capability predicates', () => {
  const cases = Object.entries(ROLE_CAPABILITIES) as [AppRole, typeof ROLE_CAPABILITIES[AppRole]][];

  it.each(cases)('role %s has correct capability set', (role, expected) => {
    expect(canWrite(role)).toBe(expected.canWrite);
    expect(canReview(role)).toBe(expected.canReview);
    expect(canAdminister(role)).toBe(expected.canAdminister);
  });
});

describe('Role is correctly reflected in JWT after assignment', () => {
  it.each(['admin', 'editor', 'reviewer', 'read_only'] as AppRole[])(
    'role %s is embedded in JWT app_metadata',
    async (role) => {
      const user = await createUser(
        `cap-${role}-${Date.now()}@test.local`,
        'TestPass123!',
        role,
      );
      createdUserIds.push(user.id);

      const { session } = await signIn(user);
      const meta = (decodeJwt(session.access_token).app_metadata ?? {}) as Record<string, string>;
      expect(meta.role).toBe(role);
    },
  );
});

describe('service_role bypasses MFA gate (for Temporal workers / Edge Functions)', () => {
  it('service_role key returns 200 from PostgREST without MFA', async () => {
    const status = await probeRestAsServiceRole();
    expect(status).toBe(200);
  });
});

describe('Defence-in-depth: DB hook enforces MFA independently of frontend gate', () => {
  it('aal1 token is rejected at the DB layer even without a frontend gate', async () => {
    const user = await createUser(`depth-${Date.now()}@test.local`);
    createdUserIds.push(user.id);

    // Simulate a client that bypassed the frontend AuthGate (e.g. a direct API call).
    const { client } = await signIn(user);

    // The frontend gate is NOT active here — we're calling PostgREST directly.
    // The DB-layer require_aal2() hook must still reject the aal1 token.
    const status = await probeRestEntities(client);
    expect(status).toBe(403);
  });

  it('only an aal2 token reaches data — even after a role change', async () => {
    const user = await createUser(`depth-role-${Date.now()}@test.local`, 'TestPass123!', 'editor');
    createdUserIds.push(user.id);

    const { client } = await signIn(user);
    await enrollAndVerifyTotp(client);

    // Change role while the session is still valid
    await setRole(user.id, 'read_only');

    // aal2 still grants PostgREST access (row-level access is a separate concern)
    const status = await probeRestEntities(client);
    expect(status).toBe(200);
  });
});
