/**
 * Transport round trip E2E Tests (issue #852)
 *
 * Every transport leg counts as a round trip: the vehicle returns empty, so
 * the entered one-way distance counts twice in emissions (Transportation
 * module v1.1 §5). There is no trip type choice anywhere. Covers:
 * - Feedstock form: no trip type control; the one-way entry shows the counted
 *   round trip, and the saved record shows both figures.
 * - Biochar delivery form: same, with the destination's stored distance.
 * - Organization defaults: no default trip type setting.
 * - The one-way (per leg) distance copy on the supplier and customer-location
 *   forms, so operators know they enter one way.
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  selectEntityByText,
  waitForFacilityHydration,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import { fillStockMoisture } from "./helpers/stock-moisture";

// Sorts ahead of the seeded feedstock/delivery rows (deliveryDate desc), and
// its list label finds the record this spec created.
const FUTURE_DATE = "2027-01-15";
const FUTURE_DATE_LABEL = "Jan 15, 2027";

async function createOrderViaUi(page: Page, seededData: SeededChainData) {
  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await expect(page).toHaveURL(/\/orders/, { timeout: 10000 });

  await waitForFacilityHydration(page, seededData.facility.name);

  await page.click('button:has-text("New order")');
  await waitForSideSheet(page);

  await page.fill('input[name="orderDate"]', "2026-03-02");
  await selectEntity(page, "Customer", seededData.customer.id, seededData.customer.name);
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
  await selectEntity(page, "Formulation", seededData.formulation.id, seededData.formulation.name);
  await page.click('button[type="submit"]:has-text("Create order")');
  await waitForSideSheetClose(page);
}

test.describe("Transport round trip (#852)", () => {
  test("feedstock form has no trip type and shows the counted round trip", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await waitForFacilityHydration(page, seededData.facility.name);

    await page.click('button:has-text("New feedstock")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    await expect(dialog.getByText("Distance", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/trip type/i)).toHaveCount(0);
    await expect(dialog.locator('select[name="transportTripType"]')).toHaveCount(0);

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
    await expect(dialog.getByTestId("transport-distance-total")).toHaveText(
      "80 km round trip counted"
    );
    await page.fill('input[name="totalWetMassKg"]', "100");
    await page.fill('input[name="moisturePercent"]', "25");
    await selectEntity(
      page,
      "Storage Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name
    );
    await dialog.locator('button:has-text("Create feedstock")').click();
    await waitForSideSheetClose(page);

    // Reopen: the view sheet shows the one-way entry with the counted round trip.
    await page.waitForLoadState("networkidle");
    // Target the row by its date: a bare first row can race the re-sort.
    await page.locator("table tbody tr", { hasText: FUTURE_DATE_LABEL }).first().click();
    await waitForSideSheet(page);
    await expect(
      page
        .locator('[role="dialog"]')
        .getByText("40 km one way · 80 km round trip counted", { exact: true })
        .first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("delivery form has no trip type and shows the counted round trip", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await createOrderViaUi(page, seededData);

    await page.goto(`/deliveries?facility=${seededData.facility.id}`);
    await expect(page).toHaveURL(/\/deliveries/, { timeout: 10000 });
    await waitForFacilityHydration(page, seededData.facility.name);

    await page.click('button:has-text("New delivery")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    // The unit sits in the control's suffix; the accessible name keeps it.
    await expect(dialog.getByRole("spinbutton", { name: "One-way distance (km)" })).toBeVisible();
    await expect(dialog.getByText(/trip type/i)).toHaveCount(0);
    await expect(dialog.locator('select[name="tripType"]')).toHaveCount(0);

    await page.fill('input[name="deliveryDate"]', `${FUTURE_DATE}T12:00`);
    await selectEntityByText(page, "Order", seededData.customer.name);
    // The seeded customer location is 25 km one way from the facility.
    await expect(dialog.getByText("50 km round trip counted", { exact: true })).toBeVisible();
    await page.selectOption('select[name="storageLocationId"]', seededData.productStorageLocation.id);
    await page.fill('input[name="deliveredWetMassKg"]', "45");
    await fillStockMoisture(page, "delivery", "10");
    await page.click('button[type="submit"]:has-text("Create delivery")');
    await waitForSideSheetClose(page);

    await page.waitForLoadState("networkidle");
    // Target the row by its date: a bare first row can race the re-sort.
    await page.locator("table tbody tr", { hasText: FUTURE_DATE_LABEL }).first().click();
    await waitForSideSheet(page);
    await expect(
      page
        .locator('[role="dialog"]')
        .getByText("25 km one way · 50 km round trip counted", { exact: true })
    ).toBeVisible({ timeout: 15000 });
  });

  test("organization defaults have no trip type setting", async ({ adminPage: page }) => {
    await page.goto("/settings/defaults");
    await expect(page.getByRole("group", { name: "Application evidence" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/trip type/i)).toHaveCount(0);
  });

  test("supplier and customer-location forms carry the one-way (per leg) distance copy", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    // Supplier create sheet → pending source-location dialog.
    await page.goto("/suppliers");
    await page.click('button:has-text("New supplier")');
    await waitForSideSheet(page);
    const supplierSheet = page.getByRole("dialog", {
      name: "Create supplier",
    });
    await supplierSheet.getByRole("button", { name: "Add location" }).click();
    const supplierLocationDialog = page.getByRole("dialog", {
      name: "Add location",
    });
    await expect(
      supplierLocationDialog.getByText("Distance to facility", { exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Customer detail → Add location dialog.
    await page.goto(`/customers?customer=${seededData.customer.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Edit customer" }).click();
    await page.getByRole("button", { name: "Add location" }).click();
    // The locations table header now carries the same copy (QA detail-view
    // pass), so target the form INPUT via its accessible name.
    await expect(
      page.getByRole("spinbutton", {
        name: "Distance from facility",
      })
    ).toBeVisible({ timeout: 10000 });
  });
});
