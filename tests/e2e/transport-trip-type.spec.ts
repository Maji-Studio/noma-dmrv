/**
 * Transport Trip Type E2E Tests (issue #316)
 *
 * The GHG Accounting Module defaults transport to a full round trip; a
 * one-way trip needs an evidenced onward destination. Covers:
 * - Feedstock form: Trip type selector defaults to Return; a One-way override
 *   persists onto the derived transport leg and prefills on reopen.
 * - Biochar delivery form: same selector, persisted on the delivery row.
 * - Relabeled party-record distance copy ("one-way … per leg") on the
 *   supplier and customer-location forms, so operators know the ×2 happens
 *   at emissions time, not at the stored distance.
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  selectEntityByText,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

// Sorts ahead of the seeded feedstock/delivery rows (deliveryDate desc), so
// "first row" reopens the record this spec created.
const FUTURE_DATE = "2027-01-15";

async function createOrderViaUi(page: Page, seededData: SeededChainData) {
  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await expect(page).toHaveURL(/\/orders/, { timeout: 10000 });

  // Wait for hydration — the sidebar shows the facility name once the
  // FacilityProvider resolves.
  await expect(
    page.locator("aside").getByText(seededData.facility.name, { exact: false })
  ).toBeVisible({ timeout: 15000 });

  await page.click('button:has-text("New Order")');
  await waitForSideSheet(page);

  await page.fill('input[name="orderDate"]', "2026-03-02");
  await page.selectOption('select[name="customerId"]', seededData.customer.id);
  await page.waitForSelector(
    'select[name="customerLocationId"]:not([disabled])',
    { timeout: 8000 }
  );
  await page.selectOption(
    'select[name="customerLocationId"]',
    seededData.customerLocation.id
  );
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', "50");
  await selectEntity(page, "Biochar Product", seededData.biocharProduct.id);
  await page.click('button[type="submit"]:has-text("Create Order")');
  await waitForSideSheetClose(page);
}

test.describe("Transport trip type (#316)", () => {
  test("feedstock form defaults to Return and persists a One-way override on the derived leg", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    // Relabeled distance copy + Return default.
    await expect(
      dialog.getByText("One-way distance (per leg, km)")
    ).toBeVisible();
    const tripType = dialog.locator('select[name="transportTripType"]');
    await expect(tripType).toHaveValue("return");

    // Minimal valid feedstock. The distance is required for a persistable
    // derived leg — trip type rides on that leg, so without a distance there
    // is nothing to persist it to.
    await page.fill('input[name="deliveryDate"]', FUTURE_DATE);
    await selectEntity(
      page,
      "Supplier",
      seededData.supplier.id,
      seededData.supplier.name
    );
    await selectEntity(
      page,
      "Feedstock Type",
      seededData.feedstockType.id,
      seededData.feedstockType.name
    );
    await page.fill('input[name="transportDistanceKm"]', "40");
    await page.fill('input[name="totalWetMassKg"]', "100");
    await page.fill('input[name="moisturePercent"]', "25");
    await selectEntity(
      page,
      "Storage Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name
    );

    // Override to One-way, then save.
    await tripType.selectOption("one_way");
    await dialog.locator('button:has-text("Create Feedstock")').click();
    await waitForSideSheetClose(page);

    // Reopen: row → view sheet → edit form. The trip type prefills async from
    // the saved derived leg, so the auto-retrying assertion absorbs the fetch.
    await page.waitForLoadState("networkidle");
    await page.locator("table tbody tr").first().click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit Feedstock" }).click();
    await expect(
      page.locator('[role="dialog"] select[name="transportTripType"]')
    ).toHaveValue("one_way", { timeout: 15000 });
  });

  test("delivery form defaults to Return and persists a One-way override", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await createOrderViaUi(page, seededData);

    await page.goto(`/deliveries?facility=${seededData.facility.id}`);
    await expect(page).toHaveURL(/\/deliveries/, { timeout: 10000 });

    await page.click('button:has-text("New Delivery")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    // Relabeled distance copy + Return default.
    await expect(
      dialog.getByText("One-way distance (per leg, km)")
    ).toBeVisible();
    const tripType = dialog.locator('select[name="tripType"]');
    await expect(tripType).toHaveValue("return");

    await page.fill('input[name="deliveryDate"]', FUTURE_DATE);
    await page.selectOption('select[name="status"]', "upcoming");
    await selectEntityByText(page, "Order", seededData.customer.name);
    await page.fill('input[name="deliveredWetMassKg"]', "45");
    await tripType.selectOption("one_way");
    await page.click('button[type="submit"]:has-text("Create Delivery")');
    await waitForSideSheetClose(page);

    // Reopen: row → view sheet → edit form. tripType is a delivery column, so
    // the edit form's defaultValues carry it directly.
    await page.waitForLoadState("networkidle");
    await page.locator("table tbody tr").first().click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit Delivery" }).click();
    await expect(
      page.locator('[role="dialog"] select[name="tripType"]')
    ).toHaveValue("one_way", { timeout: 15000 });
  });

  test("supplier and customer-location forms carry the one-way (per leg) distance copy", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    // Supplier create sheet → pending source-location sub-form.
    await page.goto("/suppliers");
    await page.click('button:has-text("New Supplier")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Add Location")').click();
    await expect(
      dialog.getByText("One-way distance to facility (per leg, km)")
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Customer detail → Add Location form.
    await page.goto(`/customers/${seededData.customer.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Add Location" }).click();
    await expect(
      page.getByText("One-way distance from facility (per leg, km)")
    ).toBeVisible({ timeout: 10000 });
  });
});
