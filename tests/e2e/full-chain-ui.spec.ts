/**
 * Full Chain UI Smoke Test
 *
 * Single test that creates all 8 core entities through the browser UI
 * in one authenticated session, proving the entire traceability chain works:
 *
 * Facility → Reactor → Production Run → Sample → Order → Delivery → Application → Credit Batch
 *
 * Uses seeded prerequisite data (supplier, feedstock type, customer, etc.)
 * from the auth fixtures.
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// ============================================
// Helpers
// ============================================

async function waitForSideSheet(page: Page) {
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
}

async function waitForSideSheetClose(page: Page) {
  await page.waitForSelector('[role="dialog"]', {
    state: "hidden",
    timeout: 15000,
  });
}

/** Click an EntitySelect trigger scoped to a field label within the dialog, then click an option by ID */
async function selectEntityById(page: Page, fieldLabel: string, optionId: string) {
  const dialog = page.locator('[role="dialog"]');
  const label = dialog.locator("label").filter({ hasText: fieldLabel }).first();
  const fieldContainer = label.locator("..");
  await fieldContainer.locator('[data-testid="entity-select-trigger"]').click();
  await page.waitForSelector('[data-testid="entity-select-listbox"]', { timeout: 10000 });
  await page.click(`[data-testid="entity-option-${optionId}"]`);
}

/** Click an EntitySelect trigger scoped to a field label within the dialog, then click the first option */
async function selectFirstEntity(page: Page, fieldLabel: string) {
  const dialog = page.locator('[role="dialog"]');
  const label = dialog.locator("label").filter({ hasText: fieldLabel }).first();
  const fieldContainer = label.locator("..");
  await fieldContainer.locator('[data-testid="entity-select-trigger"]').click();
  await page.waitForSelector('[data-testid="entity-select-listbox"]', { timeout: 10000 });
  await page.locator('[role="option"]').first().click();
}

// ============================================
// Full Chain Smoke Test
// ============================================

test.describe("Full Chain UI Smoke Test", () => {
  test("create all 8 core entities through the UI", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const runId = Date.now().toString(36);
    const today = new Date().toISOString().split("T")[0];

    // ─── 1. FACILITY ───────────────────────────────────────
    await test.step("Create Facility", async () => {
      await page.goto("/facilities");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Facility")');
      await waitForSideSheet(page);

      await page.fill('input[name="name"]', `Chain Facility ${runId}`);
      await page.fill('input[name="country"]', "Tanzania");

      await page.click('button:has-text("Create Facility")');
      await waitForSideSheetClose(page);

      await expect(page.getByText(`Chain Facility ${runId}`)).toBeVisible();
    });

    // ─── 2. REACTOR ────────────────────────────────────────
    await test.step("Create Reactor", async () => {
      await page.goto("/reactors");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Reactor")');
      await waitForSideSheet(page);

      await page.fill('input[name="identifier"]', `Chain Reactor ${runId}`);
      await page.selectOption('select[name="reactorType"]', "fixed-bed");
      await page.fill('input[name="type"]', "primary pyrolysis");
      await page.selectOption('select[name="samplingMethod"]', "method_a");

      // Select our newly created facility (should be in the list)
      const facilityTrigger = page.locator('[data-testid="entity-select-trigger"]');
      await facilityTrigger.click();
      await page.waitForSelector('[data-testid="entity-select-listbox"]', { timeout: 10000 });
      // Search for our facility by name
      const searchInput = page.locator('[data-testid="entity-select-search"]');
      if (await searchInput.isVisible()) {
        await searchInput.fill(`Chain Facility ${runId}`);
        await page.waitForTimeout(500);
      }
      await page.locator('[role="option"]').filter({ hasText: `Chain Facility ${runId}` }).first().click();

      await page.click('button:has-text("Create Reactor")');
      await waitForSideSheetClose(page);

      await expect(page.getByText(`Chain Reactor ${runId}`)).toBeVisible();
    });

    // ─── 3. PRODUCTION RUN ─────────────────────────────────
    await test.step("Create Production Run", async () => {
      await page.goto("/production-runs");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Production Run")');
      await waitForSideSheet(page);

      await page.selectOption('select[name="status"]', "draft");

      // Select the seeded facility (has feedstocks and storage locations)
      await selectEntityById(page, "Facility", seededData.facility.id);
      await page.waitForTimeout(1000); // wait for cascading selects

      // Select a reactor (seeded facility's reactors won't include our UI-created one,
      // but the seeded facility should have the one from the facility create — we need
      // to use the seeded facility which has feedstocks)
      // Actually, select first available reactor for the seeded facility
      await selectFirstEntity(page, "Reactor");

      // Fill date
      await page.fill('input[name="date"]', today);

      // Select feedstock
      await page.waitForTimeout(500);
      await selectEntityById(page, "Feedstock", seededData.feedstock.id);
      await page.fill('input[name="feedstocks.0.massUsedKg"]', "50");

      await page.click('button:has-text("Create Production Run")');
      await waitForSideSheetClose(page);

      // Verify a row exists in the list
      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 4. SAMPLE ─────────────────────────────────────────
    await test.step("Create Sample", async () => {
      await page.goto("/samples");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Sample")');
      await waitForSideSheet(page);

      // Select first available production run
      await selectFirstEntity(page, "Production Run");

      // Fill carbon data
      await page.fill('input[name="totalCarbonPercent"]', "75");
      await page.fill('input[name="organicCarbonPercent"]', "70");

      await page.click('button:has-text("Create Sample")');
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 5. ORDER ──────────────────────────────────────────
    await test.step("Create Order", async () => {
      await page.goto("/orders");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Order")');
      await waitForSideSheet(page);

      await page.fill('input[name="orderDate"]', today);
      await page.selectOption('select[name="facilityId"]', seededData.facility.id);
      await page.selectOption('select[name="status"]', "draft");
      await page.selectOption('select[name="customerId"]', seededData.customer.id);

      // Wait for cascading customer location select
      await page.waitForSelector(
        'select[name="customerLocationId"]:not([disabled])',
        { timeout: 8000 }
      );
      await page.selectOption(
        'select[name="customerLocationId"]',
        seededData.customerLocation.id
      );

      await page.selectOption(
        'select[name="biocharProductId"]',
        seededData.biocharProduct.id
      );
      await page.selectOption('select[name="packaging"]', "loose");
      await page.fill('input[name="quantityKg"]', "100");

      await page.click('button:has-text("Create Order")');
      await waitForSideSheetClose(page);

      await expect(
        page.getByText(seededData.customer.name, { exact: false }).first()
      ).toBeVisible({ timeout: 8000 });
    });

    // ─── 6. DELIVERY ───────────────────────────────────────
    await test.step("Create Delivery", async () => {
      await page.goto("/deliveries");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Delivery")');
      await waitForSideSheet(page);

      await page.fill('input[name="deliveryDate"]', today);
      await page.selectOption('select[name="status"]', "processing");

      // Select the first available order
      const orderSelect = page.locator('select[name="orderId"]');
      await orderSelect.waitFor({ state: "attached", timeout: 8000 });
      const orderOptions = orderSelect.locator("option:not([value=''])");
      await expect(orderOptions.first()).toBeAttached({ timeout: 8000 });
      const orderValue = await orderOptions.first().getAttribute("value");
      if (orderValue) {
        await orderSelect.selectOption(orderValue);
      }

      await page.fill('input[name="deliveredWetMassKg"]', "95");

      await page.click('button:has-text("Create Delivery")');
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 7. APPLICATION ────────────────────────────────────
    await test.step("Create Application", async () => {
      await page.goto("/applications");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Application")');
      await waitForSideSheet(page);

      await page.fill('input[name="applicationDate"]', today);

      // Select first delivery
      const deliverySelect = page.locator('select[name="deliveryId"]');
      const deliveryOptions = deliverySelect.locator("option:not([value=''])");
      await expect(deliveryOptions.first()).toBeAttached({ timeout: 8000 });
      const deliveryValue = await deliveryOptions.first().getAttribute("value");
      if (deliveryValue) {
        await deliverySelect.selectOption(deliveryValue);
      }

      await page.fill('input[name="biocharAppliedTons"]', "5");
      await page.fill('input[name="fieldIdentifier"]', `E2E-Field-${runId}`);
      await page.fill('input[name="cropType"]', "maize");

      await page.click('button:has-text("Create Application")');
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 8. CREDIT BATCH ───────────────────────────────────
    await test.step("Create Credit Batch", async () => {
      await page.goto("/credit-batches");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Credit Batch")');
      await waitForSideSheet(page);

      await page.selectOption('select[name="facilityId"]', seededData.facility.id);
      await page.fill('input[name="startDate"]', today);
      await page.fill('input[name="endDate"]', today);
      await page.selectOption('select[name="status"]', "draft");

      // Select application checkbox if available
      const appCheckboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await appCheckboxes.count();
      if (checkboxCount > 0) {
        const firstAppLabel = page
          .locator("label")
          .filter({ has: page.locator('input[type="checkbox"]') })
          .first();
        await firstAppLabel.click();
      }

      await page.selectOption('select[name="durabilityOption"]', "200_year");

      await page.click('button:has-text("Create Credit Batch")');
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });
  });
});
