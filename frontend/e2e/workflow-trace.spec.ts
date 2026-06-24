import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const MFA_APPEARANCE_TIMEOUT_MS = 2_500;

test.beforeAll(() => {
  if (!process.env.E2E_AUTH_EMAIL) {
    test.skip(true, "E2E_AUTH_EMAIL not configured — skipping workflow trace suite");
  }
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("[data-testid='login-email']").fill(process.env.E2E_AUTH_EMAIL ?? "");
  await page.locator("[data-testid='login-password']").fill(process.env.E2E_AUTH_PASSWORD ?? "");
  await page.locator("[data-testid='login-submit']").click();

  const mfaVisible = await page
    .locator("[data-testid='mfa-code']")
    .waitFor({ state: "visible", timeout: MFA_APPEARANCE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);

  if (mfaVisible) {
    await page.locator("[data-testid='mfa-code']").fill(process.env.E2E_MFA_CODE ?? "");
    await page.locator("[data-testid='mfa-submit']").click();
  }

  await page.waitForURL("/", { timeout: 30_000 });
}

test("trace view renders completed llm_agent output and stops polling on terminal state", async ({
  page,
}) => {
  const workflowId = "smoke-classification-123";
  let requestCount = 0;
  let legacyApiCalled = false;

  await page.route("**/api/workflows/**", async (route) => {
    legacyApiCalled = true;
    await route.fulfill({ status: 500, body: "legacy endpoint should not be used" });
  });

  await page.route(`**/workflows/executions/${workflowId}`, async (route) => {
    requestCount += 1;

    const body =
      requestCount < 2
        ? {
            execution: {
              workflow_id: workflowId,
              status: "running",
              started_at: "2026-06-21T05:59:58.100Z",
            },
            step_trace: [
              {
                step_name: "llm_agent",
                status: "completed",
                retries: 0,
                duration_ms: 950,
                input_args: { company_name: "Stripe" },
                result: {
                  provider: "openai",
                  model: "gpt-4o",
                  prompt_tokens: 55,
                  completion_tokens: 34,
                  parsed: {
                    company: "Stripe",
                    vertical: "financial_services",
                  },
                  tool_calls: [
                    {
                      name: "domain_probe",
                      args: { domain: "stripe.com" },
                      result_summary: "Domain appears active and trusted",
                    },
                  ],
                },
              },
            ],
          }
        : {
            execution: {
              workflow_id: workflowId,
              status: "completed",
              duration_ms: 1900,
              started_at: "2026-06-21T05:59:58.100Z",
              completed_at: "2026-06-21T06:00:00.000Z",
            },
            step_trace: [
              {
                step_name: "llm_agent",
                status: "completed",
                retries: 0,
                duration_ms: 950,
                input_args: { company_name: "Stripe" },
                result: {
                  provider: "openai",
                  model: "gpt-4o",
                  prompt_tokens: 55,
                  completion_tokens: 34,
                  parsed: {
                    company: "Stripe",
                    vertical: "financial_services",
                  },
                  tool_calls: [
                    {
                      name: "domain_probe",
                      args: { domain: "stripe.com" },
                      result_summary: "Domain appears active and trusted",
                    },
                  ],
                },
              },
            ],
          };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await signIn(page);
  await page.goto(`/workflows/${workflowId}`);

  await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
  await expect(page.getByText("COMPLETED").first()).toBeVisible();
  await expect(page.getByText("Provider:").first()).toBeVisible();
  await expect(page.getByText("openai")).toBeVisible();
  await expect(page.getByText("Model:").first()).toBeVisible();
  await expect(page.getByText("gpt-4o")).toBeVisible();
  await expect(page.getByText("Tool call rounds")).toBeVisible();
  await expect(page.getByText("financial_services")).toBeVisible();

  await expect.poll(() => requestCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  const terminalPollCount = requestCount;
  await page.waitForTimeout(2_500);
  expect(requestCount).toBe(terminalPollCount);
  expect(legacyApiCalled).toBe(false);
});

test("trace view highlights failed steps with retry and error details", async ({ page }) => {
  const workflowId = "smoke-classification-failed";

  await page.route(`**/workflows/executions/${workflowId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        execution: {
          workflow_id: workflowId,
          status: "failed",
          duration_ms: 2400,
        },
        step_trace: [
          {
            step_name: "llm_agent",
            status: "failed",
            retries: 2,
            duration_ms: 700,
            input_args: { company_name: "Stripe" },
            result: { provider: "openai", model: "gpt-4o" },
            error_message: "Rate limit exceeded",
          },
        ],
      }),
    });
  });

  await signIn(page);
  await page.goto(`/workflows/${workflowId}`);

  await expect(page.getByText("FAILED").first()).toBeVisible();
  await expect(page.getByText("Error:")).toBeVisible();
  await expect(page.getByText("Rate limit exceeded")).toBeVisible();
  await expect(page.getByText("Retry count:")).toBeVisible();
  await expect(page.getByText("2")).toBeVisible();
});
