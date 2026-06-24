import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.beforeAll(() => {
  if (!process.env.E2E_AUTH_EMAIL) {
    test.skip(true, "E2E_AUTH_EMAIL not configured — skipping workflow execution detail suite");
  }
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("[data-testid='login-email']").fill(process.env.E2E_AUTH_EMAIL ?? "");
  await page.locator("[data-testid='login-password']").fill(process.env.E2E_AUTH_PASSWORD ?? "");
  await page.locator("[data-testid='login-submit']").click();

  const mfaVisible = await page
    .locator("[data-testid='mfa-code']")
    .waitFor({ state: "visible", timeout: 2500 })
    .then(() => true)
    .catch(() => false);

  if (mfaVisible) {
    await page.locator("[data-testid='mfa-code']").fill(process.env.E2E_MFA_CODE ?? "");
    await page.locator("[data-testid='mfa-submit']").click();
  }

  await page.waitForURL("/");
}

test("renders successful run detail with llm metadata and final state", async ({ page }) => {
  await page.route("**/workflows/executions/wf-success", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        execution: {
          workflow_id: "wf-success",
          run_id: "run-1",
          definition_name: "vertical-classification",
          definition_version: "1.0.0",
          status: "completed",
          started_at: "2026-06-21T00:00:00.000Z",
          completed_at: "2026-06-21T00:00:10.000Z",
          duration_ms: 10000,
          output_payload: {
            classification: {
              vertical: "technology",
            },
          },
        },
        step_trace: [
          {
            index: 0,
            step_name: "classify",
            status: "completed",
            duration_ms: 9000,
            retries: 1,
            result: {
              provider: "openai",
              model: "gpt-5.5",
              prompt_tokens: 120,
              completion_tokens: 45,
              tool_calls: [{ id: "1" }, { id: "2" }],
              parsed: { vertical: "technology" },
            },
          },
        ],
      }),
    });
  });

  await signIn(page);
  await page.goto("/workflows/executions/wf-success");

  await expect(page.getByText("Workflow execution wf-success")).toBeVisible();
  await expect(page.getByText("classify")).toBeVisible();
  await expect(page.getByText("Provider: openai")).toBeVisible();
  await expect(page.getByText("Model: gpt-5.5")).toBeVisible();
  await expect(page.getByText("Prompt tokens: 120")).toBeVisible();
  await expect(page.getByText("Completion tokens: 45")).toBeVisible();
  await expect(page.getByText("Tool rounds: 2")).toBeVisible();

  await page.getByText("Show final variables/output").click();
  await expect(page.getByTestId("final-state-json")).toContainText("technology");
});

test("renders failed step state and error messages", async ({ page }) => {
  await page.route("**/workflows/executions/wf-failed", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        execution: {
          workflow_id: "wf-failed",
          status: "failed",
          error_message: "workflow failed",
        },
        step_trace: [
          {
            index: 0,
            step_name: "classify",
            status: "failed",
            retries: 2,
            error_message: "model timeout",
          },
        ],
      }),
    });
  });

  await signIn(page);
  await page.goto("/workflows/executions/wf-failed");

  await expect(page.getByTestId("execution-error")).toContainText("workflow failed");
  await expect(page.getByTestId("step-item-0")).toHaveAttribute("data-failed", "true");
  await expect(page.getByTestId("step-error-0")).toContainText("model timeout");
});

test("workflow detail URL renders trace view without redirecting", async ({ page }) => {
  await page.route("**/workflows/executions/wf-legacy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        execution: {
          workflow_id: "wf-legacy",
          status: "completed",
        },
        step_trace: [],
      }),
    });
  });

  await signIn(page);
  await page.goto("/workflows/wf-legacy");

  await expect(page).toHaveURL(/\/workflows\/wf-legacy$/);
  await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
  await expect(page.getByText("Workflow ID: wf-legacy")).toBeVisible();
});
