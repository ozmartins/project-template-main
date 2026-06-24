# Auth & Access Control

This guide explains how to add users, assign roles, and manage MFA in this template. It covers both the **admin operations** (done by a system administrator) and the **end-user flows** (done by the user in the browser).

**Architecture decisions:** ADR-0034 (three-layer auth model), ADR-0035 (role-based UI access control).

---

## How it works

Authentication and access control is enforced at three independent layers:

| Layer | Mechanism | Enforced by |
|---|---|---|
| 1. Login gate | Email + password required before any page loads | `AuthGate` (frontend) |
| 2. MFA gate | TOTP (authenticator app) required after login | `MfaGate` (frontend) + `require_aal2()` DB hook |
| 3. Database grants | `anon` role has zero access; only `authenticated` (aal2) or `service_role` can reach data | Postgres `GRANT` migrations |

The database layer (layer 3) is the authoritative enforcement point — it rejects aal1 tokens even if the frontend gate is somehow bypassed.

---

## Adding a user

Users are created by an administrator using the **Supabase Studio** or the **service role API**. Self-registration is not enabled by default.

### Via Supabase Studio (local dev)

1. Open Studio at `http://localhost:54323`
2. Go to **Authentication → Users → Add user**
3. Fill in email and password
4. Check **Auto Confirm User** (skips the email confirmation step)
5. Click **Create user**

The user will have the `read_only` role by default. Assign a role immediately (see below).

### Via the service role API (scripted / production)

```typescript
import { createClient } from '@supabase/supabase-js';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await admin.auth.admin.createUser({
  email: 'alice@example.com',
  password: 'SecurePass123!',
  email_confirm: true,           // skip email confirmation
  app_metadata: {
    role: 'editor',              // assign role at creation time
    tenant: 'default',           // tenant identifier (for multi-tenant apps)
  },
});
```

**Minimum password length:** 6 characters (configured in `supabase/config.toml` → `minimum_password_length`).

---

## Roles

There are four roles. Each new user defaults to `read_only`.

| Role | canWrite | canReview | canAdminister | Typical use |
|---|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ | System administrators |
| `editor` | ✓ | ✓ | — | Power users who create/edit data |
| `reviewer` | — | ✓ | — | Users who approve/annotate but don't write core data |
| `read_only` | — | — | — | View-only users (default) |

Roles are stored in `auth.users.app_metadata.role` — this field is server-controlled and cannot be modified by the user themselves (unlike `user_metadata`).

### Assigning or changing a role

#### Via Supabase Studio

1. Go to **Authentication → Users**
2. Click the user
3. In the **User Metadata** panel, edit the `app_metadata` JSON:
   ```json
   { "role": "editor", "tenant": "default" }
   ```
4. Click **Save**

The new role takes effect on the user's **next sign-in** (JWT tokens are not revoked; the old token remains valid until it expires in 1 hour).

#### Via the service role API

```typescript
await admin.auth.admin.updateUserById(userId, {
  app_metadata: { role: 'editor', tenant: 'default' },
});
```

### Using roles in the frontend

Use the `useAuthCapabilities()` hook — never compare role strings directly in components:

```typescript
import { useAuthCapabilities } from '@/auth';

function MyComponent() {
  const { canWrite, canReview, canAdminister } = useAuthCapabilities();

  return (
    <>
      {canWrite && <CreateButton />}
      {canReview && <ApproveButton />}
      {canAdminister && <AdminPanel />}
    </>
  );
}
```

The hook returns `false` for all capabilities when there is no session, making it safe to call anywhere in the tree.

---

## MFA (Two-factor authentication)

MFA is **mandatory** for all users. Every user must enroll a TOTP authenticator (Google Authenticator, 1Password, Authy, etc.) before they can access any application data.

### User enrollment flow (browser)

After signing in with email + password, the user is automatically directed to the MFA setup screen:

1. **QR code screen**: User scans the QR code with their authenticator app, or enters the secret manually
2. **Verify screen**: User enters the 6-digit code from their app
3. **Done**: Session is promoted to `aal2` and the application loads

This flow is handled automatically by `MfaGate` — no routing or page navigation is required.

### Subsequent sign-ins

After enrollment, each sign-in requires:
1. Email + password → `aal1` session
2. 6-digit TOTP code challenge → `aal2` session
3. Application loads

### Re-enrolling MFA (user lost their authenticator)

An administrator must unenroll the user's existing factor so they can set up a new one:

#### Via Supabase Studio

1. Go to **Authentication → Users** → click the affected user
2. Scroll to **MFA Factors**
3. Delete the existing TOTP factor
4. The user will be prompted to enroll a new factor on their next sign-in

#### Via the service role API

```typescript
// List the user's factors
const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });

// Delete each TOTP factor
for (const factor of factors?.totp ?? []) {
  await admin.auth.admin.mfa.deleteFactor({ userId, factorId: factor.id });
}
```

After deletion, the user will be presented with the enrollment QR code flow on their next sign-in.

### Disabling mandatory MFA (not recommended)

The MFA requirement is enforced at two levels. Both must be disabled to fully remove it:

1. **Frontend gate** (`MfaGate`): Change `mfaRequired` logic in `AuthContext.tsx` — remove the `!hasVerifiedTotp` check
2. **Database hook**: Drop or no-op the `require_aal2()` function in a new migration

Do not do this in production. The database layer provides defence-in-depth against frontend bypass.

---

## Tenants (multi-tenant apps)

The `tenant` field in `app_metadata` is available for multi-tenant applications. It is included in the JWT and accessible in `useAuth().profile.tenant`.

To use it for row-level isolation, add RLS policies that filter by `(auth.jwt() ->> 'app_metadata')::jsonb ->> 'tenant'`. See ADR-0034 for details.

---

## Local development defaults

When running `supabase start` (or `make up`), the stack uses well-known local-dev JWT keys. These are safe for development but **must not be used in production**.

The local Supabase Studio at `http://localhost:54323` provides a full admin UI for managing users and their roles.

To create a local test user quickly:

```bash
# Using the Supabase CLI
supabase auth create-user --email dev@local.test --password devpass123

# Or via curl (service role key is printed by `supabase status`)
curl -s -X POST http://127.0.0.1:54321/auth/v1/admin/users \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@local.test","password":"devpass123","email_confirm":true,"app_metadata":{"role":"admin","tenant":"default"}}'
```
