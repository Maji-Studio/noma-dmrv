/**
 * Feedstocks E2E Tests
 *
 * Covers:
 * - UI CRUD: create a feedstock through the side sheet form, verify it appears in the list
 */
import { test, expect } from "./fixtures";
import { selectEntity, waitForSideSheet, waitForSideSheetClose } from "./fixtures";

test.describe("Feedstock UI CRUD", () => {
  test("admin can create a feedstock and it appears in the list", async ({
    adminPage: page,
    seededData,
  }) => {
    // Navigate to feedstocks list
    await page.goto("/feedstocks");
    await page.waitForLoadState("networkidle");

    // Open the create side sheet
    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);

    // Select seeded feedstock delivery (required)
    await selectEntity(
      page,
      "Feedstock Delivery",
      seededData.feedstockDelivery.id,
      seededData.feedstockDelivery.code
    );

    // Wait for facilityId auto-population from delivery
    await page.waitForTimeout(1000);

    // Select seeded feedstock type (required)
    await selectEntity(
      page,
      "Feedstock Type",
      seededData.feedstockType.id,
      seededData.feedstockType.name
    );

    // Fill required numeric field
    await page.fill('input[name="massDryKg"]', "75");

    // Fill optional fields for coverage
    await page.fill('input[name="massWetKg"]', "100");
    await page.fill('input[name="moistureContentPercent"]', "25");

    // Select storage location (optional)
    await selectEntity(
      page,
      "Storage Location",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name
    );

    // Submit the form
    await page.locator('[role="dialog"]').locator('button:has-text("Create Feedstock")').click();
    await waitForSideSheetClose(page);

    // Verify feedstock appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });
});
