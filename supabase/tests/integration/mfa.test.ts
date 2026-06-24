/**
 * MFA (TOTP) integration tests.
 *
 * Covers: enrollment flow, challenge+verify, aal2 promotion, re-challenge on
 * subsequent sign-in, unenrollment, and the data-layer enforcement that rejects
 * aal1 sessions via the require_aal2() pre-request hook.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUser,
  deleteUser,
  signIn,
  enrollTotp,
  verifyTotp,
  enrollAndVerifyTotp,
  probeRestEntities,
  type TestUser,
} from './helpers.js';
import { createClient } from '@supabase/supabase-js';

const createdUserIds: string[] = [];

function freshClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

afterAll(async () => {
  for (const id of createdUserIds) {
    await deleteUser(id);
  }
});

describe('MFA enrollment', () => {
  let user: TestUser;
  let client: ReturnType<typeof freshClient>;

  beforeAll(async () => {
    user = await createUser(`mfa-enroll-${Date.now()}@test.local`);
    createdUserIds.push(user.id);
    const s = await signIn(user);
    client = s.client;
  });

  it('enroll returns a factor_id and TOTP secret', async () => {
    const factor = await enrollTotp(client);
    expect(factor.factorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(factor.secret).toBeTruthy();
    expect(factor.totp).toBeTruthy();

    // Clean up — unenroll the pending factor so subsequent tests start clean
    await client.auth.mfa.unenroll({ factorId: factor.factorId });
  });

  it('factor starts as unverified; verify promotes session to aal2', async () => {
    const factor = await enrollTotp(client);

    // Before verify: assurance level is aal1
    const { data: before } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(before?.currentLevel).toBe('aal1');

    await verifyTotp(client, factor);

    // After verify: assurance level is aal2
    const { data: after } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(after?.currentLevel).toBe('aal2');
  });

  it('verified factor appears in listFactors() as verified', async () => {
    const { data } = await client.auth.mfa.listFactors();
    const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');
    expect(verified.length).toBeGreaterThanOrEqual(1);
  });
});

describe('MFA data-layer enforcement (require_aal2 hook)', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createUser(`mfa-enforce-${Date.now()}@test.local`);
    createdUserIds.push(user.id);
  });

  it('aal1 token returns 403 from PostgREST', async () => {
    const { client } = await signIn(user);
    const status = await probeRestEntities(client);
    expect(status).toBe(403);
  });

  it('aal2 token returns 200 from PostgREST', async () => {
    const { client } = await signIn(user);
    await enrollAndVerifyTotp(client);
    const status = await probeRestEntities(client);
    expect(status).toBe(200);
  });

  it('anon key returns 401 from PostgREST (grant-layer enforcement)', async () => {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/entities?limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY!}`,
        },
      },
    );
    expect(res.status).toBe(401);
  });
});

describe('MFA re-challenge on subsequent sign-in', () => {
  let user: TestUser;
  let factorId: string;
  let totp: import('otpauth').TOTP;

  beforeAll(async () => {
    user = await createUser(`mfa-reauth-${Date.now()}@test.local`);
    createdUserIds.push(user.id);

    // Enroll and verify on first sign-in
    const { client } = await signIn(user);
    const factor = await enrollAndVerifyTotp(client);
    factorId = factor.factorId;
    totp = factor.totp;
  });

  it('second sign-in starts at aal1 and requires re-challenge', async () => {
    const { client } = await signIn(user);

    // Fresh sign-in → aal1 even though a verified factor exists
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(data?.currentLevel).toBe('aal1');
    expect(data?.nextLevel).toBe('aal2');

    // PostgREST must block aal1
    const status = await probeRestEntities(client);
    expect(status).toBe(403);
  });

  it('re-challenge with verified factor promotes to aal2', async () => {
    const { client } = await signIn(user);

    // Challenge the existing verified factor
    const { data: challenge, error: chErr } = await client.auth.mfa.challenge({ factorId });
    expect(chErr).toBeNull();

    // Generate fresh code
    const code = totp.generate();
    const { error: vErr } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge!.id,
      code,
    });
    expect(vErr).toBeNull();

    // Now aal2 — PostgREST must accept
    const status = await probeRestEntities(client);
    expect(status).toBe(200);
  });
});

describe('MFA unenrollment', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createUser(`mfa-unenroll-${Date.now()}@test.local`);
    createdUserIds.push(user.id);
  });

  it('after unenrolling, user has no verified factors', async () => {
    const { client } = await signIn(user);
    const factor = await enrollAndVerifyTotp(client);

    // Unenroll the verified factor
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.factorId });
    expect(error).toBeNull();

    const { data } = await client.auth.mfa.listFactors();
    const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');
    expect(verified).toHaveLength(0);
  });
});
