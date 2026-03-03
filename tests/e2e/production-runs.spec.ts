/**
 * Production Run + Sample UI CRUD Tests
 *
 * Tests creating production runs and samples through the browser UI.
 * Uses seeded prerequisite data (facility, reactor, feedstock) from fixtures.
 *
 * Chain: Facility → Reactor → Production Run → Sample
 */
import { test, expect } from "./fixtures";
import { selectEntity, waitForSideSheet, waitForSideSheetClose } from "./fixtures/page-helpers";

test.describe("Production Run + Sample UI CRUD", () => {
  test("create production run via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    // Navigate to production runs
    await page.goto("/production-runs");
    await page.waitForLoadState("networkidle");

    // Click "New Production Run"
    await page.click('button:has-text("New Production Run")');
    await waitForSideSheet(page);

    // Fill required fields
    await page.selectOption('select[name="status"]', "draft");

    // Select seeded facility (this enables reactor and feedstock selects)
    await selectEntity(page, "Facility", seededData.facility.id);

    // Wait for cascading selects to load
    await page.waitForTimeout(1000);

    // Select the seeded reactor
    await selectEntity(page, "Reactor", seededData.reactor.id);

    // Fill date
    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="date"]', today);

    // Select feedstock source bin
    await page.waitForTimeout(500);
    await selectEntity(page, "Feedstock Source Bin", seededData.feedstockStorageLocation.id);

    // Fill feedstock mass used
    await page.fill('input[name="feedstockMassUsedKg"]', "50");

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

    // Select production run - use the selectEntity helper scoped to dialog
    const sampleDialog = page.locator('[role="dialog"]');
    const prodRunLabel = sampleDialog.locator("label").filter({ hasText: "Production Run" }).first();
    const prodRunField = prodRunLabel.locator("..");
    const prodRunTrigger = prodRunField.locator('[data-testid="entity-select-trigger"]');

    // Open the entity select dropdown
    await prodRunTrigger.click();
    await page.waitForSelector('[data-testid="entity-select-listbox"]', {
      timeout: 10000,
    });

    // Get the first option's ID and use dispatchEvent to simulate a real click
    const firstOption = page.locator('[data-testid^="entity-option-"]').first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });

    // Get the option ID before clicking
    const optionTestId = await firstOption.getAttribute("data-testid");
    const productionRunId = optionTestId?.replace("entity-option-", "") || "";
    // Click the option
    await firstOption.click();

    // Wait for the dropdown to close
    await page.waitForTimeout(1000);

    // Verify the trigger shows the selected value
    const triggerText = await prodRunTrigger.textContent();

    // If the EntitySelect click doesn't propagate to React Hook Form Controller,
    // use evaluate to directly set the form value via React internals
    if (triggerText?.includes("Select") || !triggerText?.trim()) {
      // Re-open and try clicking via evaluate
      await prodRunTrigger.click();
      await page.waitForSelector('[data-testid="entity-select-listbox"]', { timeout: 5000 });
      await page.evaluate((id) => {
        const option = document.querySelector(`[data-testid="entity-option-${id}"]`);
        if (option) {
          const event = new MouseEvent("click", { bubbles: true, cancelable: true });
          option.dispatchEvent(event);
        }
      }, productionRunId);
      await page.waitForTimeout(1000);
    }

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
