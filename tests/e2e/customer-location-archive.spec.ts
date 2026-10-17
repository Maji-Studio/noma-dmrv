/**
 * Customer location archive E2E (Phase 7c): archive and restore from the
 * customer sheet, the default moving to another active location, the last
 * active location staying put, pickers hiding archived locations for new
 * orders, and an existing order keeping its archived destination.
 *
 * Rows are seeded through DB helpers; every assertion runs against the live UI.
 */
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as crypto from "node:crypto";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect, waitForSideSheet } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { clickRowMenuItem } from "./fixtures/page-helpers";

const SEARCH_TIMEOUT_MS = 15_000;
const SECOND_LOCATION_NAME = "E2E North Block";
const DEFAULT_MOVED = `${SECOND_LOCATION_NAME} is now the default location.`;
const LAST_ACTIVE_REASON = "This is the only active location, so it cannot be archived. Add or restore another location first.";

async function openCustomerSheet(page: Page, facilityId: string, code: string) {
  await page.goto(`/customers?facility=${facilityId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Search customers" }).fill(code);
  const rows = page.locator("table tbody tr");
  await expect(rows.filter({ hasText: code }).first()).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
  await expect(rows.filter({ hasNotText: code })).toHaveCount(0, { timeout: SEARCH_TIMEOUT_MS });
  await page.waitForLoadState("networkidle");
  await clickRowMenuItem(page, page.getByRole("button", { name: `Actions for ${code}` }).first(), "Edit");
  await waitForSideSheet(page);
  return page.getByRole("dialog");
}

async function seedSecondLocation(customerId: string) {
  const { db, pool } = createDbConnection();
  try {
    const [second] = await db.insert(schema.customerLocations).values({
      organizationId: DEC_ORG_ID, customerId, name: SECOND_LOCATION_NAME, country: "Tanzania",
      gpsLatitude: -6.9, gpsLongitude: 39.3, address: "E2E north field",
    }).returning({ id: schema.customerLocations.id });
    return second!.id;
  } finally {
    await pool.end();
  }
}

async function seedOrder(seeded: { facility: { id: string }; customer: { id: string }; formulation: { id: string } }, locationId: string, code: string) {
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.orders).values({
      organizationId: DEC_ORG_ID, code, facilityId: seeded.facility.id, orderDate: new Date(),
      customerId: seeded.customer.id, customerLocationId: locationId, formulationId: seeded.formulation.id,
      quantityKg: 100, packaging: "loose",
    });
  } finally {
    await pool.end();
  }
}

async function setDefault(locationId: string) {
  const { db, pool } = createDbConnection();
  try {
    await db.update(schema.customerLocations).set({ isDefault: true }).where(eq(schema.customerLocations.id, locationId));
  } finally {
    await pool.end();
  }
}

async function readLocation(locationId: string) {
  const { db, pool } = createDbConnection();
  try {
    const [row] = await db.select().from(schema.customerLocations).where(eq(schema.customerLocations.id, locationId));
    return row;
  } finally {
    await pool.end();
  }
}

test.describe("Customer location archive", () => {
  test("archiving the default moves it, the last active location cannot be archived, and restore brings one back", async ({ adminPage: page, seededData }) => {
    const { customer, customerLocation, facility } = seededData;
    const secondId = await seedSecondLocation(customer.id);
    await setDefault(customerLocation.id);
    try {
      const sheet = await openCustomerSheet(page, facility.id, customer.code);

      // Two active locations: both can be archived, and no archived group exists yet.
      await expect(sheet.getByRole("button", { name: `Archive ${SECOND_LOCATION_NAME}` })).toBeEnabled();
      await expect(sheet.getByRole("group", { name: "Archived locations" })).toHaveCount(0);

      await sheet.getByRole("button", { name: `Archive ${customerLocation.name}` }).click();
      await expect(page.getByText(`${customerLocation.name} archived. Restore it from Archived locations.`)).toBeVisible();
      await expect(page.getByText(DEFAULT_MOVED)).toBeVisible();

      const archivedGroup = sheet.getByRole("group", { name: "Archived locations" });
      await expect(archivedGroup.getByText(customerLocation.name)).toBeVisible();
      await expect(archivedGroup.getByRole("button", { name: `Edit ${customerLocation.name}` })).toHaveCount(0);
      expect((await readLocation(customerLocation.id))?.archivedAt).not.toBeNull();
      expect(await readLocation(customerLocation.id)).toMatchObject({ isDefault: false });
      expect(await readLocation(secondId)).toMatchObject({ isDefault: true });

      // The last active location says why before anyone clicks.
      await expect(sheet.getByText(LAST_ACTIVE_REASON)).toBeVisible();
      await expect(sheet.getByRole("button", { name: `Archive ${SECOND_LOCATION_NAME}` })).toBeDisabled();

      await archivedGroup.getByRole("button", { name: `Restore ${customerLocation.name}` }).click();
      await expect(page.getByText(`${customerLocation.name} restored.`)).toBeVisible();
      await expect(sheet.getByRole("group", { name: "Archived locations" })).toHaveCount(0);
      await expect(sheet.getByText(LAST_ACTIVE_REASON)).toHaveCount(0);
      expect((await readLocation(customerLocation.id))?.archivedAt).toBeNull();
      // The restored location does not take the default back from the one that holds it.
      expect(await readLocation(customerLocation.id)).toMatchObject({ isDefault: false });
    } finally {
      const { db, pool } = createDbConnection();
      await db.delete(schema.customerLocations).where(eq(schema.customerLocations.id, secondId)).finally(() => pool.end());
    }
  });

  test("deleting a location that an order uses offers Archive instead", async ({ adminPage: page, seededData }) => {
    const { customer, customerLocation, facility } = seededData;
    const secondId = await seedSecondLocation(customer.id);
    await seedOrder(seededData, customerLocation.id, `E2E-OR-LOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
    try {
      const sheet = await openCustomerSheet(page, facility.id, customer.code);
      await sheet.getByRole("button", { name: `Delete ${customerLocation.name}` }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).last().click();

      await expect(sheet.getByText(`${customerLocation.name} is in use and cannot be deleted.`)).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      await sheet.getByRole("button", { name: "Archive instead" }).click();
      await expect(sheet.getByRole("group", { name: "Archived locations" }).getByText(customerLocation.name)).toBeVisible();
      await expect(sheet.getByText(`${customerLocation.name} is in use and cannot be deleted.`)).toHaveCount(0);
    } finally {
      const { db, pool } = createDbConnection();
      await db.delete(schema.customerLocations).where(eq(schema.customerLocations.id, secondId)).finally(() => pool.end());
    }
  });

  test("a new order's picker hides an archived location, and an existing order keeps it without an editor", async ({ adminPage: page, seededData }) => {
    const { customer, customerLocation, facility } = seededData;
    const secondId = await seedSecondLocation(customer.id);
    const orderCode = `E2E-OR-LOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await seedOrder(seededData, customerLocation.id, orderCode);
    try {
      const sheet = await openCustomerSheet(page, facility.id, customer.code);
      await sheet.getByRole("button", { name: `Archive ${customerLocation.name}` }).click();
      await expect(page.getByText(`${customerLocation.name} archived. Restore it from Archived locations.`)).toBeVisible();
      await page.keyboard.press("Escape");

      // A new order cannot pick the archived location.
      await page.goto(`/orders?facility=${facility.id}`);
      await page.getByRole("button", { name: "New order" }).click();
      await waitForSideSheet(page);
      const dialog = page.getByRole("dialog");
      await dialog.locator("label").filter({ hasText: "Customer" }).first()
        .locator("xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]")
        .locator('[data-testid="entity-select-trigger"]').click();
      await page.getByTestId(`entity-option-${customer.id}`).click();
      await dialog.getByRole("combobox", { name: /^Customer location/ }).click();
      await expect(page.getByTestId("entity-select-listbox")).toBeVisible();
      await expect(page.getByTestId(`entity-option-${secondId}`)).toBeVisible();
      await expect(page.getByTestId(`entity-option-${customerLocation.id}`)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // The existing order keeps its stored destination, offers no location editor, and can move to an active one.
      await page.goto(`/orders?facility=${facility.id}`);
      await expect(page.locator("table tbody tr", { hasText: orderCode }).first()).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      await clickRowMenuItem(page, page.getByRole("button", { name: `Actions for ${orderCode}` }).first(), "Edit");
      await waitForSideSheet(page);
      const destination = page.getByRole("dialog").getByRole("combobox", { name: /^Customer location/ });
      await expect(destination).toContainText(`${customerLocation.name} (Archived)`);
      await destination.click();
      await expect(page.getByTestId("entity-select-edit")).toHaveCount(0);
      await expect(page.getByTestId(`entity-option-${secondId}`)).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      const { db, pool } = createDbConnection();
      await db.delete(schema.customerLocations).where(eq(schema.customerLocations.id, secondId)).finally(() => pool.end());
    }
  });
});
