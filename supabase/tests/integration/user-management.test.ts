/**
 * User management tests.
 *
 * Covers: creating users, assigning roles, changing roles, default role,
 * and that role is reflected in the JWT claims.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUser,
  deleteUser,
  setRole,
  signIn,
  decodeJwt,
  type TestUser,
  type AppRole,
} from './helpers.js';

const ROLES: AppRole[] = ['admin', 'editor', 'reviewer', 'read_only'];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await deleteUser(id);
  }
});

describe('User creation', () => {
  it('creates a user with the default read_only role', async () => {
    const user = await createUser(`default-role-${Date.now()}@test.local`);
    createdUserIds.push(user.id);

    const { session } = await signIn(user);
    const claims = decodeJwt(session.access_token);
    const meta = claims.app_metadata as Record<string, string>;

    expect(meta.role).toBe('read_only');
    expect(meta.tenant).toBe('default');
  });

  it('creates a user with an explicit role', async () => {
    for (const role of ROLES) {
      const user = await createUser(`role-${role}-${Date.now()}@test.local`, 'TestPass123!', role);
      createdUserIds.push(user.id);

      const { session } = await signIn(user);
      const claims = decodeJwt(session.access_token);
      const meta = claims.app_metadata as Record<string, string>;

      expect(meta.role, `role should be ${role}`).toBe(role);
    }
  });

  it('creates a user with a custom tenant', async () => {
    const user = await createUser(`tenant-test-${Date.now()}@test.local`, 'TestPass123!', 'editor', 'acme-corp');
    createdUserIds.push(user.id);

    const { session } = await signIn(user);
    const claims = decodeJwt(session.access_token);
    const meta = claims.app_metadata as Record<string, string>;

    expect(meta.tenant).toBe('acme-corp');
  });

  it('rejects sign-in with wrong password', async () => {
    const user = await createUser(`bad-pw-${Date.now()}@test.local`);
    createdUserIds.push(user.id);

    // Use signIn with a bad password by calling directly via the admin client's
    // createUser-compatible path — anonClient won't persist state.
    const { anonClient } = await import('./helpers.js');
    const { error } = await anonClient.auth.signInWithPassword({
      email: user.email,
      password: 'wrong-password',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid login credentials/i);
  });
});

describe('Role management', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createUser(`role-mgmt-${Date.now()}@test.local`);
    createdUserIds.push(user.id);
  });

  it('starts as read_only by default', async () => {
    const { session } = await signIn(user);
    const meta = (decodeJwt(session.access_token).app_metadata ?? {}) as Record<string, string>;
    expect(meta.role).toBe('read_only');
  });

  it('can be promoted to editor', async () => {
    await setRole(user.id, 'editor');
    const { session } = await signIn(user);
    const meta = (decodeJwt(session.access_token).app_metadata ?? {}) as Record<string, string>;
    expect(meta.role).toBe('editor');
  });

  it('can be promoted to admin', async () => {
    await setRole(user.id, 'admin');
    const { session } = await signIn(user);
    const meta = (decodeJwt(session.access_token).app_metadata ?? {}) as Record<string, string>;
    expect(meta.role).toBe('admin');
  });

  it('can be demoted back to read_only', async () => {
    await setRole(user.id, 'read_only');
    const { session } = await signIn(user);
    const meta = (decodeJwt(session.access_token).app_metadata ?? {}) as Record<string, string>;
    expect(meta.role).toBe('read_only');
  });

  it('role is stored in app_metadata (not user_metadata)', async () => {
    await setRole(user.id, 'reviewer');
    const { session } = await signIn(user);
    const claims = decodeJwt(session.access_token);

    // Role must be in app_metadata (server-controlled), not user_metadata (user-writable).
    const appMeta = claims.app_metadata as Record<string, string>;
    const userMeta = (claims.user_metadata ?? {}) as Record<string, string>;

    expect(appMeta.role).toBe('reviewer');
    expect(userMeta.role).toBeUndefined();
  });
});
