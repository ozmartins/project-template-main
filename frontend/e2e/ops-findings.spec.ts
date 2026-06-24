import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.beforeAll(() => {
	if (!process.env.E2E_AUTH_EMAIL) {
		test.skip(true, "E2E_AUTH_EMAIL not configured — skipping ops-findings suite");
	}
});

const PENDING_FINDING = {
	id: "ops-finding-pending-001",
	name: "ops-findings-review",
	version: "2.0.0",
	definition: { steps: [{ id: "review", type: "human_approval" }] },
	description: "Pending ops finding for E2E review coverage",
	is_active: false,
	review_status: "pending-review",
	created_at: "2026-06-20T10:00:00.000Z",
	updated_at: "2026-06-20T10:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: null,
};

const LIVE_FINDING = {
	id: "ops-finding-live-001",
	name: "ops-findings-review",
	version: "1.0.0",
	definition: { steps: [{ id: "review", type: "noop" }] },
	description: "Live ops finding for E2E review coverage",
	is_active: true,
	review_status: "approved",
	created_at: "2026-06-10T10:00:00.000Z",
	updated_at: "2026-06-10T10:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: "2026-06-10T10:00:00.000Z",
};

const APPROVED_FINDING = {
	...PENDING_FINDING,
	is_active: true,
	review_status: "approved",
};

async function signIn(page: Page): Promise<void> {
	await page.goto("/");
	await page.locator("[data-testid='login-email']").fill(process.env.E2E_AUTH_EMAIL ?? "");
	await page
		.locator("[data-testid='login-password']")
		.fill(process.env.E2E_AUTH_PASSWORD ?? "");
	await page.locator("[data-testid='login-submit']").click();

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

async function seedFindingsPage(page: Page): Promise<void> {
	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "content-range": "0-1/2" },
			body: JSON.stringify([PENDING_FINDING, LIVE_FINDING]),
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

function getPendingFindingRow(page: Page) {
	return page
		.locator("button[type='button']")
		.filter({ hasText: PENDING_FINDING.name })
		.filter({ hasText: "pending-review" })
		.first();
}

test("ops findings list loads and shows a pending finding", async ({ page }) => {
	await seedFindingsPage(page);
	await signIn(page);
	await page.goto("/workflows/definitions");

	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();
	await expect(page.getByText("Pending Review")).toBeVisible();
	await expect(getPendingFindingRow(page)).toBeVisible();
});

test("operator can open a finding and see the review interface", async ({ page }) => {
	await seedFindingsPage(page);
	await signIn(page);
	await page.goto("/workflows/definitions");

	await getPendingFindingRow(page).click();

	await expect(page.getByText("Current live")).toBeVisible();
	await expect(page.getByText("Pending (staging)")).toBeVisible();
	await expect(page.getByLabel(/reason/i)).toBeVisible();
	await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /reject/i })).toBeVisible();
});

test("operator can approve a finding from the review UI", async ({ page }) => {
	let definitionsCallCount = 0;
	let approvePayload: Record<string, unknown> | null = null;

	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		definitionsCallCount += 1;
		const body = definitionsCallCount === 1 ? [PENDING_FINDING, LIVE_FINDING] : [APPROVED_FINDING];
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "content-range": `0-${body.length - 1}/${body.length}` },
			body: JSON.stringify(body),
		});
	});
	await page.route("**/rest/v1/workflow_definition_audit_log*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([]),
		});
	});
	await page.route("**/rest/v1/rpc/approve_workflow_definition", async (route) => {
		approvePayload = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: "null",
		});
	});

	await signIn(page);
	await page.goto("/workflows/definitions");
	await getPendingFindingRow(page).click();

	await page.getByLabel(/reason/i).fill("Approved via ops-findings E2E");
	await page.getByRole("button", { name: /approve/i }).click();

	await expect(page.getByRole("button", { name: /approve/i })).not.toBeVisible({ timeout: 5000 });
	expect(approvePayload).not.toBeNull();
	expect(approvePayload?.p_id).toBe(PENDING_FINDING.id);
	expect(approvePayload?.p_reason).toBe("Approved via ops-findings E2E");
	await expect(page.getByText("Pending Review")).not.toBeVisible({ timeout: 5000 });
	await expect(page.getByText("Live")).toBeVisible();
	await expect(
		page.locator("button[type='button']").filter({ hasText: `${APPROVED_FINDING.name}` }),
	).toBeVisible();
});
