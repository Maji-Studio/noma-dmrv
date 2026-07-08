/**
 * Feedstocks E2E Tests
 *
 * Covers:
 * - UI CRUD: create a feedstock through the side sheet form, verify it appears in the list
 * - Allocation mirroring: total wet mass auto-fills the single-bin allocation
 */
import { test, expect } from "./fixtures";
import { selectEntity, waitForSideSheet, waitForSideSheetClose } from "./fixtures";

test.describe("Feedstock UI CRUD", () => {
  test("admin can create a feedstock and it appears in the list", async ({
    adminPage: page,
    seededData,
  }) => {
    // Navigate to feedstocks list with facility context
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    // Open the create side sheet
    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);

    // Fill delivery date (required)
    await page.fill('input[name="deliveryDate"]', "2026-01-15");

    // Select supplier (required)
    await selectEntity(
      page,
      "Supplier",
      seededData.supplier.id,
      seededData.supplier.name
    );

    // Select feedstock type (required)
    await selectEntity(
      page,
      "Feedstock Type",
      seededData.feedstockType.id,
      seededData.feedstockType.name
    );

    // Fill total wet mass; the single-bin allocation mirrors it automatically.
    await page.fill('input[name="totalWetMassKg"]', "100");
    await expect(
      page.locator('input[name="allocations.0.allocatedWetMassKg"]')
    ).toHaveValue("100");

    // Fill remaining required numeric fields (dry mass is auto-calculated)
    await page.fill('input[name="moisturePercent"]', "25");

    // Select storage bin in allocation row
    await selectEntity(
      page,
      "Storage Bin",
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

  test("does not silently pre-select a supplier on open (#379)", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    const supplierTrigger = dialog
      .locator("label")
      .filter({ hasText: "Supplier" })
      .first()
      .locator(
        "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]"
      )
      .locator('[data-testid="entity-select-trigger"]');

    // Suppliers are org-shared: the form must not auto-pick one (which would
    // silently attribute the delivery and cascade that supplier's transport
    // distance). The trigger shows its placeholder until the operator chooses.
    await expect(supplierTrigger).toHaveText(/Select supplier/i);

    // With no supplier chosen, no supplier-derived transport distance cascades.
    await expect(
      dialog.locator('input[name="transportDistanceKm"]')
    ).toHaveValue("");
  });

  test("explains the CERT badge on hover instead of leaving it bare (Phase 1, §6)", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    // The explanation ships as an always-on sr-only string for assistive tech
    // (one per CERT chip). Hovering a chip mounts a visible tooltip carrying the
    // SAME text — so the previously-unexplained "CERT" chip is legible to
    // sighted users too. The tooltip portals to <body> (outside the dialog), so
    // the robust signal is a page-scoped count that grows by exactly one.
    const explanationOnPage = page.getByText("Required for certification", {
      exact: true,
    });
    // waitForSideSheet resolves on dialog attach, not form paint — retry until
    // the first sr-only explanation exists (the chips mount in one commit)
    // before snapshotting the non-retrying count.
    await expect(explanationOnPage.first()).toBeAttached();
    const beforeHover = await explanationOnPage.count();
    expect(beforeHover).toBeGreaterThan(0);

    // The CERT chip is the sr-only text's parent span (the tooltip trigger);
    // hover a chip that lives inside the dialog so it isn't under the overlay.
    const chipInDialog = dialog
      .getByText("Required for certification", { exact: true })
      .first()
      .locator("xpath=..");
    await chipInDialog.hover();

    await expect(explanationOnPage).toHaveCount(beforeHover + 1);
  });
});
