import { createHmac } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Gating smoke suite — all failures file incidents and block deploys.
// Tests skip automatically when E2E_BASE_URL is not configured (fresh fork).

test.beforeAll(() => {
  if (!process.env.E2E_BASE_URL) {
    test.skip(true, "E2E_BASE_URL not configured — skipping smoke suite");
  }
});

// --- Routes ---
// Add a test per route that the app exposes. Each test confirms the route
// renders without a crash, a visible error boundary, or a blank page.
//
// Example (uncomment and adapt after adding routes):
//
// test('home renders', async ({ page }) => {
//   await page.goto('/');
//   await expect(page).not.toHaveURL(/error/);
//   await expect(page.locator('body')).not.toBeEmpty();
// });

test("smoke suite root route is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-testid='login-email']")).toBeVisible();
  await expect(page.locator("[data-testid='login-password']")).toBeVisible();
  await expect(page.locator("[data-testid='login-submit']")).toBeVisible();
});

// --- Workflow trigger-to-history journey (gating) ---
//
// This coverage is gating because the workflow trigger → history → result-inspector
// journey is already verified working on deployed-dev:
// https://github.com/Volaris-AI/project-template/actions/runs/27911465455
//
// A regression in workflow launch, success-state identifiers, or history drill-in
// must fail this suite before merge.
//
// Tests in this block skip automatically when E2E_AUTH_EMAIL is not configured.

const SMOKE_TEST_WORKFLOW_INPUT = { company_name: "Acme Corp", domain: "acme.example" };
const WORKFLOW_OPERATION_TIMEOUT_MS = 30_000;
const TOTP_PERIOD_SECONDS = 30;
const MFA_APPEARANCE_TIMEOUT_MS = 2_500;
const MFA_VERIFY_TIMEOUT_MS = 30_000;

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

  const enrollmentSecret = (
    await page.locator("[data-testid='mfa-secret']").textContent()
  )?.trim();
  if (enrollmentSecret) {
    return generateTotpCode(enrollmentSecret);
  }

  throw new Error(
    "MFA challenge detected but no E2E_MFA_CODE or E2E_MFA_SECRET is configured.",
  );
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
    await page
      .locator("[data-testid='mfa-card']")
      .waitFor({ state: "hidden", timeout: MFA_VERIFY_TIMEOUT_MS });
  }

  await page.waitForURL("/", { timeout: 30_000 });
  await expect(page.locator("[data-testid='login-card']")).toHaveCount(0);
  await expect(page.locator("[data-testid='mfa-card']")).toHaveCount(0);
}

async function readTriggerSuccessIdentifiers(successCard: Locator): Promise<{
  workflowId: string | undefined;
  runId: string | undefined;
}> {
  const [workflowIdText, runIdText] = await Promise.all([
    successCard.getByTestId("workflow-trigger-success-workflow-id").textContent(),
    successCard.getByTestId("workflow-trigger-success-run-id").textContent(),
  ]);
  return { workflowId: workflowIdText?.trim(), runId: runIdText?.trim() };
}

test.describe("workflow trigger-to-history journey", () => {
  test.beforeAll(() => {
    if (!process.env.E2E_AUTH_EMAIL) {
      test.skip(
        true,
        "E2E_AUTH_EMAIL not configured — skipping trigger-to-history journey tests",
      );
    }
  });

  test("trigger shows workflow and run identifiers with execution-trace link", async ({ page }) => {
    await signIn(page);
    await page.goto("/workflows/trigger");
    await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
    await page
      .getByTestId("workflow-input-editor")
      .fill(JSON.stringify(SMOKE_TEST_WORKFLOW_INPUT, null, 2));
    await page.getByTestId("workflow-trigger-submit").click();

    const successCard = page.getByTestId("workflow-trigger-success");
    await expect(successCard).toBeVisible({ timeout: WORKFLOW_OPERATION_TIMEOUT_MS });
    await expect(page.getByTestId("workflow-trigger-error")).toHaveCount(0);

    await expect(successCard).toContainText("Workflow ID:");
    await expect(successCard).toContainText("Run ID:");

    const { workflowId, runId } = await readTriggerSuccessIdentifiers(successCard);
    expect(workflowId).toBeTruthy();
    expect(runId).toBeTruthy();

    const traceLink = page.getByRole("link", { name: "Open execution trace" });
    const traceHref = await traceLink.getAttribute("href");
    expect(traceHref).toBeTruthy();
    expect(traceHref).toContain(workflowId);
    expect(traceHref).toContain(runId);
  });

  test("triggered execution can be located and reopened from history", async ({ page }) => {
    await signIn(page);
    await page.goto("/workflows/trigger");
    await page.getByTestId("workflow-definition-select").selectOption("smoke-classification");
    await page
      .getByTestId("workflow-input-editor")
      .fill(JSON.stringify(SMOKE_TEST_WORKFLOW_INPUT, null, 2));
    await page.getByTestId("workflow-trigger-submit").click();

    const successCard = page.getByTestId("workflow-trigger-success");
    await expect(successCard).toBeVisible({ timeout: WORKFLOW_OPERATION_TIMEOUT_MS });
    const { workflowId, runId } = await readTriggerSuccessIdentifiers(successCard);
    expect(workflowId).toBeTruthy();
    expect(runId).toBeTruthy();

    // workflowId is truthy at this point; guard narrows the type for subsequent assertions
    if (!workflowId) {
      return;
    }

    await page.goto("/workflows/history");
    const historyLink = page.getByTestId(`workflow-link-${workflowId}`);
    await expect(historyLink).toBeVisible({ timeout: WORKFLOW_OPERATION_TIMEOUT_MS });
    await historyLink.click();
    await page.waitForURL(`**/workflows/${workflowId}`);
    await expect(page.getByRole("heading", { name: "Workflow trace" })).toBeVisible();
  });
});
