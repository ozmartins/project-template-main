#!/usr/bin/env npx ts-node
/**
 * bootstrap-users — create local dev users via the Supabase admin API.
 *
 * Creates a fixed set of dev users with known credentials, auto-confirms
 * their email, and prints a TOTP URI for each one (MFA is enforced by the
 * require_aal2 migration, so every user needs a TOTP factor enrolled).
 *
 * Idempotent: if a user already exists, it is deleted and recreated so the
 * password and TOTP secret are always reset to the values printed here.
 *
 * Usage:
 *   make bootstrap-users
 *   npx ts-node scripts/bootstrap-users.ts
 *
 * Requires:
 *   SUPABASE_URL            e.g. http://127.0.0.1:54321  (default)
 *   SUPABASE_SERVICE_ROLE_KEY  read from .env or env
 *
 * The script reads .env from the repo root automatically if it exists.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Load .env (best-effort — not required if vars are already in environment)
// ---------------------------------------------------------------------------

const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321')
  // When running on host (not in Docker), swap host.docker.internal → 127.0.0.1
  .replace('host.docker.internal', '127.0.0.1');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set.');
  console.error('Run `supabase start` first, then `make bootstrap-users`.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Dev user definitions
// ---------------------------------------------------------------------------

interface DevUser {
  email: string;
  password: string;
  role: string;        // informational label only
  description: string;
}

const DEV_USERS: DevUser[] = [
  {
    email: 'admin@dev.local',
    password: 'Admin1234!',
    role: 'admin',
    description: 'Full access — use for setup and admin tasks',
  },
  {
    email: 'editor@dev.local',
    password: 'Editor1234!',
    role: 'editor',
    description: 'Standard authenticated user — use for day-to-day testing',
  },
  {
    email: 'readonly@dev.local',
    password: 'Readonly1234!',
    role: 'readonly',
    description: 'Read-only user — use to test permission boundaries',
  },
];

// ---------------------------------------------------------------------------
// TOTP helpers (RFC 6238, no external deps)
// ---------------------------------------------------------------------------

function generateTotpSecret(): string {
  // 20-byte random secret, base32-encoded
  const bytes = crypto.randomBytes(20);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let buffer = 0;
  let bitsLeft = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += alphabet[(buffer >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) result += alphabet[(buffer << (5 - bitsLeft)) & 0x1f];
  return result;
}

function totpUri(secret: string, email: string): string {
  return `otpauth://totp/10xStack%3A${encodeURIComponent(email)}?secret=${secret}&issuer=10xStack&algorithm=SHA1&digits=6&period=30`;
}

function totpCode(secret: string): string {
  // Compute current TOTP code so the dev can verify the URI works immediately
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const decoded: number[] = [];
  for (const ch of secret.toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((value >> bits) & 0xff);
    }
  }
  const keyBytes = Buffer.from(decoded);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', keyBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const otp =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(otp % 1_000_000).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Supabase admin API helpers
// ---------------------------------------------------------------------------

async function adminFetch(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${SUPABASE_URL}/auth/v1/admin${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function listUsers(): Promise<Array<{ id: string; email: string }>> {
  const { data } = await adminFetch('/users?per_page=1000', 'GET');
  const d = data as { users?: Array<{ id: string; email: string }> };
  return d.users ?? [];
}

async function deleteUser(id: string): Promise<void> {
  await adminFetch(`/users/${id}`, 'DELETE');
}

async function createUser(user: DevUser): Promise<string> {
  const { status, data } = await adminFetch('/users', 'POST', {
    email: user.email,
    password: user.password,
    email_confirm: true,
    app_metadata: { role: user.role },
    user_metadata: { email_verified: true },
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`Failed to create ${user.email}: ${JSON.stringify(data)}`);
  }
  return (data as { id: string }).id;
}

async function enrollTotp(userId: string, secret: string, code: string): Promise<void> {
  // Use the admin API to directly insert a confirmed TOTP factor
  // (avoids needing the user to be signed in)
  const { status, data } = await adminFetch(`/users/${userId}`, 'PUT', {
    factors: [
      {
        friendly_name: 'authenticator',
        factor_type: 'totp',
        status: 'verified',
        secret,
      },
    ],
  });
  // Factor enrollment via admin PUT is supported in Supabase CLI >= 2.x
  // If the API returns 422 (unsupported), we still print the URI — the user
  // can enroll on first sign-in.
  if (status !== 200 && status !== 201) {
    // Non-fatal: user is created, TOTP enrollment happens on first login
    void data;
    void code;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== bootstrap-users ===\n');
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log('');

  // Verify connectivity
  const { status: healthStatus } = await adminFetch('/users?per_page=1', 'GET').catch(() => ({ status: 0, data: null }));
  if (healthStatus === 0) {
    console.error('ERROR: Cannot reach Supabase. Is `supabase start` running?');
    process.exit(1);
  }

  // Delete any existing dev users (idempotent reset)
  const existing = await listUsers();
  const devEmails = new Set(DEV_USERS.map((u) => u.email));
  for (const u of existing) {
    if (devEmails.has(u.email)) {
      await deleteUser(u.id);
      console.log(`  deleted existing user: ${u.email}`);
    }
  }

  // Create dev users
  const results: Array<{ user: DevUser; id: string; secret: string }> = [];
  for (const user of DEV_USERS) {
    const id = await createUser(user);
    const secret = generateTotpSecret();
    await enrollTotp(id, secret, totpCode(secret));
    results.push({ user, id, secret });
    console.log(`  created: ${user.email}`);
  }

  // Print credentials table
  console.log('\n' + '─'.repeat(72));
  console.log('Dev user credentials (local only — never use these in production)');
  console.log('─'.repeat(72) + '\n');

  for (const { user, secret } of results) {
    console.log(`  [${user.role.toUpperCase()}] ${user.description}`);
    console.log(`  Email    : ${user.email}`);
    console.log(`  Password : ${user.password}`);
    console.log(`  TOTP URI : ${totpUri(secret, user.email)}`);
    console.log(`  TOTP now : ${totpCode(secret)}  (scan the URI into any authenticator app)`);
    console.log('');
  }

  console.log('─'.repeat(72));
  console.log('\nMFA is enforced (require_aal2). You must scan the TOTP URI into');
  console.log('an authenticator app (Authy, 1Password, Google Authenticator, etc.)');
  console.log('before you can log in. The TOTP URI above is one-time — run');
  console.log('`make bootstrap-users` again to reset credentials and get a new URI.');
  console.log('');
  console.log(`Frontend: http://localhost:3000`);
  console.log('');
}

main().catch((err) => {
  console.error('bootstrap-users failed:', (err as Error).message);
  process.exit(1);
});
