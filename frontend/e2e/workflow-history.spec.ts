import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.beforeAll(() => {
  if (!process.env.E2E_AUTH_EMAIL) {
    test.skip(true, "E2E_AUTH_EMAIL not configured — skipping workflow history suite");
  }
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("[data-testid='login-email']").fill(process.env.E2E_AUTH_EMAIL ?? "");
  await page.locator("[data-testid='login-password']").fill(process.env.E2E_AUTH_PASSWORD ?? "");
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

test("workflow history shows executions with status badges", async ({ page }) => {
  await signIn(page);

  const mockedRows = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      workflow_id: "wf-completed",
      definition_name: "approval-flow",
      status: "completed",
      started_at: "2026-06-20T10:00:00.000Z",
      completed_at: "2026-06-20T10:02:00.000Z",
      input_payload: { ticketId: "A-100" },
      output_payload: { decision: "approved" },
      duration_ms: 120000,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      workflow_id: "wf-failed",
      definition_name: "escalation-flow",
      status: "failed",
      started_at: "2026-06-20T09:00:00.000Z",
      completed_at: "2026-06-20T09:00:30.000Z",
      input_payload: { ticketId: "B-200" },
      output_payload: { error: "timeout" },
      duration_ms: 30000,
    },
  ];

  await page.route("**/rest/v1/workflow_executions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedRows),
      headers: {
        "content-range": "0-1/2",
      },
    });
  });

  await page.goto("/workflows");

  await expect(page.getByText("approval-flow")).toBeVisible();
  await expect(page.getByText("escalation-flow")).toBeVisible();
  await expect(page.locator("tbody").getByText("completed")).toBeVisible();
  await expect(page.locator("tbody").getByText("failed")).toBeVisible();
});

async function mockWorkflowHistory(page: Page): Promise<void> {
  const listExecution = {
    workflow_id: "wf-001",
    run_id: "run-001",
    definition_name: "claims-review",
    definition_version: "v1",
    status: "completed",
    current_step: "done",
    started_at: "2026-06-20T08:00:00.000Z",
    completed_at: "2026-06-20T08:05:30.000Z",
    input_payload: { claimId: "123" },
    output_payload: { decision: "approved" },
    error_message: null,
    updated_at: "2026-06-20T08:05:30.000Z",
  };

  await page.route("**/rest/v1/workflow_definitions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ name: "claims-review" }]),
    });
  });

  await page.route("**/rest/v1/workflow_executions*", async (route) => {
    const url = new URL(route.request().url());
    const workflowIdFilter = url.searchParams.get("workflow_id");
    const body = workflowIdFilter === "eq.wf-001" ? [listExecution] : [listExecution];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify(body),
    });
  });
}

test("workflow history drill-in opens the result inspector", async ({ page }) => {
  await mockWorkflowHistory(page);
  await signIn(page);
  await page.goto("/workflows/history");

  await expect(page.getByRole("heading", { name: "Workflow execution history" })).toBeVisible();
  await expect(page.getByTestId("workflow-link-wf-001")).toBeVisible();

  await page.getByTestId("workflow-link-wf-001").click();

  await expect(page).toHaveURL(/\/workflows\/wf-001$/);
  await expect(page.getByRole("heading", { name: "Workflow result inspector" })).toBeVisible();
  await expect(page.getByText("claims-review")).toBeVisible();
});
