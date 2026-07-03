/**
 * Production Run + Sample UI CRUD Tests
 *
 * Tests creating production runs and samples through the browser UI.
 * Uses seeded prerequisite data (facility, reactor, feedstock) from fixtures.
 *
 * Chain: Facility → Reactor → Production Run; samples anchor on a
 * credit batch directly (issue #309).
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import {
  selectEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

test.describe("Production Run + Sample UI CRUD", () => {
  async function createProductionRun(page: Page, seededData: SeededChainData) {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await expect(
      page.getByRole("button", { name: "New Production Run" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    await page.selectOption('select[name="status"]', "draft");

    await selectEntity(
      page,
      "Reactor",
      seededData.reactor.id,
      seededData.reactor.identifier
    );

    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="date"]', today);

    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name
    );

    await page.fill('input[name="feedstockWetMassKg"]', "50");
    await page.fill('input[name="feedstockMoisturePercent"]', "15");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Production Run")').click();
    await waitForSideSheetClose(page);
  }

  test("create production run via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    await createProductionRun(page, seededData);
    // The production run should show up - verify the page has at least one row
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("create sample via UI form", async ({ adminPage: page, seededData }) => {
    // Samples anchor on a credit batch, not a production run (issue #309).
    const batch = await seedCreditBatch(
      seededData.facility.id,
      crypto.randomUUID().slice(0, 8),
      seededData.feedstockType.id,
    );

    // Navigate to samples
    await page.goto(`/samples?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    // Click "New Sample"
    await page.click('button:has-text("New Sample")');
    await waitForSideSheet(page);

    const sampleDialog = page.locator('[role="dialog"]');
    await selectEntity(page, "Credit Batch", batch.id, batch.code);

    // Fill some carbon analysis data
    await page.fill('input[name="totalCarbonPercent"]', "75");
    await page.fill('input[name="organicCarbonPercent"]', "70");

    // Submit
    const submitBtn = sampleDialog.locator('button[type="submit"]');
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    await waitForSideSheetClose(page);

    // Verify sample appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });
});
