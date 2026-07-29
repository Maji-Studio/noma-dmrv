import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as crypto from "node:crypto";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";

async function openPartyEditSheet(
  page: Page,
  path: "/suppliers" | "/customers",
  code: string,
  facilityId: string,
) {
  await page.goto(`${path}?facility=${facilityId}`);
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
}

test("supplier and customer locations can be edited from their edit sheets", async ({
  adminPage: page,
}) => {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
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
  const [facility] = await db
    .select({ id: schema.facilities.id })
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
    gpsLatitude: -6.8,
    gpsLongitude: 39.28,
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
    gpsLatitude: -6.8,
    gpsLongitude: 39.28,
    isDefault: true,
  });

  try {
    await openPartyEditSheet(page, "/suppliers", supplierCode, facility.id);
    await editLocationName(
      page,
      supplierLocationName,
      updatedSupplierLocationName,
      "supplier-location-edit-dialog",
    );

    await openPartyEditSheet(page, "/customers", customerCode, facility.id);
    await editLocationName(
      page,
      customerLocationName,
      updatedCustomerLocationName,
      "customer-location-edit-dialog",
    );
  } finally {
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
    await pool.end();
  }
});
