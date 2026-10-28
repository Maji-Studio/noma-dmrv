/**
 * Shared setup for specs that work in the customer edit sheet: open it from the
 * Customers list and seed or remove an extra saved location through the DB.
 */
import { expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";
import { clickRowMenuItem, waitForSideSheet } from "./page-helpers";

const SEARCH_TIMEOUT_MS = 15_000;
export const SECOND_LOCATION_NAME = "E2E North Block";

/** Search the Customers list for `code`, open its row menu's Edit and return the sheet dialog. */
export async function openCustomerSheet(page: Page, facilityId: string, code: string) {
  await page.goto(`/customers?facility=${facilityId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Search customers" }).fill(code);
  // The list is a table on desktop and cards on a phone: wait on the row menu, not on `table`.
  const menu = page.getByRole("button", { name: `Actions for ${code}` }).first();
  await expect(menu).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
  await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(1, { timeout: SEARCH_TIMEOUT_MS });
  await page.waitForLoadState("networkidle");
  await clickRowMenuItem(page, menu, "Edit");
  await waitForSideSheet(page);
  return page.getByRole("dialog");
}

/** Add a second saved location to a customer; returns its id. */
export async function seedSecondLocation(customerId: string, name = SECOND_LOCATION_NAME) {
  const { db, pool } = createDbConnection();
  try {
    const [second] = await db.insert(schema.customerLocations).values({
      organizationId: DEC_ORG_ID, customerId, name, country: "Tanzania",
      gpsLatitude: -6.9, gpsLongitude: 39.3, address: "E2E north field",
    }).returning({ id: schema.customerLocations.id });
    return second!.id;
  } finally {
    await pool.end();
  }
}

export async function deleteLocation(locationId: string) {
  const { db, pool } = createDbConnection();
  await db.delete(schema.customerLocations).where(eq(schema.customerLocations.id, locationId)).finally(() => pool.end());
}
