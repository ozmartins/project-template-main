import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Gating auth & access-control suite.
// These checks are merge-blocking because the same auth and role-based
// behaviors are already proven green on deployed dev and must not regress.
// Tests skip automatically when E2E_AUTH_EMAIL is not configured (fresh fork).

test.beforeAll(() => {
	if (!process.env.E2E_AUTH_EMAIL) {
		test.skip(true, "E2E_AUTH_EMAIL not configured — skipping auth access-control suite");
	}
});

// MFA prompt appears quickly after credential submit in healthy environments.
const MFA_PROMPT_TIMEOUT_MS = 2_500;
// Verification and post-auth redirects depend on network/back-end round-trips.
const MFA_VERIFY_TIMEOUT_MS = 30_000;
const AUTH_REDIRECT_TIMEOUT_MS = 30_000;
const NEW_ENTITY_CTA = "New Entity";
const ROW_ACTION_NAME = /view/i;
const TOTP_PERIOD_SECONDS = 30;
const MILLISECONDS_PER_SECOND = 1_000;
const TOTP_MODULUS = 1_000_000;

type SignInCredentials = {
	email: string;
	password: string;
	mfaCode?: string;
	mfaSecret?: string;
};

/**
 * Decode an RFC 4648 Base32 TOTP secret into raw bytes.
 * Throws when unsupported characters are present or trailing padding bits are invalid.
 */
function decodeBase32Secret(secret: string): Buffer {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const normalized = secret.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];

	for (const char of normalized) {
		const index = alphabet.indexOf(char);
		if (index < 0) {
			throw new Error("Invalid Base32 TOTP secret.");
		}
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}

	if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
		// Remaining low-order bits must be zero; non-zero means invalid Base32 padding.
		throw new Error("Invalid Base32 TOTP secret padding.");
	}

	return Buffer.from(bytes);
}

/**
 * Generate a 6-digit RFC 6238 TOTP code from a Base32-encoded shared secret.
 */
function generateTotpCode(secret: string): string {
	const key = decodeBase32Secret(secret);
	const counter = Math.floor(Date.now() / MILLISECONDS_PER_SECOND / TOTP_PERIOD_SECONDS);
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(BigInt(counter));
	const hmac = createHmac("sha1", key).update(buffer).digest();
	// RFC 6238 dynamic truncation: low nibble chooses offset, then 31-bit binary code.
	const offset = hmac[hmac.length - 1] & 0x0f;
	const code =
		(((hmac[offset] & 0x7f) << 24) |
			((hmac[offset + 1] & 0xff) << 16) |
			((hmac[offset + 2] & 0xff) << 8) |
			(hmac[offset + 3] & 0xff)) %
		TOTP_MODULUS;
	return code.toString().padStart(6, "0");
}

async function resolveMfaCode(page: Page, credentials: SignInCredentials): Promise<string> {
	const directCode = credentials.mfaCode?.trim();
	if (directCode) {
		return directCode;
	}

	const stableSecret = credentials.mfaSecret?.trim();
	if (stableSecret) {
		return generateTotpCode(stableSecret);
	}

	const enrollmentSecret = (await page.locator("[data-testid='mfa-secret']").textContent())?.trim();
	if (enrollmentSecret) {
		return generateTotpCode(enrollmentSecret);
	}

	throw new Error("MFA challenge detected but no TOTP code or secret is configured.");
}

async function signIn(page: Page, credentials: SignInCredentials): Promise<void> {
	const emailInput = page.locator("[data-testid='login-email']");
	const passwordInput = page.locator("[data-testid='login-password']");

	await page.goto("/");
	await expect(emailInput).toBeVisible();
	await expect(passwordInput).toBeVisible();
	await emailInput.fill(credentials.email);
	await passwordInput.fill(credentials.password);
	await page.locator("[data-testid='login-submit']").click();

	const mfaVisible = await page
		.locator("[data-testid='mfa-card']")
		.waitFor({ state: "visible", timeout: MFA_PROMPT_TIMEOUT_MS })
		.then(() => true)
		.catch(() => false);

	if (mfaVisible) {
		await page.locator("[data-testid='mfa-code']").fill(await resolveMfaCode(page, credentials));
		await page.locator("[data-testid='mfa-submit']").click();
		await page.locator("[data-testid='mfa-card']").waitFor({ state: "hidden", timeout: MFA_VERIFY_TIMEOUT_MS });
	}

	await page.waitForURL("/", { timeout: AUTH_REDIRECT_TIMEOUT_MS });
	await expect(page.locator("[data-testid='login-card']")).toHaveCount(0);
	await expect(page.locator("[data-testid='mfa-card']")).toHaveCount(0);
}

async function signInAsWriteCapable(page: Page): Promise<void> {
	await signIn(page, {
		email: process.env.E2E_AUTH_EMAIL ?? "",
		password: process.env.E2E_AUTH_PASSWORD ?? "",
		mfaCode: process.env.E2E_MFA_CODE,
		mfaSecret: process.env.E2E_MFA_SECRET,
	});
}

async function signInAsReadOnly(page: Page): Promise<void> {
	await signIn(page, {
		email: process.env.E2E_READONLY_EMAIL ?? "",
		password: process.env.E2E_READONLY_PASSWORD ?? "",
		mfaCode: process.env.E2E_READONLY_MFA_CODE,
		mfaSecret: process.env.E2E_READONLY_MFA_SECRET,
	});
}

test("unauthenticated user requesting /entities/portfolio sees login surface", async ({ page }) => {
	await page.goto("/entities/portfolio");

	await expect(page.locator("[data-testid='login-card']")).toBeVisible();
	await expect(page.locator("[data-testid='login-email']")).toBeVisible();
	await expect(page.locator("[data-testid='login-password']")).toBeVisible();
	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toHaveCount(0);
});

test("invalid credentials stay on login and show explicit failure state", async ({ page }) => {
	await page.goto("/");
	await page.locator("[data-testid='login-email']").fill(process.env.E2E_AUTH_EMAIL ?? "");
	await page.locator("[data-testid='login-password']").fill(`${Date.now()}-invalid-password`);
	await page.locator("[data-testid='login-submit']").click();

	const error = page.locator("[data-testid='login-error']");
	await expect(error).toBeVisible();
	await expect(error).toContainText(/.+/);
	await expect(page.locator("[data-testid='login-card']")).toBeVisible();
	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toHaveCount(0);
});

test("write-capable user can access protected entity routes and write controls", async ({ page }) => {
	await signInAsWriteCapable(page);
	await page.goto("/entities/portfolio");

	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const rowCount = await viewButtons.count();
	if (rowCount === 0) {
		await expect(page.getByText(/no entities found/i)).toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/portfolio\/[0-9a-f-]+$/);
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
});

test("read-only user can navigate protected routes without write controls", async ({ page }) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

	await signInAsReadOnly(page);
	await page.goto("/entities/portfolio");

	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		await expect(page.getByText(/no entities found/i)).toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/portfolio\/[0-9a-f-]+$/);
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();

	const backToList = page.getByRole("link", { name: /back to list/i });
	await expect(backToList).toBeVisible();
	await backToList.click();
	await expect(page).toHaveURL(/\/entities\/portfolio\/?$/);
});

// ── workflow-definition review permission gating ──────────────────────────
// Gating: proves the role-based access-control contract on the
// workflow-definition review dialog is enforced in the browser.
// Route interception seeds a deterministic pending-review fixture so the
// assertions never skip because deployed dev lacks pending-review rows.

const DIALOG_DISMISS_TIMEOUT_MS = 5_000;

const WF_DEF_PENDING_FIXTURE = {
	id: "auth-gate-fixture-pending-001",
	name: "smoke-classification",
	version: "2.0.0",
	definition: { steps: [{ id: "start", type: "noop" }] },
	description: "Auth gate E2E fixture — pending-review definition",
	is_active: false,
	review_status: "pending-review",
	created_at: "2026-01-02T00:00:00.000Z",
	updated_at: "2026-01-02T00:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: null,
};

const WF_DEF_LIVE_FIXTURE = {
	id: "auth-gate-fixture-live-001",
	name: "smoke-classification",
	version: "1.0.0",
	definition: { steps: [] },
	description: "Auth gate E2E fixture — live definition",
	is_active: true,
	review_status: "approved",
	created_at: "2025-12-01T00:00:00.000Z",
	updated_at: "2025-12-01T00:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: "2025-12-01T00:00:00.000Z",
};

async function seedDefinitionsFixture(page: Page): Promise<void> {
	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "content-range": "0-1/2" },
			body: JSON.stringify([WF_DEF_PENDING_FIXTURE, WF_DEF_LIVE_FIXTURE]),
		});
	});
	await page.route("**/rest/v1/workflow_definition_audit_log*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([]),
		});
	});
}

function getPendingReviewRow(page: Page) {
	return page
		.locator("button[type='button']")
		.filter({ hasText: "pending-review" })
		.first();
}

test(
	"write-capable user sees Reason field and Approve/Reject controls in the workflow-definition review dialog",
	async ({ page }) => {
		await seedDefinitionsFixture(page);
		await signInAsWriteCapable(page);
		await page.goto("/workflows/definitions");
		await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

		// The Pending Review section must appear because the fixture is seeded.
		await expect(page.getByText("Pending Review")).toBeVisible();

		// Open the pending-review definition row.
		const pendingRow = getPendingReviewRow(page);
		await expect(pendingRow).toBeVisible();
		await pendingRow.click();

		// The diff is always visible regardless of role.
		await expect(page.getByText("Current live")).toBeVisible();
		await expect(page.getByText("Pending (staging)")).toBeVisible();

		// Review-capable controls must be present for an admin/editor/reviewer user.
		await expect(page.getByLabel(/reason/i)).toBeVisible();
		await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
		await expect(page.getByRole("button", { name: /reject/i })).toBeVisible();
	},
);

test(
	"read-only user can inspect the diff but sees no Reason field or Approve/Reject controls in the workflow-definition review dialog",
	async ({ page }) => {
		test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
		test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

		await seedDefinitionsFixture(page);
		await signInAsReadOnly(page);
		await page.goto("/workflows/definitions");
		await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

		// Open the pending-review definition — the fixture guarantees one is present.
		const pendingRow = getPendingReviewRow(page);
		await expect(pendingRow).toBeVisible();
		await pendingRow.click();

		// The diff must remain visible — read_only can inspect pending definitions.
		await expect(page.getByText("Current live")).toBeVisible();
		await expect(page.getByText("Pending (staging)")).toBeVisible();

		// Mutation controls must be absent — read_only does not satisfy canReview.
		await expect(page.getByLabel(/reason/i)).not.toBeVisible();
		await expect(page.getByRole("button", { name: /approve/i })).not.toBeVisible();
		await expect(page.getByRole("button", { name: /reject/i })).not.toBeVisible();
	},
);

test(
	"read-only user workflow-definition review dialog is closeable without mutation affordances",
	async ({ page }) => {
		test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
		test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

		await seedDefinitionsFixture(page);
		await signInAsReadOnly(page);
		await page.goto("/workflows/definitions");
		await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

		const pendingRow = getPendingReviewRow(page);
		await expect(pendingRow).toBeVisible();
		await pendingRow.click();

		// Dialog is open and the diff comparison renders correctly.
		await expect(page.getByText("Current live")).toBeVisible();
		await expect(page.getByText("Pending (staging)")).toBeVisible();

		// Confirm no mutation affordances are present.
		await expect(page.getByLabel(/reason/i)).not.toBeVisible();
		await expect(page.getByRole("button", { name: /approve/i })).not.toBeVisible();
		await expect(page.getByRole("button", { name: /reject/i })).not.toBeVisible();

		// The dialog must be dismissible — the operator is not dead-ended.
		await page.keyboard.press("Escape");
		await expect(page.getByText("Current live")).not.toBeVisible({ timeout: DIALOG_DISMISS_TIMEOUT_MS });
		await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();
	},
);
