/**
 * Shared helpers for auth integration tests.
 *
 * Provides typed wrappers around the Supabase admin API and the PostgREST
 * REST endpoint so each test file focuses on behaviour, not HTTP mechanics.
 */

import { createClient } from '@supabase/supabase-js';
import * as OTPAuth from 'otpauth';
// Node 20 lacks native WebSocket; provide the 'ws' implementation.
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

// Fall back to the standard local-dev JWT stubs so module-level client
// creation never fails even when env vars are injected after module import.
const LOCAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.SUPABASE_ANON_KEY || LOCAL_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || LOCAL_SERVICE_KEY;

const wsOptions = { realtime: { transport: WebSocket } } as const;

/** Admin client (service_role) — bypasses RLS, used for setup/teardown. */
export const adminClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...wsOptions,
});

/** Public client (anon key) — represents an unauthenticated browser session. */
export const anonClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...wsOptions,
});

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export type AppRole = 'admin' | 'editor' | 'reviewer' | 'read_only';

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Create a fresh user via the admin API, confirm email immediately. */
export async function createUser(
  email: string,
  password = 'TestPass123!',
  role: AppRole = 'read_only',
  tenant = 'default',
): Promise<TestUser> {
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, tenant },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email, password };
}

/** Delete a user by ID. Safe to call even if the user no longer exists. */
export async function deleteUser(userId: string): Promise<void> {
  await adminClient.auth.admin.deleteUser(userId);
}

/** Assign a role (and optionally tenant) to an existing user. */
export async function setRole(
  userId: string,
  role: AppRole,
  tenant = 'default',
): Promise<void> {
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    app_metadata: { role, tenant },
  });
  if (error) throw new Error(`setRole failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Sign in with email + password, returns aal1 session client. */
export async function signIn(user: TestUser) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...wsOptions,
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) throw new Error(`signIn failed: ${error?.message}`);
  return { client, session: data.session };
}

// ---------------------------------------------------------------------------
// MFA helpers
// ---------------------------------------------------------------------------

export interface EnrolledFactor {
  factorId: string;
  secret: string;
  totp: OTPAuth.TOTP;
}

/** Enroll a TOTP factor for the signed-in client; returns factorId + totp generator. */
export async function enrollTotp(client: ReturnType<typeof createClient>): Promise<EnrolledFactor> {
  // Clean up any stale unverified factors first (mirrors MfaGate.tsx behaviour).
  const { data: list } = await client.auth.mfa.listFactors();
  const stale = (list?.totp ?? []).filter((f) => f.status !== 'verified');
  for (const f of stale) {
    await client.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp' });
  if (error || !data) throw new Error(`enroll failed: ${error?.message}`);

  const totp = new OTPAuth.TOTP({ secret: data.totp.secret, digits: 6, period: 30 });
  return { factorId: data.id, secret: data.totp.secret, totp };
}

/**
 * Challenge + verify a TOTP factor.
 * Returns the aal2 session (the client's session is promoted in-place).
 */
export async function verifyTotp(
  client: ReturnType<typeof createClient>,
  factor: EnrolledFactor,
): Promise<void> {
  const { data: ch, error: chErr } = await client.auth.mfa.challenge({
    factorId: factor.factorId,
  });
  if (chErr || !ch) throw new Error(`challenge failed: ${chErr?.message}`);

  const code = factor.totp.generate();
  const { error: vErr } = await client.auth.mfa.verify({
    factorId: factor.factorId,
    challengeId: ch.id,
    code,
  });
  if (vErr) throw new Error(`verify failed: ${vErr.message}`);
}

/**
 * Full shortcut: enroll a TOTP factor AND complete verification in one call.
 * The client's session is promoted to aal2.
 */
export async function enrollAndVerifyTotp(
  client: ReturnType<typeof createClient>,
): Promise<EnrolledFactor> {
  const factor = await enrollTotp(client);
  await verifyTotp(client, factor);
  return factor;
}

// ---------------------------------------------------------------------------
// PostgREST probe
// ---------------------------------------------------------------------------

/**
 * Probe the PostgREST /entities endpoint with the current session token.
 * Returns the HTTP status code. Does NOT throw on 4xx/5xx — callers assert.
 */
export async function probeRestEntities(
  client: ReturnType<typeof createClient>,
): Promise<number> {
  const { data: { session } } = await client.auth.getSession();
  const token = session?.access_token ?? anonKey;

  const res = await fetch(`${url}/rest/v1/entities?limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  return res.status;
}

/** Probe with the service_role key (always bypasses auth gates). */
export async function probeRestAsServiceRole(): Promise<number> {
  const res = await fetch(`${url}/rest/v1/entities?limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return res.status;
}

// ---------------------------------------------------------------------------
// JWT decode (no verification — local GoTrue only)
// ---------------------------------------------------------------------------

export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
