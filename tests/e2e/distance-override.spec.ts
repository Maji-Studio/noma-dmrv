/**
 * Distance override E2E (#420, slices 4 to 6).
 *
 * A feedstock or delivery distance is two-state: the location's facility
 * distance, read-only, or an explicit override unlocked by "Override".
 * Covers, on both forms: set an override, save, read it back as an override,
 * clear it and read the location default again. The feedstock flow then
 * changes the location's distance and corrects the recorded one with the
 * deliberate "Refresh from location" action. The location edit dialogs'
 * freeze notice is asserted in `party-location-edit.spec.ts`.
 */
import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { test, expect, type SeededChainData } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import {
  selectEntity,
  selectEntityByText,
  waitForFacilityHydration,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import { fillStockMoisture } from "./helpers/stock-moisture";

// Past, after the seeded product placement.
const FEEDSTOCK_DATE = "2026-10-02";
const DELIVERY_TIME = "2026-10-03T12:00";
const LOCATION_KM = 42;
const LOCATION_KM_AFTER_EDIT = 55;
const FEEDSTOCK_OVERRIDE_KM = 60;
const DELIVERY_OVERRIDE_KM = 30;
// The seeded customer location is 25 km one way from the facility.
const SEEDED_CUSTOMER_KM = 25;
const OVERRIDE_NOTE = "E2E detour via the coastal road";

function distanceField(dialog: Locator) {
  return dialog.getByRole("spinbutton", { name: "One-way distance (km)" });
}

/** The read view's One-way distance field names its basis on a secondary line. */
async function expectReadBasis(dialog: Locator, basis: "Override" | "Location default") {
  await expect(dialog.getByText("Basis", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByText(basis, { exact: true })).toBeVisible();
}

async function openFeedstock(page: Page, seededData: SeededChainData, id: string) {
  await page.goto(`/feedstocks?facility=${seededData.facility.id}&feedstock=${id}`);
  await waitForFacilityHydration(page, seededData.facility.name);
  await waitForSideSheet(page);
  return page.locator('[role="dialog"]');
}

async function createOrderViaUi(page: Page, seededData: SeededChainData) {
  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.click('button:has-text("New order")');
  await waitForSideSheet(page);
  await page.fill('input[name="orderDate"]', "2026-03-02");
  await selectEntity(page, "Customer", seededData.customer.id, seededData.customer.name);
  await selectEntity(page, "Customer location", seededData.customerLocation.id, seededData.customerLocation.name);
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', "50");
  await selectEntity(page, "Formulation", seededData.formulation.id, seededData.formulation.name);
  await page.click('button[type="submit"]:has-text("Create order")');
  await waitForSideSheetClose(page);
}

test.describe("Distance override (#420)", () => {
  test("feedstock: override, clear back to the location default, then refresh from location", async ({
    adminPage: page,
    seededData,
  }) => {
    const { db, pool } = createDbConnection();
    try {
      const [location] = await db.select({ id: schema.supplierLocations.id })
        .from(schema.supplierLocations)
        .where(eq(schema.supplierLocations.supplierId, seededData.supplier.id));
      await db.insert(schema.supplierLocationFacilityDistances).values({
        organizationId: DEC_ORG_ID, locationId: location.id, facilityId: seededData.facility.id,
        distanceKm: LOCATION_KM, distanceSource: "manual",
      });

      // Create: the supplier's location distance is derived and read-only.
      await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await page.getByRole("button", { name: "New feedstock" }).click();
      await waitForSideSheet(page);
      const sheet = page.locator('[role="dialog"]');
      await page.fill('input[name="deliveryDate"]', FEEDSTOCK_DATE);
      await selectEntity(page, "Supplier", seededData.supplier.id, seededData.supplier.name);
      await expect(distanceField(sheet)).toHaveValue(String(LOCATION_KM));
      await expect(distanceField(sheet)).toHaveAttribute("readonly", "");
      await expect(sheet.getByText("Location default", { exact: true })).toBeVisible();

      // Override unlocks manual entry with a source and a note.
      await sheet.getByRole("button", { name: "Override", exact: true }).click();
      await expect(distanceField(sheet)).toBeEditable();
      await page.fill('input[name="transportDistanceKm"]', String(FEEDSTOCK_OVERRIDE_KM));
      await sheet.getByRole("combobox", { name: "Distance source" }).selectOption("document");
      await sheet.getByRole("textbox", { name: "Distance note" }).fill(OVERRIDE_NOTE);
      await expect(sheet.getByText(`Clearing returns to the location default, ${LOCATION_KM} km.`)).toBeVisible();

      await selectEntity(page, "Feedstock Type", seededData.feedstockType.id, seededData.feedstockType.name);
      await page.fill('input[name="totalWetMassKg"]', "100");
      await page.fill('input[name="moisturePercent"]', "25");
      await selectEntity(page, "Storage Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
      await sheet.getByRole("button", { name: "Create feedstock" }).click();
      await waitForSideSheetClose(page);

      const [created] = await db.select().from(schema.feedstocks).where(and(
        eq(schema.feedstocks.facilityId, seededData.facility.id),
        eq(schema.feedstocks.deliveryDate, new Date(`${FEEDSTOCK_DATE}T00:00:00.000Z`)),
      ));
      expect(created).toMatchObject({ distanceKmOverride: FEEDSTOCK_OVERRIDE_KM, distanceSource: "document", distanceNote: OVERRIDE_NOTE });

      // Read: the override reads as an override, with its note.
      let view = await openFeedstock(page, seededData, created.id);
      await expectReadBasis(view, "Override");
      await expect(view.getByText(OVERRIDE_NOTE)).toBeVisible();
      const route = () => view.getByRole("list", { name: "Feedstock to processing route" });
      await expect(route()).toContainText(`${FEEDSTOCK_OVERRIDE_KM} km one way`, { timeout: 15000 });
      await expect(view.getByTestId("transport-distance-drift")).toHaveCount(0);

      // Edit: Clear override returns the field to the derived value.
      await page.getByRole("button", { name: "Edit feedstock" }).click();
      const editSheet = page.locator('[role="dialog"]');
      await expect(editSheet.getByText("Override", { exact: true })).toBeVisible();
      await expect(distanceField(editSheet)).toHaveValue(String(FEEDSTOCK_OVERRIDE_KM));
      await editSheet.getByRole("button", { name: "Clear override" }).click();
      await expect(distanceField(editSheet)).toHaveValue(String(LOCATION_KM));
      await expect(distanceField(editSheet)).toHaveAttribute("readonly", "");
      await expect(editSheet.getByRole("combobox", { name: "Distance source" })).toHaveCount(0);
      await editSheet.getByRole("button", { name: "Save changes", exact: true }).click();
      await waitForSideSheetClose(page);

      const [cleared] = await db.select().from(schema.feedstocks).where(eq(schema.feedstocks.id, created.id));
      expect(cleared).toMatchObject({ distanceKmOverride: null, distanceSource: null, distanceNote: null });
      view = await openFeedstock(page, seededData, created.id);
      await expectReadBasis(view, "Location default");
      await expect(route()).toContainText(`${LOCATION_KM} km one way`, { timeout: 15000 });

      // A location edit leaves the recorded distance alone and shows the drift.
      await db.update(schema.supplierLocationFacilityDistances)
        .set({ distanceKm: LOCATION_KM_AFTER_EDIT })
        .where(eq(schema.supplierLocationFacilityDistances.locationId, location.id));
      view = await openFeedstock(page, seededData, created.id);
      const drift = view.getByTestId("transport-distance-drift");
      await expect(drift).toContainText(`Recorded ${LOCATION_KM} km. Location now ${LOCATION_KM_AFTER_EDIT} km.`, { timeout: 15000 });
      await expect(route()).toContainText(`${LOCATION_KM} km one way`);

      await drift.getByRole("button", { name: "Refresh from location" }).click();
      const confirm = page.getByRole("dialog", { name: "Refresh distance from location?" });
      await expect(confirm).toContainText(`changes from ${LOCATION_KM} km to ${LOCATION_KM_AFTER_EDIT} km`);
      await confirm.getByRole("button", { name: "Refresh from location" }).click();
      await expect(confirm).toBeHidden();
      await expect(page.getByText(`Distance for ${created.code} refreshed to ${LOCATION_KM_AFTER_EDIT} km.`)).toBeVisible();
      await expect(drift).toHaveCount(0);
      await expect(route()).toContainText(`${LOCATION_KM_AFTER_EDIT} km one way`, { timeout: 15000 });
    } finally {
      await pool.end();
    }
  });

  test("delivery: override, then clear back to the recorded location distance", async ({
    adminPage: page,
    seededData,
  }) => {
    const { db, pool } = createDbConnection();
    try {
      await createOrderViaUi(page, seededData);
      await page.goto(`/deliveries?facility=${seededData.facility.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await page.getByRole("button", { name: "New delivery" }).click();
      await waitForSideSheet(page);
      const sheet = page.locator('[role="dialog"]');

      await page.fill('input[name="deliveryDate"]', DELIVERY_TIME);
      await selectEntityByText(page, "Order", seededData.customer.name);
      await expect(distanceField(sheet)).toHaveValue(String(SEEDED_CUSTOMER_KM));
      await expect(distanceField(sheet)).toHaveAttribute("readonly", "");
      await expect(sheet.getByText("Location default", { exact: true })).toBeVisible();

      await sheet.getByRole("button", { name: "Override", exact: true }).click();
      await page.fill('input[name="distanceKmOverride"]', String(DELIVERY_OVERRIDE_KM));
      await sheet.getByRole("textbox", { name: "Distance note" }).fill(OVERRIDE_NOTE);
      await expect(sheet.getByRole("list", { name: "Biochar distribution route" }))
        .toContainText(new RegExp(`${DELIVERY_OVERRIDE_KM * 2} km\\s*round trip`));

      await selectEntity(page, "Actual source bin", seededData.productStorageLocation.id, seededData.productStorageLocation.name);
      await page.fill('input[name="deliveredWetMassKg"]', "45");
      await fillStockMoisture(page, "delivery", "10");
      await page.click('button[type="submit"]:has-text("Create delivery")');
      await waitForSideSheetClose(page);

      const [created] = await db.select().from(schema.deliveries)
        .where(eq(schema.deliveries.facilityId, seededData.facility.id));
      expect(created).toMatchObject({ distanceKmOverride: DELIVERY_OVERRIDE_KM, distanceSource: "manual", distanceNote: OVERRIDE_NOTE });

      await page.goto(`/deliveries?facility=${seededData.facility.id}&delivery=${created.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await waitForSideSheet(page);
      const view = page.locator('[role="dialog"]');
      await expectReadBasis(view, "Override");
      await expect(view.getByText(OVERRIDE_NOTE)).toBeVisible();
      await expect(view.getByRole("list", { name: "Biochar distribution route" }))
        .toContainText(`${DELIVERY_OVERRIDE_KM} km one way`, { timeout: 15000 });

      await page.getByRole("button", { name: "Edit delivery" }).click();
      const editSheet = page.locator('[role="dialog"]');
      await editSheet.getByRole("button", { name: "Clear override" }).click();
      await expect(distanceField(editSheet)).toHaveValue(String(SEEDED_CUSTOMER_KM));
      await expect(editSheet.getByRole("textbox", { name: "Distance note" })).toHaveCount(0);
      await editSheet.getByRole("button", { name: "Save changes", exact: true }).click();
      await waitForSideSheetClose(page);

      const [cleared] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, created.id));
      expect(cleared).toMatchObject({ distanceKmOverride: null, distanceSource: null, distanceNote: null, recordedDistanceKm: SEEDED_CUSTOMER_KM });

      await page.goto(`/deliveries?facility=${seededData.facility.id}&delivery=${created.id}`);
      await waitForSideSheet(page);
      await expectReadBasis(page.locator('[role="dialog"]'), "Location default");
      await expect(page.locator('[role="dialog"]').getByRole("list", { name: "Biochar distribution route" }))
        .toContainText(`${SEEDED_CUSTOMER_KM} km one way`, { timeout: 15000 });
    } finally {
      await pool.end();
    }
  });
});
