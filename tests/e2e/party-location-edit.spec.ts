import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as crypto from "node:crypto";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { createDbConnection } from "./fixtures/db";
import {
  createTestFacility,
  deleteTestFacility,
} from "./fixtures/test-data-helpers";

const LOCATION_GPS_LATITUDE = -6.8;
const LOCATION_GPS_LONGITUDE = 39.28;
const LOCATION_DISTANCE_KM = 12.5;
const LOCATION_DISTANCE_SOURCE = "manual";
const LOCATION_COORDINATES = `${LOCATION_GPS_LATITUDE.toFixed(4)}, ${LOCATION_GPS_LONGITUDE.toFixed(4)}`;

async function openPartyEditSheet(
  page: Page,
  path: "/suppliers" | "/customers",
  code: string,
  facilityId: string,
  facilityName: string,
) {
  await page.goto(`${path}?facility=${facilityId}`);
  await expect(
    page.locator("aside").getByText(facilityName, { exact: false }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: /Search (suppliers|customers)/ }).fill(code);

  const actions = page.getByRole("button", {
    name: `Actions for ${code}`,
    exact: true,
  });
  await expect(actions).toBeVisible();
  await actions.click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
}

async function editLocationName(
  page: Page,
  originalName: string,
  updatedName: string,
  dialogTestId: string,
) {
  await page.getByRole("button", { name: `Edit ${originalName}` }).click();

  const dialog = page.getByTestId(dialogTestId);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Existing transport legs keep their recorded distances.")).toBeVisible();
  await expect(dialog.getByTestId("facility-distances")).toBeVisible();
  expect(await dialog.getByTestId("facility-distances").getByRole("spinbutton").count()).toBeGreaterThanOrEqual(2);
  await dialog.locator('input[name="name"]').fill(updatedName);
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
  await expect(
    page.getByText(LOCATION_COORDINATES, { exact: false }),
  ).toBeVisible();
}

test("supplier and customer locations can be edited from their edit sheets", async ({
  adminPage: page,
}) => {
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID().slice(0, 8);
  const supplierId = crypto.randomUUID();
  const supplierLocationId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const customerLocationId = crypto.randomUUID();
  const supplierCode = `E2E-SUP-EDIT-${runId}`;
  const customerCode = `E2E-CUST-EDIT-${runId}`;
  const supplierLocationName = `E2E Supplier Location ${runId}`;
  const updatedSupplierLocationName = `E2E Supplier Location Updated ${runId}`;
  const customerLocationName = `E2E Customer Location ${runId}`;
  const updatedCustomerLocationName = `E2E Customer Location Updated ${runId}`;

  let facilityId: string | undefined;
  let secondFacilityId: string | undefined;
  try {
    const facility = await createTestFacility();
    facilityId = facility.id;
    secondFacilityId = (await createTestFacility()).id;

    await db.insert(schema.suppliers).values({
      id: supplierId,
      organizationId: DEC_ORG_ID,
      code: supplierCode,
      name: `E2E Supplier ${runId}`,
    });
    await db.insert(schema.supplierLocations).values({
      id: supplierLocationId,
      organizationId: DEC_ORG_ID,
      supplierId,
      name: supplierLocationName,
      country: "Tanzania",
      gpsLatitude: LOCATION_GPS_LATITUDE,
      gpsLongitude: LOCATION_GPS_LONGITUDE,
      isDefault: true,
    });
    await db.insert(schema.customers).values({
      id: customerId,
      organizationId: DEC_ORG_ID,
      code: customerCode,
      name: `E2E Customer ${runId}`,
    });
    await db.insert(schema.customerLocations).values({
      id: customerLocationId,
      organizationId: DEC_ORG_ID,
      customerId,
      name: customerLocationName,
      country: "Tanzania",
      address: "E2E application site",
      gpsLatitude: LOCATION_GPS_LATITUDE,
      gpsLongitude: LOCATION_GPS_LONGITUDE,
      isDefault: true,
    });

    await db.insert(schema.supplierLocationFacilityDistances).values({ organizationId: DEC_ORG_ID, locationId: supplierLocationId, facilityId, distanceKm: LOCATION_DISTANCE_KM, distanceSource: LOCATION_DISTANCE_SOURCE });
    await db.insert(schema.customerLocationFacilityDistances).values({ organizationId: DEC_ORG_ID, locationId: customerLocationId, facilityId, distanceKm: LOCATION_DISTANCE_KM, distanceSource: LOCATION_DISTANCE_SOURCE });
    await openPartyEditSheet(
      page,
      "/suppliers",
      supplierCode,
      facility.id,
      facility.name,
    );
    await editLocationName(
      page,
      supplierLocationName,
      updatedSupplierLocationName,
      "supplier-location-edit-dialog",
    );

    const [updatedSupplierLocation] = await db
      .select({
        name: schema.supplierLocations.name,
        gpsLatitude: schema.supplierLocations.gpsLatitude,
        gpsLongitude: schema.supplierLocations.gpsLongitude,
      })
      .from(schema.supplierLocations)
      .where(eq(schema.supplierLocations.id, supplierLocationId));
    expect(updatedSupplierLocation?.name).toBe(updatedSupplierLocationName);
    expect(Number(updatedSupplierLocation?.gpsLatitude)).toBeCloseTo(
      LOCATION_GPS_LATITUDE,
    );
    expect(Number(updatedSupplierLocation?.gpsLongitude)).toBeCloseTo(
      LOCATION_GPS_LONGITUDE,
    );
    const [savedSupplierDistance] = await db.select().from(schema.supplierLocationFacilityDistances).where(eq(schema.supplierLocationFacilityDistances.locationId, supplierLocationId));
    expect(savedSupplierDistance).toMatchObject({ facilityId, distanceKm: LOCATION_DISTANCE_KM, distanceSource: LOCATION_DISTANCE_SOURCE });

    await openPartyEditSheet(
      page,
      "/customers",
      customerCode,
      facility.id,
      facility.name,
    );
    await editLocationName(
      page,
      customerLocationName,
      updatedCustomerLocationName,
      "customer-location-edit-dialog",
    );

    const [updatedCustomerLocation] = await db
      .select({
        name: schema.customerLocations.name,
        gpsLatitude: schema.customerLocations.gpsLatitude,
        gpsLongitude: schema.customerLocations.gpsLongitude,
      })
      .from(schema.customerLocations)
      .where(eq(schema.customerLocations.id, customerLocationId));
    expect(updatedCustomerLocation?.name).toBe(updatedCustomerLocationName);
    expect(Number(updatedCustomerLocation?.gpsLatitude)).toBeCloseTo(
      LOCATION_GPS_LATITUDE,
    );
    expect(Number(updatedCustomerLocation?.gpsLongitude)).toBeCloseTo(
      LOCATION_GPS_LONGITUDE,
    );
    const [savedCustomerDistance] = await db.select().from(schema.customerLocationFacilityDistances).where(eq(schema.customerLocationFacilityDistances.locationId, customerLocationId));
    expect(savedCustomerDistance).toMatchObject({ facilityId, distanceKm: LOCATION_DISTANCE_KM, distanceSource: LOCATION_DISTANCE_SOURCE });

    for (const target of [
      { path: "suppliers", param: "supplier", id: supplierId, location: supplierLocationId, name: updatedSupplierLocationName, dialog: "supplier-location-edit-dialog" },
      { path: "customers", param: "customer", id: customerId, location: customerLocationId, name: updatedCustomerLocationName, dialog: "customer-location-edit-dialog" },
    ]) {
      await page.goto(`/${target.path}?facility=${facilityId}&${target.param}=${target.id}&mode=edit&location=${target.location}`);
      await expect(page.locator("aside").getByText(facility.name, { exact: false })).toBeVisible();
      const dialog = page.getByTestId(target.dialog);
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('input[name="name"]')).toHaveValue(target.name);
      await expect(dialog.getByTestId("facility-distances")).toBeVisible();
    }
  } finally {
    try {
      await db
        .delete(schema.customerLocations)
        .where(eq(schema.customerLocations.id, customerLocationId));
      await db
        .delete(schema.customers)
        .where(eq(schema.customers.id, customerId));
      await db
        .delete(schema.supplierLocations)
        .where(eq(schema.supplierLocations.id, supplierLocationId));
      await db.delete(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
      if (secondFacilityId) await deleteTestFacility(secondFacilityId);
      if (facilityId) {
        await deleteTestFacility(facilityId);
      }
    } finally {
      await pool.end();
    }
  }
});
