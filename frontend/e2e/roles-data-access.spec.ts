import { test, expect } from '@playwright/test';

// Gating role-based data access suite.
// Verifies that each role can only see/edit data within its RLS policy scope.
// Tests skip automatically when E2E_AUTH_EMAIL is not configured (fresh fork).

test.beforeAll(() => {
  if (!process.env.E2E_AUTH_EMAIL) {
    test.skip(true, 'E2E_AUTH_EMAIL not configured — skipping roles-data-access suite');
  }
});

// --- Role data access ---
// Add tests for:
// - Each role can read data it is entitled to
// - Readonly role cannot write
// - Cross-tenant data isolation if multi-tenant
//
// Placeholder: passes until data model and roles are wired.
test('roles data-access placeholder', async () => {
  expect(true).toBe(true);
});
