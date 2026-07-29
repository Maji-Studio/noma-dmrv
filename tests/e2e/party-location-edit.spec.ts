import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as crypto from "node:crypto";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { createDbConnection } from "./fixtures/db";

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
  await dialog.locator('input[name="name"]').fill(updatedName);
  await dialog.getByRole("button", { name: "Save Changes" }).click();

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

  try {
    const [facility] = await db
      .select({
        id: schema.facilities.id,
        name: schema.facilities.name,
      })
      .from(schema.facilities)
      .where(eq(schema.facilities.organizationId, DEC_ORG_ID))
      .limit(1);

    if (!facility) {
      throw new Error("The E2E organization needs at least one facility");
    }

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
      distanceFromFacilityKm: LOCATION_DISTANCE_KM,
      distanceSource: LOCATION_DISTANCE_SOURCE,
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
      distanceFromFacilityKm: LOCATION_DISTANCE_KM,
      distanceSource: LOCATION_DISTANCE_SOURCE,
      isDefault: true,
    });

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
        distanceSource: schema.supplierLocations.distanceSource,
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
    expect(updatedSupplierLocation?.distanceSource).toBe(
      LOCATION_DISTANCE_SOURCE,
    );

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
        distanceSource: schema.customerLocations.distanceSource,
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
    expect(updatedCustomerLocation?.distanceSource).toBe(
      LOCATION_DISTANCE_SOURCE,
    );
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
    } finally {
      await pool.end();
    }
  }
});
