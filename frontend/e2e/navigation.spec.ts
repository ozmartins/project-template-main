import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Gating navigation suite.
//
// Proves two behaviors introduced/changed in the flat-sidebar + dashboard refresh:
//   1. Sidebar active-state: only the nav link matching the current entity route
//      receives aria-current="page". No prefix-collision mis-highlighting —
//      navigating to /entities/group must not activate /entities/portfolio etc.
//   2. Dashboard CTA navigation: the hero "View Portfolios" button and the
//      entity-grid inline links land on the expected /entities/* routes.
//   3. Entity creation happy path: the "New Entity" modal submits successfully,
//      closes on success, and the refetched list shows the newly created row.
//
// Tests skip automatically when E2E_AUTH_EMAIL is not configured (fresh fork).
// Assumes the test account has completed MFA enrollment; supply E2E_MFA_CODE with
// a live TOTP code when running against an environment that requires MFA challenge.

test.beforeAll(() => {
	if (!process.env.E2E_AUTH_EMAIL) {
		test.skip(true, "E2E_AUTH_EMAIL not configured — skipping navigation suite");
	}
});

// Scoped to the sidebar <nav> so assertions are unambiguous if aria-current
// is used elsewhere on the page (e.g. breadcrumbs).
const NAV_ACTIVE = "nav [aria-current='page']";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function signIn(page: Page): Promise<void> {
	await page.goto("/");
	await page.locator("[data-testid='login-email']").fill(process.env.E2E_AUTH_EMAIL ?? "");
	await page
		.locator("[data-testid='login-password']")
		.fill(process.env.E2E_AUTH_PASSWORD ?? "");
	await page.locator("[data-testid='login-submit']").click();

	// MFA challenge: present when the test account is aal1 and needs a TOTP code.
	// Short timeout — if auth succeeded without MFA the locator resolves quickly.
	const mfaVisible = await page
		.locator("[data-testid='mfa-code']")
		.waitFor({ state: "visible", timeout: 2_500 })
		.then(() => true)
		.catch(() => false);

	if (mfaVisible) {
		await page.locator("[data-testid='mfa-code']").fill(process.env.E2E_MFA_CODE ?? "");
		await page.locator("[data-testid='mfa-submit']").click();
	}

	await page.waitForURL("/", { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Sidebar active-state tests
// ---------------------------------------------------------------------------

test("sidebar: only the Groups link is active on /entities/group", async ({ page }) => {
	await signIn(page);
	await page.goto("/entities/group");

	// Exactly one nav link must carry aria-current="page"
	await expect(page.locator(NAV_ACTIVE)).toHaveCount(1);
	await expect(page.locator(NAV_ACTIVE)).toContainText("Groups");
});

test("sidebar: active link updates when navigating between entity routes", async ({ page }) => {
	await signIn(page);

	// Start on /entities/group — Groups should be active
	await page.goto("/entities/group");
	await expect(page.locator(NAV_ACTIVE)).toContainText("Groups");

	// Navigate to /entities/portfolio — Portfolios should now be active, not Groups
	await page.goto("/entities/portfolio");
	await expect(page.locator(NAV_ACTIVE)).toHaveCount(1);
	await expect(page.locator(NAV_ACTIVE)).toContainText("Portfolios");
	await expect(page.locator(NAV_ACTIVE)).not.toContainText("Groups");
});

test("sidebar: no entity link is active on the dashboard root (/)", async ({ page }) => {
	await signIn(page);
	await page.goto("/");

	// Entity nav links must all be inactive on the dashboard (only the
	// Dashboard icon link uses a separate active check in the component)
	await expect(page.locator(NAV_ACTIVE)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Dashboard CTA navigation tests
// ---------------------------------------------------------------------------

test("dashboard hero CTA 'View Portfolios' navigates to /entities/portfolio", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/");

	await page.getByRole("button", { name: "View Portfolios" }).click();
	await expect(page).toHaveURL(/\/entities\/portfolio/);
});

test("dashboard entity grid 'Open Groups' link navigates to /entities/group", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/");

	await page.getByText("Open Groups →").click();
	await expect(page).toHaveURL(/\/entities\/group/);
});

test("entity list: creating a new portfolio closes the modal and refreshes the list", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/portfolio");

	const entityName = `Playwright Portfolio ${Date.now()}`;
	const dialog = page.getByRole("dialog", { name: /create new portfolio/i });
	const newEntityRow = page.getByText(entityName);

	await expect(newEntityRow).toHaveCount(0);

	await page.getByRole("button", { name: "New Entity" }).click();
	await expect(dialog).toBeVisible();

	await page.getByLabel("Name").fill(entityName);
	await page.getByLabel("Description").fill("Created by Playwright navigation coverage");
	const entitiesRefetch = page.waitForResponse(
		(response) =>
			response.request().method() === "GET" &&
			response.url().includes("/rest/v1/entities") &&
			response.url().includes("entity_type=eq.portfolio") &&
			response.status() === 200,
	);
	await dialog.getByRole("button", { name: "Create" }).click();

	await entitiesRefetch;
	await expect(dialog).toBeHidden();
	await expect(newEntityRow).toBeVisible();
});
