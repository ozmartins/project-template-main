import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.beforeAll(() => {
	if (!process.env.E2E_AUTH_EMAIL) {
		test.skip(true, "E2E_AUTH_EMAIL not configured — skipping ops-approval suite");
	}
});

const PENDING_APPROVAL = {
	id: "ops-approval-pending-001",
	name: "ops-approval-review",
	version: "3.0.0",
	definition: { steps: [{ id: "approve", type: "human_approval" }] },
	description: "Pending approval item for E2E coverage",
	is_active: false,
	review_status: "pending-review",
	created_at: "2026-06-20T10:00:00.000Z",
	updated_at: "2026-06-20T10:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: null,
};

const LIVE_APPROVAL = {
	id: "ops-approval-live-001",
	name: "ops-approval-review",
	version: "2.0.0",
	definition: { steps: [{ id: "approve", type: "noop" }] },
	description: "Live approval item for E2E coverage",
	is_active: true,
	review_status: "approved",
	created_at: "2026-06-10T10:00:00.000Z",
	updated_at: "2026-06-10T10:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: "2026-06-10T10:00:00.000Z",
};

const APPROVED_VERSION = {
	...PENDING_APPROVAL,
	is_active: true,
	review_status: "approved",
};

const REJECTED_VERSION = {
	...PENDING_APPROVAL,
	review_status: "rejected",
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

async function seedApprovalQueue(page: Page): Promise<void> {
	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "content-range": "0-1/2" },
			body: JSON.stringify([PENDING_APPROVAL, LIVE_APPROVAL]),
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

function getPendingApprovalRow(page: Page) {
	return page
		.locator("button[type='button']")
		.filter({ hasText: PENDING_APPROVAL.name })
		.filter({ hasText: "pending-review" })
		.first();
}

test("pending approvals appear in the approval queue", async ({ page }) => {
	await seedApprovalQueue(page);
	await signIn(page);
	await page.goto("/workflows/definitions");

	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();
	await expect(page.getByText("Pending Review")).toBeVisible();
	await expect(page.getByText("1 pending")).toBeVisible();
	await expect(getPendingApprovalRow(page)).toBeVisible();
});

test("approve flow moves a pending approval to approved", async ({ page }) => {
	let definitionsCallCount = 0;
	let approvePayload: Record<string, unknown> | null = null;

	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		definitionsCallCount += 1;
		const body = definitionsCallCount === 1 ? [PENDING_APPROVAL, LIVE_APPROVAL] : [APPROVED_VERSION];
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
	await getPendingApprovalRow(page).click();

	await page.getByLabel(/reason/i).fill("Approved via ops-approval E2E");
	await page.getByRole("button", { name: /approve/i }).click();

	expect(approvePayload).not.toBeNull();
	expect(approvePayload?.p_id).toBe(PENDING_APPROVAL.id);
	expect(approvePayload?.p_reason).toBe("Approved via ops-approval E2E");
	await expect(page.getByText("Pending Review")).not.toBeVisible({ timeout: 5000 });
	await expect(page.getByText("1 pending")).not.toBeVisible({ timeout: 5000 });
	await expect(page.getByText("Live")).toBeVisible();
	await expect(
		page.locator("button[type='button']").filter({ hasText: APPROVED_VERSION.name }),
	).toBeVisible();
});

test("reject flow rejects a pending approval with a reason", async ({ page }) => {
	let definitionsCallCount = 0;
	let rejectPayload: Record<string, unknown> | null = null;

	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		definitionsCallCount += 1;
		const body =
			definitionsCallCount === 1 ? [PENDING_APPROVAL, LIVE_APPROVAL] : [LIVE_APPROVAL, REJECTED_VERSION];
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
	await page.route("**/rest/v1/rpc/reject_workflow_definition", async (route) => {
		rejectPayload = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: "null",
		});
	});

	await signIn(page);
	await page.goto("/workflows/definitions");
	await getPendingApprovalRow(page).click();

	await page.getByLabel(/reason/i).fill("Rejected via ops-approval E2E");
	await page.getByRole("button", { name: /reject/i }).click();

	expect(rejectPayload).not.toBeNull();
	expect(rejectPayload?.p_id).toBe(PENDING_APPROVAL.id);
	expect(rejectPayload?.p_reason).toBe("Rejected via ops-approval E2E");
	await expect(page.getByText("Pending Review")).not.toBeVisible({ timeout: 5000 });
	await expect(page.getByText("Other Versions")).toBeVisible();
	await expect(page.locator("button[type='button']").filter({ hasText: "rejected" })).toBeVisible();
});
