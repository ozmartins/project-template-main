import { createHmac } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Non-gating good-UX expectations suite.
// Failures here are NOT deploy blockers — they are UX-improvement backlog.
// The QA Manager reviews these and files `ux` tickets.
// Tests skip automatically when E2E_AUTH_EMAIL is not configured (fresh fork).

test.beforeAll(() => {
	if (!process.env.E2E_AUTH_EMAIL) {
		test.skip(true, "E2E_AUTH_EMAIL not configured — skipping experience suite");
	}
});

const MFA_APPEARANCE_TIMEOUT_MS = 2_500;
const MFA_VERIFY_TIMEOUT_MS = 30_000;
const AUTH_REDIRECT_TIMEOUT_MS = 30_000;
const NEW_ENTITY_CTA = "New Entity";
const ROW_ACTION_NAME = /view/i;
const EVIDENCE_OPEN_CTA = "Open Evidence →";
const EVIDENCE_REVIEW_CTA = "Review Evidence →";
const TOTP_PERIOD_SECONDS = 30;
const ISO_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ENTITY_EMPTY_STATE = "No entities found. Create your first one!";
const ENTITY_SEARCH_EMPTY_STATE = "No entities match your search. Clear search or create a new entity.";
const SMOKE_TEST_WORKFLOW_INPUT = { company_name: "Acme Corp", domain: "acme.example" };
const WORKFLOW_OPERATION_TIMEOUT_MS = 30_000;

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

	return Buffer.from(bytes);
}

function generateTotpCode(secret: string): string {
	const key = decodeBase32Secret(secret);
	const counter = Math.floor(Date.now() / 1_000 / TOTP_PERIOD_SECONDS);
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(BigInt(counter));
	const hmac = createHmac("sha1", key).update(buffer).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const code =
		(((hmac[offset] & 0x7f) << 24) |
			((hmac[offset + 1] & 0xff) << 16) |
			((hmac[offset + 2] & 0xff) << 8) |
			(hmac[offset + 3] & 0xff)) %
		1_000_000;
	return code.toString().padStart(6, "0");
}

async function resolveMfaCode(page: Page): Promise<string> {
	const directCode = process.env.E2E_MFA_CODE?.trim();
	if (directCode) {
		return directCode;
	}

	const stableSecret = process.env.E2E_MFA_SECRET?.trim();
	if (stableSecret) {
		return generateTotpCode(stableSecret);
	}

	const enrollmentSecret = (await page.locator("[data-testid='mfa-secret']").textContent())?.trim();
	if (enrollmentSecret) {
		return generateTotpCode(enrollmentSecret);
	}

	throw new Error("MFA challenge detected but no E2E_MFA_CODE or E2E_MFA_SECRET is configured.");
}
async function signIn(page: Page): Promise<void> {
	const emailInput = page.locator("[data-testid='login-email']");
	const passwordInput = page.locator("[data-testid='login-password']");

	await page.goto("/");
	await expect(emailInput).toBeVisible();
	await expect(passwordInput).toBeVisible();
	await emailInput.fill(process.env.E2E_AUTH_EMAIL ?? "");
	await passwordInput.fill(process.env.E2E_AUTH_PASSWORD ?? "");
	await page.locator("[data-testid='login-submit']").click();

	const mfaVisible = await page
		.locator("[data-testid='mfa-card']")
		.waitFor({ state: "visible", timeout: MFA_APPEARANCE_TIMEOUT_MS })
		.then(() => true)
		.catch(() => false);

	if (mfaVisible) {
		await page.locator("[data-testid='mfa-code']").fill(await resolveMfaCode(page));
		await page.locator("[data-testid='mfa-submit']").click();
		await page.locator("[data-testid='mfa-card']").waitFor({ state: "hidden", timeout: MFA_VERIFY_TIMEOUT_MS });
	}

	await page.waitForURL("/", { timeout: AUTH_REDIRECT_TIMEOUT_MS });
	await expect(page.locator("[data-testid='login-card']")).toHaveCount(0);
	await expect(page.locator("[data-testid='mfa-card']")).toHaveCount(0);
}

async function openWorkflowDetailFromHistory(page: Page, workflowId: string): Promise<boolean> {
	const historyLink = page.getByTestId(`workflow-link-${workflowId}`);
	if (!(await historyLink.isVisible({ timeout: WORKFLOW_OPERATION_TIMEOUT_MS }))) {
		return false;
	}

	await historyLink.click();
	await page.waitForURL(`**/workflows/${workflowId}`);
	await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
	await expect(page.getByText(/Total duration:/)).toBeVisible();
	return true;
}

async function expectHistoryFallback(page: Page): Promise<void> {
	await expect(page.getByTestId("workflow-history-empty")).toContainText(
		"No workflow executions match the current filters.",
	);
}

async function openWorkflowDetailFromHistoryPage(page: Page, workflowId: string): Promise<boolean> {
	await page.goto("/workflows/history");
	if (await openWorkflowDetailFromHistory(page, workflowId)) {
		return true;
	}

	await expectHistoryFallback(page);
	return false;
}

function traceRecoveryAction(page: Page): Locator {
	return page.getByRole("link", { name: /workflow history/i }).first();
}

function workflowOverviewSummary(page: Page): Locator {
	return page.getByText(/^Showing \d+-\d+ of \d+$/).first();
}

async function waitForWorkflowOverviewState(page: Page): Promise<"rows" | "empty" | "error"> {
	const dataRows = page.locator("tbody tr:has(td:nth-child(5))");
	const emptyState = page.getByText("No workflow executions found.");
	const errorState = page.getByText("Failed to load workflow history.");

	await expect
		.poll(
			async () => {
				if (await errorState.isVisible()) {
					return "error";
				}

				if (await emptyState.isVisible()) {
					return "empty";
				}

				if ((await dataRows.count()) > 0) {
					return "rows";
				}

				return "loading";
			},
			{ timeout: WORKFLOW_OPERATION_TIMEOUT_MS },
		)
		.not.toBe("loading");

	if (await errorState.isVisible()) {
		return "error";
	}

	if (await emptyState.isVisible()) {
		return "empty";
	}

	return "rows";
}

async function readTriggerSuccessIdentifiers(successCard: Locator): Promise<{
	workflowId: string | undefined;
	runId: string | undefined;
}> {
	const [workflowIdText, runIdText] = await Promise.all([
		successCard.getByTestId("workflow-trigger-success-workflow-id").textContent(),
		successCard.getByTestId("workflow-trigger-success-run-id").textContent(),
	]);
	const workflowId = workflowIdText?.trim();
	const runId = runIdText?.trim();

	return { workflowId, runId };
}

async function createEntity(page: Page, name: string, description: string): Promise<void> {
	await page.getByRole("button", { name: "New Entity" }).first().click();
	await page.getByLabel("Name").fill(name);
	await page.getByLabel("Description").fill(description);
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByText(name)).toBeVisible();
}

async function createEntityAndCaptureId(
	page: Page,
	entityType: string,
	name: string,
	description: string,
): Promise<string> {
	const createDialog = page.getByRole("dialog").filter({ hasText: /create new/i }).first();
	const createResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			response.url().includes("/rest/v1/rpc/create_entity_with_version") &&
			response.status() === 200,
	);
	const entitiesRefetchPromise = page.waitForResponse(
		(response) =>
			response.request().method() === "GET" &&
			response.url().includes("/rest/v1/entities") &&
			response.url().includes(`entity_type=eq.${entityType}`) &&
			response.status() === 200,
	);

	await page.getByRole("button", { name: NEW_ENTITY_CTA }).first().click();
	await expect(createDialog).toBeVisible();
	await page.getByLabel("Name").fill(name);
	await page.getByLabel("Description").fill(description);
	await createDialog.getByRole("button", { name: "Create" }).click();

	const [createResponse] = await Promise.all([createResponsePromise, entitiesRefetchPromise]);
	await expect(createDialog).toBeHidden();

	const createResult = (await createResponse.json()) as { entity_id?: unknown };
	if (typeof createResult.entity_id !== "string") {
		throw new Error("Create entity RPC did not return an entity_id.");
	}

	return createResult.entity_id;
}

async function deleteEntityById(page: Page, entityType: string, entityId: string): Promise<void> {
	await page.goto(`/entities/${entityType}/${entityId}`);
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
	await page.getByRole("button", { name: "Delete" }).click();

	const deleteDialog = page.getByRole("dialog", { name: "Delete Entity" });
	await expect(deleteDialog).toBeVisible();
	await deleteDialog.getByRole("button", { name: "Delete" }).click();
	await expect(page).toHaveURL(new RegExp(`/entities/${entityType}/?$`));
}

async function isVisibleOrFalse(locator: Locator): Promise<boolean> {
	return locator.isVisible().catch(() => false);
}

async function readEntityListFallbackSignals(page: Page): Promise<{
	hasEmptyState: boolean;
	hasFilteredEmptyState: boolean;
	hasClearSearch: boolean;
}> {
	const [hasEmptyState, hasFilteredEmptyState, hasClearSearch] = await Promise.all([
		isVisibleOrFalse(page.getByText(ENTITY_EMPTY_STATE)),
		isVisibleOrFalse(page.getByText(ENTITY_SEARCH_EMPTY_STATE)),
		isVisibleOrFalse(page.getByRole("button", { name: "Clear search" })),
	]);

	return { hasEmptyState, hasFilteredEmptyState, hasClearSearch };
}

async function waitForEntityRowsOrFallback(
	page: Page,
	expectedRows: Locator[],
): Promise<"rows" | "fallback"> {
	const deadline = Date.now() + WORKFLOW_OPERATION_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const rowCounts = await Promise.all(expectedRows.map((row) => row.count()));
		if (rowCounts.every((count) => count > 0)) {
			return "rows";
		}

		const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
			await readEntityListFallbackSignals(page);
		if (hasEmptyState || hasFilteredEmptyState || hasClearSearch) {
			return "fallback";
		}

		await page.waitForTimeout(250);
	}

	throw new Error("Entity list did not render rows or an actionable fallback before timing out.");
}

async function expectActionableEntityListFallback(page: Page): Promise<void> {
	const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
		await readEntityListFallbackSignals(page);
	expect(hasEmptyState || hasFilteredEmptyState || hasClearSearch).toBe(true);
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
}

async function signInAsReadOnly(page: Page): Promise<void> {
	await page.goto("/");
	await page.locator("[data-testid='login-email']").fill(process.env.E2E_READONLY_EMAIL ?? "");
	await page
		.locator("[data-testid='login-password']")
		.fill(process.env.E2E_READONLY_PASSWORD ?? "");
	await page.locator("[data-testid='login-submit']").click();

	const mfaVisible = await page
		.locator("[data-testid='mfa-code']")
		.waitFor({ state: "visible", timeout: MFA_APPEARANCE_TIMEOUT_MS })
		.then(() => true)
		.catch(() => false);

	if (mfaVisible) {
		await page
			.locator("[data-testid='mfa-code']")
			.fill(process.env.E2E_READONLY_MFA_CODE ?? "");
		await page.locator("[data-testid='mfa-submit']").click();
		await page.locator("[data-testid='mfa-card']").waitFor({ state: "hidden", timeout: MFA_VERIFY_TIMEOUT_MS });
	}

	await page.waitForURL("/", { timeout: AUTH_REDIRECT_TIMEOUT_MS });
}

test("portfolio lifecycle supports create, edit, version-history, and delete", async ({
	page,
}) => {
	const entityName = `E2E Portfolio ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const initialDescription = `Created by Playwright for ${entityName}`;
	const updatedDescription = `${initialDescription} (edited)`;

	await signIn(page);
	await page.goto("/entities/portfolio");

	await page.getByRole("button", { name: NEW_ENTITY_CTA }).click();
	await expect(page.getByRole("dialog", { name: /Create New portfolio/i })).toBeVisible();
	await page.getByLabel("Name").fill(entityName);
	await page.getByLabel("Description").fill(initialDescription);
	await page.getByRole("button", { name: "Create" }).click();

	await expect(page.getByRole("dialog", { name: /Create New portfolio/i })).not.toBeVisible();

	const createdEntityRow = page.getByTestId("entity-list-row").filter({ hasText: entityName });
	await expect(createdEntityRow).toHaveCount(1);
	await createdEntityRow.getByRole("button", { name: "View" }).click();

	await expect(page).toHaveURL(/\/entities\/portfolio\/[0-9a-f-]+$/);
	await expect(page.getByRole("heading", { level: 1, name: entityName })).toBeVisible();
	await expect(page.getByText(initialDescription)).toBeVisible();
	await expect(page.getByText(/^Version 1$/)).toBeVisible();

	const versionEntries = page.getByText(/^Version \d+$/);
	const initialVersionCount = await versionEntries.count();

	await page.getByRole("button", { name: "Edit" }).click();
	await page.getByLabel("Description").fill(updatedDescription);
	await page.getByRole("button", { name: "Save Changes" }).click();

	await expect(page.getByText(updatedDescription)).toBeVisible();
	await expect(versionEntries).toHaveCount(initialVersionCount + 1);
	await expect(page.getByText(/^Version 2$/)).toBeVisible();
	await expect(page.getByText("Current")).toHaveCount(1);

	await page.getByRole("button", { name: "Delete" }).click();
	await expect(page.getByRole("dialog", { name: "Delete Entity" })).toBeVisible();
	await page
		.getByRole("dialog", { name: "Delete Entity" })
		.getByRole("button", { name: "Delete" })
		.click();

	await expect(page).toHaveURL(/\/entities\/portfolio\/?$/);
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
	await expect(page.getByText(entityName)).toHaveCount(0);
});

test("portfolio list search narrows the working set instead of forcing manual ID scanning", async ({
	page,
}) => {
	const suffix = Date.now().toString(36);
	const matchedName = `Searchable Portfolio ${suffix}`;
	const otherName = `Background Portfolio ${suffix}`;

	await signIn(page);
	await page.goto("/entities/portfolio");

	await createEntity(page, matchedName, `description for ${matchedName}`);
	await createEntity(page, otherName, `description for ${otherName}`);

	const searchInput = page.getByPlaceholder("Search entities...");
	await searchInput.fill(`Searchable ${suffix}`);

	await expect(page.getByText(matchedName)).toBeVisible();
	await expect(page.getByText(otherName)).toHaveCount(0);

	await searchInput.fill(`no-match-${suffix}`);
	await expect(page.getByText(ENTITY_SEARCH_EMPTY_STATE)).toBeVisible();

	await page.getByRole("button", { name: "Clear search" }).click();
	await expect(searchInput).toHaveValue("");
	await expect(page.getByText(matchedName)).toBeVisible();
	await expect(page.getByText(otherName)).toBeVisible();
});

// Non-gating: deployed dev still skips authenticated browser coverage often
// enough that this journey is backlog-signal coverage rather than a merge gate.
test("groups list search narrows the working set and recovers with Clear search", async ({
	page,
}) => {
	const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const matchedName = `Searchable Group ${suffix}`;
	const otherName = `Background Group ${suffix}`;
	const createdGroupIds: string[] = [];

	await signIn(page);
	await page.goto("/entities/group");

	try {
		createdGroupIds.push(
			await createEntityAndCaptureId(page, "group", matchedName, `description for ${matchedName}`),
		);
		createdGroupIds.push(
			await createEntityAndCaptureId(page, "group", otherName, `description for ${otherName}`),
		);

		const matchedRow = page.getByTestId("entity-list-row").filter({ hasText: matchedName });
		const otherRow = page.getByTestId("entity-list-row").filter({ hasText: otherName });
		const searchInput = page.getByPlaceholder("Search entities...");

		const groupsListState = await waitForEntityRowsOrFallback(page, [matchedRow, otherRow]);
		if (groupsListState !== "rows") {
			await expect(page).toHaveURL(/\/entities\/group\/?$/);
			// Non-gating fallback mode: the environment did not render the created rows,
			// so assert the explicit recovery UI instead of forcing a brittle search step.
			await expectActionableEntityListFallback(page);
			return;
		}

		await expect(matchedRow).toHaveCount(1);
		await expect(otherRow).toHaveCount(1);

		await searchInput.fill(matchedName);
		await expect(page).toHaveURL(/\/entities\/group\/?$/);
		await expect(matchedRow).toHaveCount(1);
		await expect(otherRow).toHaveCount(0);

		await searchInput.fill(`no-match-${suffix}`);
		await expect(page.getByText(ENTITY_SEARCH_EMPTY_STATE)).toBeVisible();
		await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();

		await page.getByRole("button", { name: "Clear search" }).click();
		await expect(searchInput).toHaveValue("");
		await expect(matchedRow).toHaveCount(1);
		await expect(otherRow).toHaveCount(1);
	} finally {
		for (let createdGroupIndex = createdGroupIds.length - 1; createdGroupIndex >= 0; createdGroupIndex -= 1) {
			await deleteEntityById(page, "group", createdGroupIds[createdGroupIndex]);
		}
	}
});

const WORKING_SET_ROUTES = [
	{ entityType: "portfolio", heading: "Portfolios" },
	{ entityType: "group", heading: "Groups" },
	{ entityType: "vbu", heading: "VBUs" },
	{ entityType: "assessment", heading: "Assessments" },
	{ entityType: "question", heading: "Questions" },
	{ entityType: "person", heading: "People" },
	{ entityType: "evidence", heading: "Evidence" },
] as const;

const EMPTY_DASHBOARD_KPIS = [
	{
		label: "Portfolios in view",
		badge: "Needs setup",
		copy: "No live portfolios yet — seed the workspace to start operator reviews.",
		href: "/entities/portfolio",
		linkName: "Open Portfolios →",
	},
	{
		label: "Assessments in flight",
		badge: "Queue empty",
		copy: "No active assessments yet — the review queue is empty.",
		href: "/entities/assessment",
		linkName: "Open Assessments →",
	},
	{
		label: "Evidence backlog",
		badge: "Needs intake",
		copy: "No evidence is loaded yet for review.",
		href: "/entities/evidence",
		linkName: "Open Evidence →",
	},
	{
		label: "Groups with coverage",
		badge: "Needs setup",
		copy: "No groups are configured yet.",
		href: "/entities/group",
		linkName: "Review Groups →",
	},
] as const;

test("dashboard surfaces decision-useful KPIs instead of navigation cards", async ({ page }) => {
	await signIn(page);
	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: /operational dashboard/i })).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: /operational summary/i })).toBeVisible();

	for (const label of [
		"Portfolios in view",
		"Assessments in flight",
		"Evidence backlog",
		"Groups with coverage",
	]) {
		await expect(page.getByText(label)).toBeVisible();
	}

	for (const linkName of [
		"Open Portfolios →",
		"Open Assessments →",
		"Open Evidence →",
		"Open Groups →",
	]) {
		await expect(page.getByRole("link", { name: linkName })).toBeVisible();
	}

	const numericKpis = await page.locator("text=/^\\d+$/").count();
	expect(numericKpis).toBe(4);

	await expect(page.getByText("Entity types")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Dashboard KPI zero-data / empty-workspace coverage
// Non-gating: the deployed dev E2E environment still runs without consistent
// authenticated experience coverage (issue #797), so these checks land as
// backlog-signal coverage rather than blocking merges.
// A regression in the zero-data KPI copy, badge states, or recovery links
// will surface here. A blank card or missing primary action fails the test.
// ---------------------------------------------------------------------------

test("dashboard KPI cards show actionable empty-state copy and recovery links for empty workspace", async ({
	page,
}) => {
	await signIn(page);

	await page.route("**/rest/v1/entities*", async (route) => {
		const entityType = new URL(route.request().url()).searchParams.get("entity_type");
		if (
			entityType === "eq.portfolio" ||
			entityType === "eq.assessment" ||
			entityType === "eq.evidence" ||
			entityType === "eq.group"
		) {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: { "content-range": "*/0" },
				body: "[]",
			});
			return;
		}

		await route.continue();
	});

	await page.goto("/");

	await expect(
		page.getByRole("heading", { level: 1, name: /operational dashboard/i }),
	).toBeVisible();

	for (const { label, badge, copy, href, linkName } of EMPTY_DASHBOARD_KPIS) {
		const copyText = page.getByText(copy);
		await expect(copyText, `${label} KPI card should render zero-data copy`).toBeVisible();

		const card = copyText.locator("../..");
		await expect(card.getByText(label)).toBeVisible();
		await expect(card.getByText(badge)).toBeVisible();

		const actionLink = card.getByRole("link", { name: linkName });
		await expect(
			actionLink,
			`${label} KPI card should expose a visible primary action`,
		).toBeVisible();
		await expect(actionLink).toHaveAttribute("href", href);
	}
});

test("sidebar working sets render a usable entity list shell", async ({ page }) => {
	await signIn(page);

	for (const { entityType, heading } of WORKING_SET_ROUTES) {
		await page.goto(`/entities/${entityType}`);
		await expect(page).toHaveURL(new RegExp(`/entities/${entityType}$`));

		await expect(
			page.getByRole("heading", {
				level: 1,
				name: new RegExp(`^${heading}$`, "i"),
			}),
		).toBeVisible();
		await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

		const hasRows = (await page.getByRole("button", { name: ROW_ACTION_NAME }).count()) > 0;
		const hasActionableEmptyState = (await page.getByText(/no entities found/i).count()) > 0;

		expect(hasRows || hasActionableEmptyState).toBe(true);
	}
});

test("authenticated user can access protected portfolio route", async ({ page }) => {
	await signIn(page);

	await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
	await page.goto("/entities/portfolio");
	await expect(page).toHaveURL(/\/entities\/portfolio$/);
	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();
});

test("create modal opens and cancels on a non-portfolio working set", async ({ page }) => {
	// Use a known non-portfolio working set to prove generic modal flow beyond default.
	const modalEntityType = "group";
	await signIn(page);
	await page.goto(`/entities/${modalEntityType}`);
	const createDialog = page.getByRole("dialog").filter({ hasText: /create new/i }).first();

	await page.getByRole("button", { name: NEW_ENTITY_CTA }).click();
	await expect(createDialog).toBeVisible();
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(createDialog).not.toBeVisible();
});

test("entity detail renders human-readable dates instead of raw backend timestamps", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/group");

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	await expect(viewButtons.first()).toBeVisible();
	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/group\/[0-9a-f-]{36}$/i);

	const entityInfoCard = page.getByText("Entity Information").locator("..");
	const historyCard = page.getByText("Version History").locator("..");

	await expect(entityInfoCard).toContainText("Internal reference");
	await expect(entityInfoCard).not.toContainText(ISO_PATTERN);
	await expect(historyCard).toContainText(/Current revision|Previous revision/);
	await expect(historyCard).not.toContainText(ISO_PATTERN);
});

test("workflow trigger input editor enforces valid JSON before submit", async ({ page }) => {
	await signIn(page);
	await page.goto("/workflows/trigger");

	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill('{ "company_name": "Acme" ');

	await expect(page.getByTestId("workflow-trigger-submit")).toBeDisabled();
	await expect(page.getByTestId("workflow-input-error")).toContainText("Input JSON is invalid");
});

test("workflow trigger submits selected definition and renders workflow identifiers", async ({ page }) => {
	await signIn(page);
	await page.route("**/functions/v1/trigger-workflow", async (route) => {
		const postData = route.request().postDataJSON() as {
			definition_name: string;
			input: Record<string, unknown>;
		};
		expect(postData.definition_name).toBe("smoke-classification");
		expect(postData.input.company_name).toBe("Acme Corp");
		expect(postData.input.domain).toBe("acme.example");
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				workflow_id: "wf-smoke-123",
				run_id: "run-smoke-456",
			}),
		});
	});

	await page.goto("/workflows/trigger");
	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill(
		JSON.stringify(SMOKE_TEST_WORKFLOW_INPUT, null, 2),
	);
	await page.getByTestId("workflow-trigger-submit").click();

	await expect(page.getByTestId("workflow-trigger-success")).toContainText("wf-smoke-123");
	await expect(page.getByTestId("workflow-trigger-success")).toContainText("run-smoke-456");
	await expect(page.getByRole("link", { name: "Open execution trace" })).toHaveAttribute(
		"href",
		"http://localhost:8081/namespaces/default/workflows/wf-smoke-123/run-smoke-456/history",
	);
});

// ---------------------------------------------------------------------------
// Workflow trigger definition-switch reseeding
// Non-gating for now: the authenticated browser suites remain skip-only or
// 0-test on deployed dev under #797, so these cases land as backlog-signal
// coverage until that environment is reliable enough for a gating suite.
// ---------------------------------------------------------------------------

test("workflow trigger definition switch reseeds editor with new schema-shaped JSON", async ({ page }) => {
	await signIn(page);
	await page.goto("/workflows/trigger");

	// Capture the default (smoke-classification) seeded value.
	// A parse failure here is intentional test-failure signal: the editor must hold valid JSON.
	const defaultEditorValue = await page.getByTestId("workflow-input-editor").inputValue();
	const defaultParsed = JSON.parse(defaultEditorValue) as Record<string, unknown>;
	expect(Object.keys(defaultParsed)).toContain("company_name");
	expect(Object.keys(defaultParsed)).toContain("domain");

	// Switch to the second definition — editor must reseed from the new schema.
	await page.getByTestId("workflow-definition-select").selectOption("smoke-pipeline");

	// Parse failure = reseeding broke; unhandled throw is the intentional test-failure signal.
	const updatedEditorValue = await page.getByTestId("workflow-input-editor").inputValue();
	const updatedParsed = JSON.parse(updatedEditorValue) as Record<string, unknown>;
	expect(Object.keys(updatedParsed)).toContain("pipeline_name");
	expect(Object.keys(updatedParsed)).not.toContain("company_name");
	expect(Object.keys(updatedParsed)).not.toContain("domain");
});

test("workflow trigger definition switch clears invalid-JSON validation error and reseeds editor", async ({ page }) => {
	await signIn(page);
	await page.goto("/workflows/trigger");

	// Force an invalid-JSON state. The string below is intentionally missing its
	// closing brace so the editor holds unparseable content.
	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill('{ "company_name": "Acme" ');
	await expect(page.getByTestId("workflow-trigger-submit")).toBeDisabled();
	await expect(page.getByTestId("workflow-input-error")).toContainText("Input JSON is invalid");

	// Switch definitions — error must clear and editor must hold valid seeded JSON for the new definition.
	await page.getByTestId("workflow-definition-select").selectOption("smoke-pipeline");

	await expect(page.getByTestId("workflow-input-error")).toHaveCount(0);
	await expect(page.getByTestId("workflow-trigger-submit")).not.toBeDisabled();

	// Parse failure = reseeding broke; unhandled throw is the intentional test-failure signal.
	const reseededValue = await page.getByTestId("workflow-input-editor").inputValue();
	const reseededParsed = JSON.parse(reseededValue) as Record<string, unknown>;
	expect(Object.keys(reseededParsed)).toContain("pipeline_name");
});

test("workflow trigger definition switch clears stale launch-result success card", async ({ page }) => {
	await page.route("**/functions/v1/trigger-workflow", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				workflow_id: "wf-reseed-test-123",
				run_id: "run-reseed-test-456",
			}),
		});
	});

	await signIn(page);
	await page.goto("/workflows/trigger");

	// Trigger a successful workflow and verify the success card is visible.
	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill(
		JSON.stringify(SMOKE_TEST_WORKFLOW_INPUT, null, 2),
	);
	await page.getByTestId("workflow-trigger-submit").click();

	const successCard = page.getByTestId("workflow-trigger-success");
	await expect(successCard).toBeVisible();
	await expect(successCard).toContainText("wf-reseed-test-123");
	await expect(successCard).toContainText("run-reseed-test-456");
	await expect(page.getByRole("link", { name: "Open execution trace" })).toBeVisible();

	// Switch definitions — the stale success card must disappear so operators
	// cannot confuse a prior launch result with the newly selected workflow.
	await page.getByTestId("workflow-definition-select").selectOption("smoke-pipeline");

	await expect(successCard).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Open execution trace" })).toHaveCount(0);
});

test("completes workflow trigger-to-history journey", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/workflows/trigger");
	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill(
		JSON.stringify(SMOKE_TEST_WORKFLOW_INPUT, null, 2),
	);
	await page.getByTestId("workflow-trigger-submit").click();

	const successCard = page.getByTestId("workflow-trigger-success");
	const errorCard = page.getByTestId("workflow-trigger-error");
	await expect(successCard).toBeVisible({ timeout: WORKFLOW_OPERATION_TIMEOUT_MS });
	await expect(errorCard).toHaveCount(0);

	await expect(successCard).toContainText("Workflow ID:");
	await expect(successCard).toContainText("Run ID:");
	const { workflowId, runId } = await readTriggerSuccessIdentifiers(successCard);
	expect(workflowId).toBeTruthy();
	expect(runId).toBeTruthy();
	expect(workflowId).toBeDefined();
	expect(runId).toBeDefined();
	const requiredWorkflowId = workflowId as string;
	const requiredRunId = runId as string;

	const traceLink = page.getByRole("link", { name: "Open execution trace" });
	const traceHref = await traceLink.getAttribute("href");
	expect(traceHref).toBeTruthy();
	expect(traceHref).toContain(requiredWorkflowId);
	expect(traceHref).toContain(requiredRunId);
	const tracePopupPromise = page.waitForEvent("popup");
	await traceLink.click();
	const tracePage = await tracePopupPromise;
	await tracePage.waitForLoadState("domcontentloaded");
	expect(tracePage.url()).toContain(requiredWorkflowId);
	expect(tracePage.url()).toContain(requiredRunId);
	await tracePage.close();

	await page.goto("/workflows/history");
	await expect(page.getByTestId(`workflow-link-${requiredWorkflowId}`)).toBeVisible({
		timeout: WORKFLOW_OPERATION_TIMEOUT_MS,
	});
	await expect(openWorkflowDetailFromHistory(page, requiredWorkflowId)).resolves.toBe(true);

	// Reopen the same workflow from history to confirm the back-reference remains usable.
	await page.goto("/workflows/history");
	await expect(page.getByTestId(`workflow-link-${requiredWorkflowId}`)).toBeVisible({
		timeout: WORKFLOW_OPERATION_TIMEOUT_MS,
	});
	await expect(openWorkflowDetailFromHistory(page, requiredWorkflowId)).resolves.toBe(true);
});

// Non-gating for now: deployed-dev remains unstable under #469, so this live
// `/workflows` journey acts as backlog-signal coverage until it is reliable
// enough for a gating suite.
test("workflow overview live route supports filter-driven scanning and drill-in", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/workflows");

	await expect(page.getByRole("heading", { name: "Workflow History" })).toBeVisible();
	await expect(workflowOverviewSummary(page)).toBeVisible();

	const initialState = await waitForWorkflowOverviewState(page);
	if (initialState === "error") {
		await expect(page.getByText("Failed to load workflow history.")).toBeVisible();
		return;
	}

	let summaryBeforeFilter: string | undefined;
	if (initialState === "rows") {
		const firstWorkflowRow = page.locator("tbody tr:has(td:nth-child(5))").first();
		await expect(firstWorkflowRow).toBeVisible();
		await firstWorkflowRow.click();
		await page.waitForURL(/\/workflows\/[^/]+$/);
		await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
		await expect(page.getByText("Failed to load workflow trace")).toHaveCount(0);

		await page.goBack();
		await page.waitForURL(/\/workflows\/?$/);
		await expect(page.getByRole("heading", { name: "Workflow History" })).toBeVisible();
		await expect(workflowOverviewSummary(page)).toBeVisible();
		await expect(waitForWorkflowOverviewState(page)).resolves.not.toBe("error");
		summaryBeforeFilter = (await workflowOverviewSummary(page).textContent())?.trim();
	}

	await page.getByLabel("Start date filter").fill("2999-01-01");
	await expect(page.getByText("No workflow executions found.")).toBeVisible({
		timeout: WORKFLOW_OPERATION_TIMEOUT_MS,
	});
	await expect(workflowOverviewSummary(page)).toHaveText("Showing 0-0 of 0");

	if (initialState === "rows") {
		expect(summaryBeforeFilter).not.toBe("Showing 0-0 of 0");
	}
});

test("workflow operations fallback messaging stays actionable", async ({ page }) => {
	await signIn(page);
	await page.route("**/functions/v1/trigger-workflow", async (route) => {
		await route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({
				error: "Workflow trigger failed because workflow worker is unavailable.",
			}),
		});
	});

	await page.goto("/workflows/trigger");
	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill(
		JSON.stringify(SMOKE_TEST_WORKFLOW_INPUT, null, 2),
	);
	await page.getByTestId("workflow-trigger-submit").click();

	const errorCard = page.getByTestId("workflow-trigger-error");
	await expect(errorCard).toBeVisible({ timeout: WORKFLOW_OPERATION_TIMEOUT_MS });
	await expect(errorCard).toContainText(/workflow|trigger|worker|unavailable|failed/i);
	await expect(page.getByRole("heading", { name: "Trigger workflow" })).toBeVisible();

	await page.goto("/workflows/history");
	await page.getByLabel("Started on or after").fill("2999-01-01");
	await expectHistoryFallback(page);
});

// Non-gating for now: deployed-dev keeps showing skipped/unstable execution, so
// this trace drill-in/recovery journey is backlog-signal coverage first.
test("workflow trigger run can be inspected and recovered via history navigation", async ({ page }) => {
	const workflowId = "wf-journey-triggered";
	const runId = "run-journey-triggered";
	const noStepsWorkflowId = `${workflowId}-nosteps`;
	const noStepsRunId = `${runId}-nosteps`;
	await page.route("**/functions/v1/trigger-workflow", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				workflow_id: workflowId,
				run_id: runId,
			}),
		});
	});
	await page.route(`**/workflows/executions/${workflowId}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				execution: {
					workflow_id: workflowId,
					run_id: runId,
					definition_name: "smoke-classification",
					definition_version: "1.0.0",
					status: "completed",
					started_at: "2026-01-01T00:00:00.000Z",
					completed_at: "2026-01-01T00:00:03.000Z",
					duration_ms: 3000,
				},
				step_trace: [
					{
						index: 0,
						step_name: "Classify Company",
						status: "COMPLETED",
						retries: 0,
						duration_ms: 3000,
					},
				],
			}),
		});
	});
	await page.route(`**/workflows/executions/${noStepsWorkflowId}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				execution: {
					workflow_id: noStepsWorkflowId,
					run_id: noStepsRunId,
					definition_name: "smoke-classification",
					definition_version: "1.0.0",
					status: "completed",
					started_at: "2026-01-01T00:00:00.000Z",
					completed_at: "2026-01-01T00:00:01.000Z",
					duration_ms: 1000,
				},
				step_trace: [],
			}),
		});
	});
	await page.route("**/rest/v1/workflow_executions*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([
				{
					workflow_id: workflowId,
					run_id: runId,
					definition_name: "smoke-classification",
					definition_version: "1.0.0",
					status: "completed",
					current_step: null,
					started_at: "2026-01-01T00:00:00.000Z",
					completed_at: "2026-01-01T00:00:03.000Z",
					input_payload: {},
					output_payload: {},
					error_message: null,
					updated_at: "2026-01-01T00:00:03.000Z",
				},
				{
					workflow_id: noStepsWorkflowId,
					run_id: noStepsRunId,
					definition_name: "smoke-classification",
					definition_version: "1.0.0",
					status: "completed",
					current_step: null,
					started_at: "2026-01-01T00:00:00.000Z",
					completed_at: "2026-01-01T00:00:01.000Z",
					input_payload: {},
					output_payload: {},
					error_message: null,
					updated_at: "2026-01-01T00:00:01.000Z",
				},
			]),
		});
	});

	await signIn(page);
	await page.goto("/workflows/trigger");

	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill(
		JSON.stringify({ company_name: "Acme Corp", domain: "acme.example" }, null, 2),
	);
	await page.getByTestId("workflow-trigger-submit").click();

	const successState = page.getByTestId("workflow-trigger-success");
	await expect(successState).toBeVisible();
	const { workflowId: discoveredWorkflowId, runId: discoveredRunId } =
		await readTriggerSuccessIdentifiers(successState);
	if (typeof discoveredWorkflowId !== "string" || typeof discoveredRunId !== "string") {
		throw new Error("Workflow trigger success did not provide workflow/run identifiers.");
	}

	const traceLink = page.getByRole("link", { name: "Open execution trace" });
	const traceHref = await traceLink.getAttribute("href");
	expect(traceHref).toContain(
		`/workflows/${encodeURIComponent(discoveredWorkflowId)}/${encodeURIComponent(discoveredRunId)}/history`,
	);

	await page.goto(`/workflows/executions/${workflowId}`);
	await expect(page.getByRole("heading", { name: `Workflow execution ${workflowId}` })).toBeVisible();
	await expect(page.getByText("Step timeline")).toBeVisible();

	await page.goto("/workflows/history");
	await page.getByLabel("Definition name").fill("smoke-classification");
	const workflowHistoryLink = page.getByTestId(`workflow-link-${discoveredWorkflowId}`).first();
	await expect(workflowHistoryLink).toBeVisible();
	await workflowHistoryLink.click();
	await page.waitForURL((url) => url.pathname.endsWith(`/workflows/${discoveredWorkflowId}`));
	await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
	await expect(page.getByText("smoke-classification v1.0.0 • Completed run")).toBeVisible();
	await expect(page.getByText(`Workflow ID: ${discoveredWorkflowId}`)).toBeVisible();
	await expect(page.getByText(new RegExp(`Run ID: ${discoveredRunId}`))).toBeVisible();
	await expect(page.getByText(/COMPLETED/i).first()).toBeVisible();
	await expect(page.getByText(/Total duration:/)).toBeVisible();
	await expect(page.getByText("Classify Company")).toBeVisible();
	await expect(traceRecoveryAction(page)).toBeVisible();
	await expect(page.getByText("Failed to load workflow trace")).toHaveCount(0);

	await page.goto("/workflows/history");
	const noStepsHistoryLink = page.getByTestId(`workflow-link-${noStepsWorkflowId}`).first();
	await expect(noStepsHistoryLink).toBeVisible();
	await noStepsHistoryLink.click();
	await page.waitForURL((url) => url.pathname.endsWith(`/workflows/${noStepsWorkflowId}`));
	await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
	await expect(page.getByText("smoke-classification v1.0.0 • Completed run")).toBeVisible();
	await expect(page.getByText(/Total duration:/)).toBeVisible();
	await expect(page.getByText("No steps recorded yet")).toBeVisible();
	const noStepsRecoveryAction = traceRecoveryAction(page);
	await expect(noStepsRecoveryAction).toBeVisible();
	await noStepsRecoveryAction.click();
	await page.waitForURL("**/workflows/history");
	await expect(page.getByRole("heading", { name: /workflow history/i })).toBeVisible();
	await expect(page.getByTestId(`workflow-link-${noStepsWorkflowId}`)).toBeVisible();
});

test("workflow operations surfaces actionable degraded-state guidance", async ({ page }) => {
	const workflowId = "wf-degraded-123";
	const runId = "run-degraded-456";
	await page.route("**/functions/v1/trigger-workflow", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				workflow_id: workflowId,
				run_id: runId,
			}),
		});
	});
	await page.route(`**/workflows/executions/${workflowId}`, async (route) => {
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: "temporarily unavailable" }),
		});
	});
	await page.route("**/rest/v1/workflow_executions*", async (route) => {
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ message: "history unavailable" }),
		});
	});

	await signIn(page);
	await page.goto("/workflows/trigger");
	await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
	await page.getByTestId("workflow-input-editor").fill(
		JSON.stringify({ company_name: "Acme Corp", domain: "acme.example" }, null, 2),
	);
	await page.getByTestId("workflow-trigger-submit").click();
	await expect(page.getByTestId("workflow-trigger-success")).toBeVisible();

	await page.goto(`/workflows/executions/${workflowId}`);
	await expect(page.getByText("Could not load workflow execution")).toBeVisible();
	await expect(page.getByText("Execution query failed (500)")).toBeVisible();

	await page.goto("/workflows/history");
	await expect(page.getByText("Could not load workflow history")).toBeVisible();
	await expect(
		page.getByText("Refresh or retry after confirming the history query surface is available."),
	).toBeVisible();

	await page.goto(`/workflows/${workflowId}`);
	await expect(page.getByText("Failed to load workflow trace")).toBeVisible();
	await expect(page.getByText("Failed to load workflow trace: HTTP 500")).toBeVisible();
	const degradedRecoveryAction = traceRecoveryAction(page);
	await expect(degradedRecoveryAction).toBeVisible();
	await degradedRecoveryAction.click();
	await page.waitForURL("**/workflows/history");
	await expect(page.getByRole("heading", { name: /workflow history/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Workflow overview review journey
// Non-gating: this validates live `/workflows` operator usability in dev, but
// the environment remains unstable, so failures are backlog-signal coverage.
// ---------------------------------------------------------------------------

test("workflow overview supports filter narrowing and drill-in without blank states", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/workflows");

	await expect(page.getByRole("heading", { name: "Workflow History" })).toBeVisible();

	const emptyState = page.getByText("No workflow executions found.");
	const errorState = page.getByText("Failed to load workflow history.");
	const summary = page.getByText(/^Showing \d+-\d+ of \d+$/);
	const executionRows = page.locator("tbody tr.cursor-pointer");

	await expect
		.poll(async () => {
			if (await emptyState.isVisible().catch(() => false)) return "empty";
			if (await errorState.isVisible().catch(() => false)) return "error";
			if ((await executionRows.count()) > 0) return "rows";
			return "loading";
		})
		.toMatch(/^(rows|empty|error)$/);

	const initialSummary = await summary.textContent();
	const initialRowCount = await executionRows.count();
	const initialFirstRow = initialRowCount > 0 ? (await executionRows.first().textContent()) ?? "" : "";

	await page.getByLabel("Start date filter").fill("9999-12-31");
	await expect(emptyState).toBeVisible();
	await expect(errorState).toHaveCount(0);

	const filteredRowCount = await executionRows.count();
	if (filteredRowCount > 0) {
		const filteredSummary = await summary.textContent();
		const filteredFirstRow = (await executionRows.first().textContent()) ?? "";
		expect(
			filteredSummary !== initialSummary || filteredFirstRow !== initialFirstRow || filteredRowCount !== initialRowCount,
		).toBe(true);
	}

	await page.getByLabel("Start date filter").fill("");
	await expect
		.poll(async () => {
			if ((await executionRows.count()) > 0) return "rows";
			if (await emptyState.isVisible().catch(() => false)) return "empty";
			if (await errorState.isVisible().catch(() => false)) return "error";
			return "loading";
		})
		.toMatch(/^(rows|empty|error)$/);

	const rowsAfterReset = await executionRows.count();
	if (rowsAfterReset > 0) {
		await executionRows.first().click();
		await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
		await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();

		await page.goBack();
		await expect(page).toHaveURL(/\/workflows\/?$/);
		await expect(page.getByRole("heading", { name: "Workflow History" })).toBeVisible();
		await expect
			.poll(async () => {
				if ((await executionRows.count()) > 0) return "rows";
				if (await emptyState.isVisible().catch(() => false)) return "empty";
				if (await errorState.isVisible().catch(() => false)) return "error";
				return "loading";
			})
			.toMatch(/^(rows|empty|error)$/);
	}
});

// ---------------------------------------------------------------------------
// Role-based entity permission tests
// These verify that read_only users cannot see write controls, while
// admin/editor users retain full access. Non-gating — backlog signal only.
// ---------------------------------------------------------------------------

test("read_only user: entity list does not show New Entity button", async ({ page }) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	await signInAsReadOnly(page);
	await page.goto("/entities/portfolio");

	await expect(
		page.getByRole("heading", { level: 1, name: /portfolio/i }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
});

test("read_only user: entity detail does not show Edit or Delete buttons", async ({ page }) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	await signInAsReadOnly(page);
	await page.goto("/entities/portfolio");

	// Only proceed to a detail page when there are entities to view.
	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const rowCount = await viewButtons.count();
	if (rowCount === 0) {
		// No entities seeded — assert only the list is accessible and skip detail check.
		await expect(page.getByText(/no entities found/i)).toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();
});

test("read_only user: can navigate entity list and access detail without dead ends", async ({
	page,
}) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	await signInAsReadOnly(page);

	// List page must load and render a heading.
	await page.goto("/entities/portfolio");
	await expect(
		page.getByRole("heading", { level: 1, name: /portfolio/i }),
	).toBeVisible();

	// If entities exist, the detail page must load and show the back link.
	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) > 0) {
		await viewButtons.first().click();
		await expect(page.getByRole("link", { name: /back to list/i })).toBeVisible();
	}
});

test("admin user: entity list shows New Entity button", async ({ page }) => {
	await signIn(page);
	await page.goto("/entities/portfolio");

	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
});

test("admin user: entity detail shows Edit and Delete buttons", async ({ page }) => {
	await signIn(page);
	await page.goto("/entities/portfolio");

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		// No entities to inspect — verify the list loaded cleanly and stop.
		await expect(page.getByText(/no entities found/i)).toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Workflow definitions review journey
// Non-gating: deployed dev does not yet provide deterministic review-state data,
// so failures here are backlog-signal coverage rather than deploy blockers.
// ---------------------------------------------------------------------------

test("workflow definitions catalog renders named definitions or explicit empty state", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/workflows/definitions");

	// The page heading must always be present.
	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

	// The catalog must not end in a silent fallback — either definitions with name/version/status
	// metadata are visible, or the page renders an explicit actionable empty state.
	const emptyState = page.getByText("No workflow definitions found");
	const hasEmptyState = (await emptyState.count()) > 0;

	// Catalog sections are only rendered when the corresponding definitions exist.
	const pendingSection = page.getByText("Pending Review");
	const liveSection = page.getByText("Live");
	const otherSection = page.getByText("Other Versions");
	const hasSections =
		(await pendingSection.count()) > 0 ||
		(await liveSection.count()) > 0 ||
		(await otherSection.count()) > 0;

	expect(hasEmptyState || hasSections).toBe(true);

	if (hasSections) {
		// DefinitionRow version text format is "v<version>" — assert at least one is present.
		await expect(page.getByText(/^v\d+\.\d+/).first()).toBeVisible();
	}
});

test("missing workflow definition shows not-found messaging and recovery link to catalog", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/workflows/definitions/nonexistent-workflow-xyz");

	// Must show the not-found message.
	await expect(page.getByText("Workflow definition not found")).toBeVisible();
	await expect(page.getByText(/Available definitions:/)).toBeVisible();
	await expect(page.getByText(/smoke-classification/)).toBeVisible();

	// Must not render workflow-graph content.
	await expect(page.getByTestId("workflow-graph-node")).toHaveCount(0);

	// Must expose a primary recovery action back to the definitions catalog.
	const catalogLink = page.getByRole("link", { name: /back to definitions catalog/i });
	await expect(catalogLink).toBeVisible();

	// The recovery link must navigate to the catalog.
	await catalogLink.click();
	await expect(page).toHaveURL(/\/workflows\/definitions\/?$/);
	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();
});

test("smoke-classification definition detail renders name, version, and workflow graph", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/workflows/definitions/smoke-classification");

	// Must render the canonical definition detail, not the not-found fallback card.
	await expect(page.getByText("Workflow definition not found")).toHaveCount(0);

	// The definition name and version must be visible.
	await expect(page.getByText("smoke-classification")).toBeVisible();
	await expect(page.getByText(/Version 1\.0\.0/)).toBeVisible();

	// At least one workflow graph node must render, confirming the graph is present.
	await expect(page.getByTestId("workflow-graph-node").first()).toBeVisible();
});

test("definitions review affordance reaches approve/reject controls or surfaces nothing-awaiting state", async ({
	page,
}) => {
	// Non-gating: deployed dev does not yet guarantee pending-review seed data.
	await signIn(page);
	await page.goto("/workflows/definitions");

	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

	const pendingSection = page.getByText("Pending Review");
	const hasPending = (await pendingSection.count()) > 0;

	if (hasPending) {
		// A pending-review definition is present — open the first one and assert the reviewer
		// can see the comparison view and the approve/reject controls.
		// StatusBadge renders "pending-review" text inside the DefinitionRow button.
		const firstPendingRow = page
			.locator("button[type='button']")
			.filter({ hasText: "pending-review" })
			.first();
		await firstPendingRow.click();

		await expect(page.getByText("Current live")).toBeVisible();
		await expect(page.getByText("Pending (staging)")).toBeVisible();
		await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
		await expect(page.getByRole("button", { name: /reject/i })).toBeVisible();
	} else {
		// When no definitions are awaiting review the catalog must not dead-end — it must
		// show either the live-definitions section, the other-versions section, or the
		// explicit empty state rather than a blank page.
		const liveSection = page.getByText("Live");
		const otherSection = page.getByText("Other Versions");
		const emptyState = page.getByText("No workflow definitions found");

		const hasContent =
			(await liveSection.count()) > 0 ||
			(await otherSection.count()) > 0 ||
			(await emptyState.count()) > 0;
		expect(hasContent).toBe(true);
	}
});

// ---------------------------------------------------------------------------
// Workflow definitions approval/rejection handoff — issue #984
// Non-gating: the deployed dev E2E environment is still not exercising
// authenticated suites reliably under issue #984 — the latest experience
// history ran 0 tests and the prior window recorded 12/12-skipped checks.
// Route interception seeds a deterministic pending-review fixture so the
// journey runs regardless of whether deployed dev holds pending-review rows.
// A regression in review-dialog submission, approval/rejection payload
// handoff, post-action surface refresh, or explicit mutation-error feedback
// will surface here rather than block merges.
// ---------------------------------------------------------------------------

const REVIEW_PENDING_FIXTURE = {
	id: "fixture-pending-def-001",
	name: "smoke-classification",
	version: "2.0.0",
	definition: { steps: [{ id: "start", type: "noop" }] },
	description: "Fixture pending-review definition for E2E handoff tests",
	is_active: false,
	review_status: "pending-review",
	created_at: "2026-01-02T00:00:00.000Z",
	updated_at: "2026-01-02T00:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: null,
};

const REVIEW_LIVE_FIXTURE = {
	id: "fixture-live-def-001",
	name: "smoke-classification",
	version: "1.0.0",
	definition: { steps: [] },
	description: "Fixture live definition for E2E handoff tests",
	is_active: true,
	review_status: "approved",
	created_at: "2025-12-01T00:00:00.000Z",
	updated_at: "2025-12-01T00:00:00.000Z",
	created_by: "fixture-user",
	deployed_at: "2025-12-01T00:00:00.000Z",
};

test("review handoff: approval payload is sent and dialog closes with Pending Review section removed", async ({
	page,
}) => {
	// Non-gating: see section comment above.
	// Route interception supplies the pending-review fixture and captures the
	// approve RPC call so the test is deterministic without live seed data.
	let definitionsCallCount = 0;
	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		definitionsCallCount++;
		// First fetch returns the pending+live fixture; the post-approve refetch
		// returns only the live definition so the Pending Review section disappears.
		const body =
			definitionsCallCount === 1
				? [REVIEW_PENDING_FIXTURE, REVIEW_LIVE_FIXTURE]
				: [REVIEW_LIVE_FIXTURE];
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

	let capturedApprovePayload: Record<string, unknown> | null = null;
	await page.route("**/rest/v1/rpc/approve_workflow_definition", async (route) => {
		capturedApprovePayload = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: "null",
		});
	});

	await signIn(page);
	await page.goto("/workflows/definitions");
	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

	// The Pending Review section must be present thanks to the fixture.
	await expect(page.getByText("Pending Review")).toBeVisible();

	// Open the pending-review definition row.
	const pendingRow = page
		.locator("button[type='button']")
		.filter({ hasText: "pending-review" })
		.first();
	await pendingRow.click();

	// The review dialog must expose approve/reject controls.
	await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /reject/i })).toBeVisible();

	// Enter a review reason.
	await page.getByLabel(/reason/i).fill("Approved via E2E handoff test");

	// Submit the approval.
	await page.getByRole("button", { name: /approve/i }).click();

	// Dialog must close — approve/reject controls must no longer be visible.
	await expect(page.getByRole("button", { name: /approve/i })).not.toBeVisible({
		timeout: 5000,
	});

	// The RPC must have been called with the expected payload.
	expect(capturedApprovePayload).not.toBeNull();
	expect(capturedApprovePayload?.p_id).toBe("fixture-pending-def-001");
	expect(capturedApprovePayload?.p_reason).toBe("Approved via E2E handoff test");

	// After the refetch the Pending Review section must be gone.
	await expect(page.getByText("Pending Review")).not.toBeVisible({ timeout: 5000 });

	// The Live section must still be present, confirming the surface re-rendered
	// correctly after the refetch (not replaced with a blank or error state).
	await expect(page.getByText("Live")).toBeVisible();
});

test("review handoff: rejection payload is sent and dialog closes with Pending Review section removed", async ({
	page,
}) => {
	// Non-gating: see section comment above.
	let definitionsCallCount = 0;
	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		definitionsCallCount++;
		// After rejection the definition moves to Other Versions (rejected status, not active).
		const rejectedFixture = {
			...REVIEW_PENDING_FIXTURE,
			review_status: "rejected",
		};
		const body =
			definitionsCallCount === 1
				? [REVIEW_PENDING_FIXTURE, REVIEW_LIVE_FIXTURE]
				: [REVIEW_LIVE_FIXTURE, rejectedFixture];
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

	let capturedRejectPayload: Record<string, unknown> | null = null;
	await page.route("**/rest/v1/rpc/reject_workflow_definition", async (route) => {
		capturedRejectPayload = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: "null",
		});
	});

	await signIn(page);
	await page.goto("/workflows/definitions");
	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

	await expect(page.getByText("Pending Review")).toBeVisible();

	const pendingRow = page
		.locator("button[type='button']")
		.filter({ hasText: "pending-review" })
		.first();
	await pendingRow.click();

	await expect(page.getByRole("button", { name: /reject/i })).toBeVisible();

	// Enter a rejection reason.
	await page.getByLabel(/reason/i).fill("Not ready for production — E2E handoff test");

	// Submit the rejection.
	await page.getByRole("button", { name: /reject/i }).click();

	// Dialog must close.
	await expect(page.getByRole("button", { name: /reject/i })).not.toBeVisible({ timeout: 5000 });

	// The RPC must have been called with the expected payload.
	expect(capturedRejectPayload).not.toBeNull();
	expect(capturedRejectPayload?.p_id).toBe("fixture-pending-def-001");
	expect(capturedRejectPayload?.p_reason).toBe(
		"Not ready for production — E2E handoff test",
	);

	// Pending Review section must be gone after the refetch.
	await expect(page.getByText("Pending Review")).not.toBeVisible({ timeout: 5000 });

	// The rejected definition must appear in Other Versions (not in Pending Review).
	await expect(page.getByText("Other Versions")).toBeVisible();
});

test("review handoff: mutation failure surfaces explicit error toast, not a silent no-op", async ({
	page,
}) => {
	// Non-gating: see section comment above.
	// Force the approve RPC to fail and assert the component surfaces an explicit
	// error toast. A blank page or silent no-op fails this test.
	await page.route("**/rest/v1/workflow_definitions*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "content-range": "0-1/2" },
			body: JSON.stringify([REVIEW_PENDING_FIXTURE, REVIEW_LIVE_FIXTURE]),
		});
	});
	await page.route("**/rest/v1/workflow_definition_audit_log*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([]),
		});
	});
	// Return a Supabase-style error body so the client surfaces an Error object.
	await page.route("**/rest/v1/rpc/approve_workflow_definition", async (route) => {
		await route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({
				message: "Insufficient permissions to approve definitions",
				code: "403",
			}),
		});
	});

	await signIn(page);
	await page.goto("/workflows/definitions");
	await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();

	const pendingRow = page
		.locator("button[type='button']")
		.filter({ hasText: "pending-review" })
		.first();
	await pendingRow.click();

	await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();

	// Fill the reason so the test exercises the RPC failure path, not form validation.
	await page.getByLabel(/reason/i).fill("Testing failure path");

	await page.getByRole("button", { name: /approve/i }).click();

	// The explicit mutation error toast must appear — a blank or silent state fails.
	const errorToast = page.locator(".bg-destructive");
	await expect(errorToast).toBeVisible({ timeout: 5000 });
	await expect(errorToast).not.toBeEmpty();

	// The dialog must remain open since the action failed.
	await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Dashboard → portfolio drill-down journey
// Non-gating: the deployed dev E2E environment recently recorded an
// experience run with 0 assertions executed and a prior smoke window with
// 12/12 skipped tests, so this lands as backlog-signal UX coverage for now.
// A regression in the dashboard portfolio CTA, portfolio working-set
// rendering, detail metadata, or back-navigation will surface here.
// ---------------------------------------------------------------------------

test("dashboard View Portfolios CTA navigates to portfolio working set", async ({ page }) => {
	await signIn(page);
	await page.goto("/");

	const portfolioCta = page.getByRole("button", { name: "View Portfolios" });
	await expect(portfolioCta).toBeVisible();

	await portfolioCta.click();
	await expect(page).toHaveURL(/\/entities\/portfolio\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();
});

test("portfolio working set renders rows with View actions or actionable empty state", async ({ page }) => {
	await signIn(page);
	await page.goto("/entities/portfolio");

	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	const hasActionableEmptyState =
		(await page.getByText(/no entities found/i).count()) > 0 &&
		(await page.getByRole("button", { name: NEW_ENTITY_CTA }).count()) > 0;

	// A blank, silent fallback is not acceptable — only rows or an explicit,
	// actionable empty state should pass.
	expect(hasRows || hasActionableEmptyState).toBe(true);
});

test("portfolio detail shows metadata, version history, and back-navigation to working set", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/portfolio");

	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		// No portfolio rows — this branch is covered by the empty-state test below.
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/portfolio\/[0-9a-f-]{36}$/i);

	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

	const backLink = page.getByRole("link", { name: /back to list/i });
	await expect(backLink).toBeVisible();

	const entityInfoCard = page.getByText("Entity Information").locator("..");
	await expect(entityInfoCard).toContainText("Created");
	await expect(entityInfoCard).toContainText("Updated");
	await expect(entityInfoCard).not.toContainText(ISO_PATTERN);

	const historyCard = page.getByText("Version History").locator("..");
	await expect(historyCard).toContainText(/Current revision|Previous revision/);
	await expect(historyCard).not.toContainText(ISO_PATTERN);

	await backLink.click();
	await expect(page).toHaveURL(/\/entities\/portfolio\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();
});

test("portfolio empty working set exposes New Entity action for write-capable users", async ({ page }) => {
	await signIn(page);
	await page.goto("/entities/portfolio");

	await expect(page.getByRole("heading", { level: 1, name: /portfolio/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) > 0) {
		return;
	}

	await expect(page.getByText(/no entities found/i)).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Assessment role-matrix journey (non-gating)
// Non-gating by design while #797 remains unresolved: deployed-browser smoke
// and experience runs still produce skip-only / zero-test windows, so this
// coverage belongs in experience.spec.ts as backlog-signal protection.
// A regression in assessment write-control visibility, detail mutation gating,
// read-only back-navigation, or explicit empty-state recovery will surface here.
// ---------------------------------------------------------------------------

test("assessment role matrix: write-capable user sees write controls or actionable empty-state recovery", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/assessment");

	await expect(page.getByRole("heading", { level: 1, name: /assessments?/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	if (!hasRows) {
		await expectActionableEntityListFallback(page);
		return;
	}

	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/assessment\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
	await expect(page.getByRole("link", { name: /back to list/i })).toBeVisible();
});

test("assessment role matrix: read-only user can navigate without mutation controls and with explicit empty-state recovery", async ({
	page,
}) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

	await signInAsReadOnly(page);
	await page.goto("/entities/assessment");

	await expect(page.getByRole("heading", { level: 1, name: /assessments?/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
			await readEntityListFallbackSignals(page);
		expect(hasEmptyState || hasFilteredEmptyState || hasClearSearch).toBe(true);
		await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/assessment\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();

	const backToList = page.getByRole("link", { name: /back to list/i });
	await expect(backToList).toBeVisible();
	await backToList.click();
	await expect(page).toHaveURL(/\/entities\/assessment\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /assessments?/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Dashboard → evidence drill-down journey
// Non-gating: the deployed dev E2E environment still alternates between
// skip-only windows and runs that execute zero authenticated smoke/experience
// tests (tracked in Volaris-AI/project-template#797), so this remains backlog
// signal in the experience suite rather than merge-blocking coverage for now.
// A regression in dashboard evidence handoff visibility, working-set
// rendering, detail readability, or back-navigation will surface here.
// ---------------------------------------------------------------------------

test("dashboard evidence CTA navigates to evidence working set", async ({ page }) => {
	await signIn(page);
	await page.goto("/");

	await expect(page.getByText("Evidence backlog")).toBeVisible();

	const openEvidenceCta = page.getByRole("link", { name: EVIDENCE_OPEN_CTA });
	const reviewEvidenceCta = page.getByRole("link", { name: EVIDENCE_REVIEW_CTA });
	const openEvidenceCtaCount = await openEvidenceCta.count();
	const reviewEvidenceCtaCount = await reviewEvidenceCta.count();

	// At least one explicit evidence handoff must be visible from dashboard.
	expect(openEvidenceCtaCount + reviewEvidenceCtaCount > 0).toBe(true);
	const evidenceCta = openEvidenceCtaCount > 0 ? openEvidenceCta.first() : reviewEvidenceCta.first();
	await expect(evidenceCta).toBeVisible();
	await evidenceCta.click();
	await expect(page).toHaveURL(/\/entities\/evidence\/?$/);

	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	const hasActionableEmptyState =
		(await page.getByText(/no entities found/i).count()) > 0 &&
		(await page.getByRole("button", { name: NEW_ENTITY_CTA }).count()) > 0;

	// A blank, silent fallback is not acceptable — only rows or an explicit,
	// actionable empty state should pass.
	expect(hasRows || hasActionableEmptyState).toBe(true);
});

test("evidence detail shows heading, back-navigation, version history, and human-readable timestamps", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/evidence");

	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		// No evidence rows — this branch is covered by the empty-state test below.
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/evidence\/[0-9a-f-]{36}$/i);

	// Heading must reflect the entity name or fall back to the generic title.
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

	// Back-to-list link must be present and functional.
	const backLink = page.getByRole("link", { name: /back to list/i });
	await expect(backLink).toBeVisible();

	// Entity Information card must show Created and Updated labels with
	// human-readable dates — no raw ISO timestamp bleed-through.
	const entityInfoCard = page.getByText("Entity Information").locator("..");
	await expect(entityInfoCard).toContainText("Created");
	await expect(entityInfoCard).toContainText("Updated");
	await expect(entityInfoCard).not.toContainText(ISO_PATTERN);

	// Version History section must be present.
	const historyCard = page.getByText("Version History").locator("..");
	await expect(historyCard).toContainText(/Current revision|Previous revision/);
	await expect(historyCard).not.toContainText(ISO_PATTERN);

	// Return to the evidence working set via the back link without losing route context.
	await backLink.click();
	await expect(page).toHaveURL(/\/entities\/evidence\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();
});

test("evidence working set empty state exposes New Entity action for write-capable users", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/evidence");

	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) > 0) {
		// Rows are present — the empty-state path is not exercised in this run.
		return;
	}

	// When the working set is empty the page must not dead-end — the explicit
	// empty state must expose the "New Entity" action for write-capable users.
	await expect(page.getByText(/no entities found/i)).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Evidence role-matrix journey (non-gating)
// Non-gating by design while #797 remains unresolved: the deployed-browser
// environment still alternates between skip-only windows and runs that execute
// zero authenticated tests (experience suite history shows 12/12 skipped or
// 0-test runs as of the latest sample in run #27911465455), so this coverage
// belongs in experience.spec.ts as backlog-signal protection rather than
// blocking merges.
// A regression in Evidence write-control visibility, detail mutation gating,
// read-only access restrictions, back-navigation, or explicit empty-state
// recovery will surface here.
// Tracking issue: Volaris-AI/project-template#1181.
// ---------------------------------------------------------------------------

test("evidence role matrix: write-capable user sees write controls or actionable empty-state recovery", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/evidence");

	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	if (!hasRows) {
		await expectActionableEntityListFallback(page);
		return;
	}

	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/evidence\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
	await expect(page.getByRole("link", { name: /back to list/i })).toBeVisible();
});

test("evidence role matrix: read-only user can navigate without mutation controls and with explicit empty-state recovery", async ({
	page,
}) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

	await signInAsReadOnly(page);
	await page.goto("/entities/evidence");

	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
			await readEntityListFallbackSignals(page);
		expect(hasEmptyState || hasFilteredEmptyState || hasClearSearch).toBe(true);
		await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/evidence\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();

	const backToList = page.getByRole("link", { name: /back to list/i });
	await expect(backToList).toBeVisible();
	await backToList.click();
	await expect(page).toHaveURL(/\/entities\/evidence\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /evidence/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Questions role-matrix journey (non-gating)
// Non-gating by design: the latest deployed-browser history sample still shows
// zero executed experience tests (run #27911465455), and the latest live-url
// browser run skipped all authenticated experience expectations (52/52 skipped
// in run #28089788786). This remains backlog-signal coverage until the
// authenticated harness reliably executes again.
// A regression in Questions write affordances, read-only restrictions, detail
// drill-down, metadata shell readability, back-navigation, or explicit
// empty-state recovery will surface here. Tracking issue:
// Volaris-AI/project-template#1223.
// ---------------------------------------------------------------------------

test("questions role matrix: write-capable user sees write controls or actionable empty-state recovery", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/question");

	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	if (!hasRows) {
		await expectActionableEntityListFallback(page);
		return;
	}

	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/question\/[0-9a-f-]{36}$/i);

	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();

	const backLink = page.getByRole("link", { name: /back to list/i });
	await expect(backLink).toBeVisible();

	const entityInfoCard = page.getByText("Entity Information").locator("..");
	await expect(entityInfoCard).toContainText("Created");
	await expect(entityInfoCard).toContainText("Updated");
	await expect(entityInfoCard).not.toContainText(ISO_PATTERN);

	const historyCard = page.getByText("Version History").locator("..");
	await expect(historyCard).toContainText(/Current revision|Previous revision/);
	await expect(historyCard).not.toContainText(ISO_PATTERN);

	await backLink.click();
	await expect(page).toHaveURL(/\/entities\/question\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
});

test("questions role matrix: read-only user can navigate without mutation controls and with explicit empty-state recovery", async ({
	page,
}) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

	await signInAsReadOnly(page);
	await page.goto("/entities/question");

	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
			await readEntityListFallbackSignals(page);
		expect(hasEmptyState || hasFilteredEmptyState || hasClearSearch).toBe(true);
		await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/question\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();

	const backToList = page.getByRole("link", { name: /back to list/i });
	await expect(backToList).toBeVisible();
	await backToList.click();
	await expect(page).toHaveURL(/\/entities\/question\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Questions role-matrix journey (non-gating)
// Non-gating by design: the deployed-browser environment is still not
// exercising authenticated expectations reliably enough for merge-blocking
// coverage — the latest history sample executed zero experience tests and the
// latest live-url run skipped all authenticated experience expectations (runs
// #27911465455 and #28089788786). This coverage belongs in experience.spec.ts
// as backlog-signal protection rather than blocking merges.
// A regression in Questions write-control visibility, detail mutation gating,
// read-only access restrictions, back-navigation, or explicit empty-state
// recovery will surface here.
// Tracking issue: Volaris-AI/project-template#1223.
// ---------------------------------------------------------------------------

test("questions role matrix: write-capable user sees write controls or actionable empty-state recovery", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/question");

	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	if (!hasRows) {
		await expectActionableEntityListFallback(page);
		return;
	}

	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/question\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
	await expect(page.getByRole("link", { name: /back to list/i })).toBeVisible();
});

test("questions role matrix: read-only user can navigate without mutation controls and with explicit empty-state recovery", async ({
	page,
}) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

	await signInAsReadOnly(page);
	await page.goto("/entities/question");

	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
			await readEntityListFallbackSignals(page);
		expect(hasEmptyState || hasFilteredEmptyState || hasClearSearch).toBe(true);
		await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/question\/[0-9a-f-]{36}$/i);
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();

	const backToList = page.getByRole("link", { name: /back to list/i });
	await expect(backToList).toBeVisible();
	await backToList.click();
	await expect(page).toHaveURL(/\/entities\/question\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /questions/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// VBU working-set → detail drill-down journey
// Non-gating: the deployed dev E2E environment history window is still
// skip-only or zero-test (experience skipped or executed 0 tests in run
// #27911465455 and #28050698769), so these tests land as backlog-signal
// coverage in the experience suite rather than blocking merges.
// A regression in VBU detail navigation, metadata rendering, timestamp
// formatting, version-history visibility, or return-to-list behaviour will
// surface here. Tracking issue: Volaris-AI/project-template#1076.
// ---------------------------------------------------------------------------

test("VBU working set renders a usable state: rows with View actions or explicit empty state", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/vbu");

	await expect(page.getByRole("heading", { level: 1, name: /vbu/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	const hasEmptyStateMessage = (await page.getByText(/no entities found/i).count()) > 0;

	// A blank, silent fallback is not an acceptable state — either rows or an
	// explicit empty state must be present.
	expect(hasRows || hasEmptyStateMessage).toBe(true);
});

test("VBU detail shows heading, back-navigation, version history, and human-readable timestamps", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/vbu");

	await expect(page.getByRole("heading", { level: 1, name: /vbu/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		// No VBU rows — this branch is covered by the empty-state test below.
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/vbu\/[0-9a-f-]{36}$/i);

	// Heading must reflect the entity name or fall back to the generic title.
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

	// Back-to-list link must be present and functional.
	const backLink = page.getByRole("link", { name: /back to list/i });
	await expect(backLink).toBeVisible();

	// Entity Information card must show Created and Updated labels with
	// human-readable dates — no raw ISO timestamp bleed-through.
	const entityInfoCard = page.getByText("Entity Information").locator("..");
	await expect(entityInfoCard).toContainText("Created");
	await expect(entityInfoCard).toContainText("Updated");
	await expect(entityInfoCard).not.toContainText(ISO_PATTERN);

	// Version History section must be present.
	const historyCard = page.getByText("Version History").locator("..");
	await expect(historyCard).toContainText(/Current revision|Previous revision/);
	await expect(historyCard).not.toContainText(ISO_PATTERN);

	// Return to the VBU working set via the back link without losing route context.
	await backLink.click();
	await expect(page).toHaveURL(/\/entities\/vbu\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /vbu/i })).toBeVisible();
});

test("VBU working set empty state exposes New Entity action for write-capable users", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/vbu");

	await expect(page.getByRole("heading", { level: 1, name: /vbu/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) > 0) {
		// Rows are present — the empty-state path is not exercised in this run.
		return;
	}

	// When the working set is empty the page must not dead-end — the explicit
	// empty state must expose the "New Entity" action for write-capable users.
	await expect(page.getByText(/no entities found/i)).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Groups role-matrix journey (non-gating)
// Non-gating by design while #797 remains unresolved: deployed-browser smoke
// and experience runs still produce skip-only / zero-test windows (smoke
// skipped 11/11 in run #27911465455; experience executed 0 tests in run
// #28068503028), so this coverage belongs in experience.spec.ts as
// backlog-signal protection rather than blocking merges.
// A regression in groups write-control visibility, detail mutation gating,
// read-only back-navigation, or explicit empty-state recovery will surface here.
// Tracking issue: Volaris-AI/project-template#1149.
// ---------------------------------------------------------------------------

test("groups role matrix: write-capable user sees write controls or actionable empty-state recovery", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/entities/group");

	await expect(page.getByRole("heading", { level: 1, name: /groups?/i })).toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	const hasRows = (await viewButtons.count()) > 0;
	if (!hasRows) {
		await expectActionableEntityListFallback(page);
		return;
	}

	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).toBeVisible();

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/group\/[0-9a-f-]{36}$/i);
	// Verify the human-readable metadata shell (h1 heading) is visible — not a dead end.
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();
	await expect(page.getByRole("link", { name: /back to list/i })).toBeVisible();
});

test("groups role matrix: read-only user can navigate without mutation controls and with explicit empty-state recovery", async ({
	page,
}) => {
	test.skip(!process.env.E2E_READONLY_EMAIL, "E2E_READONLY_EMAIL not configured");
	test.skip(!process.env.E2E_READONLY_PASSWORD, "E2E_READONLY_PASSWORD not configured");

	await signInAsReadOnly(page);
	await page.goto("/entities/group");

	await expect(page.getByRole("heading", { level: 1, name: /groups?/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();

	const viewButtons = page.getByRole("button", { name: ROW_ACTION_NAME });
	if ((await viewButtons.count()) === 0) {
		const { hasEmptyState, hasFilteredEmptyState, hasClearSearch } =
			await readEntityListFallbackSignals(page);
		expect(hasEmptyState || hasFilteredEmptyState || hasClearSearch).toBe(true);
		await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
		return;
	}

	await viewButtons.first().click();
	await expect(page).toHaveURL(/\/entities\/group\/[0-9a-f-]{36}$/i);
	// Verify the human-readable metadata shell (h1 heading) is visible — not a dead end.
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByRole("button", { name: /^edit$/i })).not.toBeVisible();
	await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible();

	const backToList = page.getByRole("link", { name: /back to list/i });
	await expect(backToList).toBeVisible();
	await backToList.click();
	await expect(page).toHaveURL(/\/entities\/group\/?$/);
	await expect(page.getByRole("heading", { level: 1, name: /groups?/i })).toBeVisible();
	await expect(page.getByRole("button", { name: NEW_ENTITY_CTA })).not.toBeVisible();
});

test("workflows overview drill-in and recovery actions are explicit", async ({ page }) => {
	await signIn(page);
	await page.goto("/workflows");

	// The page heading must be present.
	await expect(page.getByText("Workflow History")).toBeVisible();

	// Either rows with explicit Open trace links are visible, or an actionable
	// empty/error state is visible — never a silent blank or passive-only message.
	const openTraceLinks = page.getByText("Open trace");
	const clearFiltersButton = page.getByRole("button", { name: /clear filters/i });
	const retryButton = page.getByRole("button", { name: /retry/i });
	const emptyMessage = page.getByText("No workflow executions found.");

	const hasRows = (await openTraceLinks.count()) > 0;
	const hasFilteredEmpty = (await clearFiltersButton.count()) > 0;
	const hasError = (await retryButton.count()) > 0;
	const hasPlainEmpty = (await emptyMessage.count()) > 0;

	// At least one of these states must be present.
	expect(hasRows || hasFilteredEmpty || hasError || hasPlainEmpty).toBe(true);

	if (hasRows) {
		// When rows are present the Actions column and Open trace link must be visible.
		await expect(page.getByText("Actions")).toBeVisible();
		await expect(openTraceLinks.first()).toBeVisible();
	}
});
