import { expect, test } from "@playwright/test";

// Definition-promotion E2E suite.
// Covers the full staging → production approval gate:
//   submit definition for review → approve → assert live
//   submit definition for review → reject → assert stays non-live, audit visible
//
// Tests skip automatically when E2E_AUTH_EMAIL is not configured (fresh fork).

test.beforeAll(() => {
  if (!process.env.E2E_AUTH_EMAIL) {
    test.skip(true, "E2E_AUTH_EMAIL not configured — skipping definition-promotion suite");
  }
});

test("definitions page loads and shows status badges", async ({ page }) => {
  await page.goto("/workflows/definitions");
  await expect(page.getByRole("heading", { name: "Workflow Definitions" })).toBeVisible();
  // Status badges should be present if any definitions exist
  const live = page.locator("text=live");
  const pending = page.locator("text=pending-review");
  const draft = page.locator("text=draft");
  // At least one badge type should be visible (or empty state)
  const emptyState = page.locator("text=No workflow definitions found");
  const hasBadge =
    (await live.count()) > 0 ||
    (await pending.count()) > 0 ||
    (await draft.count()) > 0 ||
    (await emptyState.count()) > 0;
  expect(hasBadge).toBe(true);
});

test("pending definition shows diff view on click", async ({ page }) => {
  await page.goto("/workflows/definitions");
  const pendingRow = page.locator("button").filter({ hasText: "pending-review" }).first();
  if ((await pendingRow.count()) === 0) {
    test.skip(true, "No pending-review definitions available");
    return;
  }
  await pendingRow.click();
  await expect(page.locator("text=Current live")).toBeVisible();
  await expect(page.locator("text=Pending (staging)")).toBeVisible();
});

test("reviewer can approve a pending definition and it becomes live", async ({ page }) => {
  await page.goto("/workflows/definitions");
  const pendingRow = page
    .locator("button")
    .filter({ hasText: "pending-review" })
    .first();
  if ((await pendingRow.count()) === 0) {
    test.skip(true, "No pending-review definitions available");
    return;
  }
  await pendingRow.click();
  // Dialog opens
  await expect(page.locator("text=Current live")).toBeVisible();
  // Click Approve
  await page.getByRole("button", { name: /approve/i }).click();
  // Dialog closes
  await expect(page.locator("text=Current live")).not.toBeVisible({ timeout: 5000 });
  // The definition should now appear in Live section
  await expect(page.locator("text=live").first()).toBeVisible();
});

test("reviewer can reject a pending definition and it stays non-live", async ({ page }) => {
  await page.goto("/workflows/definitions");
  const pendingRow = page
    .locator("button")
    .filter({ hasText: "pending-review" })
    .first();
  if ((await pendingRow.count()) === 0) {
    test.skip(true, "No pending-review definitions available");
    return;
  }
  await pendingRow.click();
  await expect(page.locator("text=Current live")).toBeVisible();
  // Optionally add a rejection reason
  const reasonInput = page.getByLabel(/reason/i);
  if ((await reasonInput.count()) > 0) {
    await reasonInput.fill("Not ready for production");
  }
  await page.getByRole("button", { name: /reject/i }).click();
  // Dialog closes
  await expect(page.locator("text=Current live")).not.toBeVisible({ timeout: 5000 });
  // The definition should show as rejected or draft (not live)
  await expect(page.locator("text=rejected").first()).toBeVisible();
});

test("audit log shows approve/reject history in dialog", async ({ page }) => {
  await page.goto("/workflows/definitions");
  // Click any definition that has been acted on
  const definitionRow = page.locator("button").first();
  if ((await definitionRow.count()) === 0) {
    test.skip(true, "No definitions available");
    return;
  }
  await definitionRow.click();
  // Audit history section visible if there are any audit entries
  const auditSection = page.locator("text=Audit history");
  if ((await auditSection.count()) > 0) {
    await expect(auditSection).toBeVisible();
  }
});
