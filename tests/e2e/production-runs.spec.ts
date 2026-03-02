/**
 * Production Run + Sample UI CRUD Tests
 *
 * Tests creating production runs and samples through the browser UI.
 * Uses seeded prerequisite data (facility, reactor, feedstock) from fixtures.
 *
 * Chain: Facility → Reactor → Production Run → Sample
 */
import { test, expect } from "./fixtures";

// Helper: click an EntitySelect trigger within a specific form field label context
async function selectEntity(
  page: import("@playwright/test").Page,
  fieldLabel: string,
  optionId: string
) {
  // Scope to the side sheet dialog to avoid matching table headers in the background
  const dialog = page.locator('[role="dialog"]');

  // Find the label, then go to parent FormField div which contains both label and EntitySelect
  const label = dialog.locator("label").filter({ hasText: fieldLabel }).first();
  const fieldContainer = label.locator("..");

  // Click the entity select trigger within this field
  const trigger = fieldContainer.locator(
    '[data-testid="entity-select-trigger"]'
  );
  await trigger.click();

  // Wait for and click the option
  await page.waitForSelector(`[data-testid="entity-option-${optionId}"]`, {
    timeout: 10000,
  });
  await page.click(`[data-testid="entity-option-${optionId}"]`);
}

// Helper: wait for side sheet to open
async function waitForSideSheet(page: import("@playwright/test").Page) {
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
}

// Helper: wait for side sheet to close (success indicator)
async function waitForSideSheetClose(page: import("@playwright/test").Page) {
  await page.waitForSelector('[role="dialog"]', {
    state: "hidden",
    timeout: 15000,
  });
}

test.describe("Production Run + Sample UI CRUD", () => {
  // First create a reactor through the UI so we have one to select
  let createdReactorName: string;
  let seededFacilityId: string;

  test("create production run via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    seededFacilityId = seededData.facility.id;

    // First, create a reactor for the seeded facility (needed for production run)
    await page.goto("/reactors");
    await page.waitForLoadState("networkidle");

    createdReactorName = `E2E-Reactor-${Date.now()}`;
    await page.click('button:has-text("New Reactor")');
    await waitForSideSheet(page);

    // Fill reactor form
    await page.fill('input[name="identifier"]', createdReactorName);
    await page.selectOption('select[name="reactorType"]', "fixed-bed");
    await page.fill('input[name="type"]', "primary pyrolysis");
    await page.selectOption('select[name="samplingMethod"]', "method_a");

    // Select the seeded facility
    await selectEntity(page, "Facility", seededData.facility.id);

    // Submit
    await page.click('button:has-text("Create Reactor")');
    await waitForSideSheetClose(page);

    // Verify reactor appears in list
    await expect(page.getByText(createdReactorName)).toBeVisible();

    // Now navigate to production runs
    await page.goto("/production-runs");
    await page.waitForLoadState("networkidle");

    // Click "New Production Run"
    await page.click('button:has-text("New Production Run")');
    await waitForSideSheet(page);

    // Fill required fields
    await page.selectOption('select[name="status"]', "draft");

    // Select facility (this enables reactor and feedstock selects)
    await selectEntity(page, "Facility", seededData.facility.id);

    // Wait a moment for cascading selects to load
    await page.waitForTimeout(1000);

    // Select the reactor we just created
    // The reactor EntitySelect should now be enabled and show our reactor
    const prodDialog = page.locator('[role="dialog"]');
    const reactorLabel = prodDialog.locator("label").filter({ hasText: "Reactor" }).first();
    const reactorTrigger = reactorLabel.locator("..").locator(
      '[data-testid="entity-select-trigger"]'
    );
    await reactorTrigger.click();

    // Wait for reactor options to load, then pick the first available
    await page.waitForSelector('[data-testid="entity-select-listbox"]', {
      timeout: 10000,
    });
    // Click the reactor that matches our created name
    const reactorOption = page
      .locator('[role="option"]')
      .filter({ hasText: createdReactorName });
    await reactorOption.first().click();

    // Fill date fields (should have defaults but let's ensure)
    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="date"]', today);

    // Select a feedstock (seeded feedstock should be available after facility selection)
    await page.waitForTimeout(500);
    const feedstockLabel = prodDialog.locator("label").filter({ hasText: "Feedstock" }).first();
    const feedstockTrigger = feedstockLabel.locator("..").locator(
      '[data-testid="entity-select-trigger"]'
    );
    await feedstockTrigger.click();
    await page.waitForSelector('[data-testid="entity-select-listbox"]', {
      timeout: 10000,
    });
    await page.click(
      `[data-testid="entity-option-${seededData.feedstock.id}"]`
    );

    // Fill feedstock mass
    await page.fill('input[name="feedstocks.0.massUsedKg"]', "50");

    // Submit
    await page.click('button:has-text("Create Production Run")');
    await waitForSideSheetClose(page);

    // Verify production run appears in list
    await page.waitForLoadState("networkidle");
    // The production run should show up - verify the page has at least one row
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("create sample via UI form", async ({ adminPage: page }) => {
    // Navigate to samples
    await page.goto("/samples");
    await page.waitForLoadState("networkidle");

    // Click "New Sample"
    await page.click('button:has-text("New Sample")');
    await waitForSideSheet(page);

    // Select production run - it's an EntitySelect
    const sampleDialog = page.locator('[role="dialog"]');
    const prodRunLabel = sampleDialog.locator("label").filter({ hasText: "Production Run" }).first();
    const prodRunTrigger = prodRunLabel.locator("..").locator(
      '[data-testid="entity-select-trigger"]'
    );
    await prodRunTrigger.click();
    await page.waitForSelector('[data-testid="entity-select-listbox"]', {
      timeout: 10000,
    });
    // Select the first available production run
    const firstOption = page.locator('[role="option"]').first();
    await firstOption.click();

    // Fill some carbon analysis data
    await page.fill('input[name="totalCarbonPercent"]', "75");
    await page.fill('input[name="organicCarbonPercent"]', "70");

    // Submit
    await page.click('button:has-text("Create Sample")');
    await waitForSideSheetClose(page);

    // Verify sample appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });
});
