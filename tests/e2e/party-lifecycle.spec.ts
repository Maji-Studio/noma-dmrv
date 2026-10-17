/**
 * Supplier and customer lifecycle E2E (Phase 7b): archive, the archived view,
 * restore, the in-use delete refusal with "Archive instead", the read-only
 * archived sheet, pickers that hide archived rows for new references, and an
 * existing order that keeps its archived customer's stored destination.
 *
 * Rows are seeded through DB helpers; every assertion runs against the live UI.
 */
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as crypto from "node:crypto";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect, createTestSupplier, deleteTestSupplier, waitForSideSheet } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { clickRowMenuItem } from "./fixtures/page-helpers";

const SEARCH_TIMEOUT_MS = 15_000;

async function openList(page: Page, path: "suppliers" | "customers", facilityId: string, code: string) {
  await page.goto(`/${path}?facility=${facilityId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: path === "suppliers" ? "Search suppliers" : "Search customers" }).fill(code);
  const rows = page.locator("table tbody tr");
  await expect(rows.filter({ hasText: code }).first()).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
  // The debounced search query re-renders the list; wait until it has settled on the match.
  await expect(rows.filter({ hasNotText: code })).toHaveCount(0, { timeout: SEARCH_TIMEOUT_MS });
  await page.waitForLoadState("networkidle");
}

async function rowAction(page: Page, code: string, item: string) {
  await clickRowMenuItem(page, page.getByRole("button", { name: `Actions for ${code}` }).first(), item);
}

async function seedCustomer(tag: string) {
  const { db, pool } = createDbConnection();
  try {
    const [customer] = await db.insert(schema.customers).values({
      organizationId: DEC_ORG_ID, code: `E2E-CUST-LC-${tag}`, name: `E2E Lifecycle Customer ${tag}`,
    }).returning();
    return customer!;
  } finally {
    await pool.end();
  }
}

async function removeCustomer(customerId: string) {
  const { db, pool } = createDbConnection();
  try {
    await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
  } finally {
    await pool.end();
  }
}

async function setArchived(table: "suppliers" | "customers", id: string, archived: boolean) {
  const { db, pool } = createDbConnection();
  try {
    const target = table === "suppliers" ? schema.suppliers : schema.customers;
    await db.update(target).set({ archivedAt: archived ? new Date() : null }).where(eq(target.id, id));
  } finally {
    await pool.end();
  }
}

test.describe("Supplier archive and restore", () => {
  test("archive hides the row, the archived view lists it, the sheet is read-only, restore brings it back", async ({ adminPage: page, seededData }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const supplier = await createTestSupplier({ code: `E2E-SUP-LC-${tag}`, name: `E2E Lifecycle Supplier ${tag}` });
    try {
      await openList(page, "suppliers", seededData.facility.id, supplier.code);
      await expect(page.getByText("Active suppliers", { exact: true })).toBeVisible();

      await rowAction(page, supplier.code, "Archive");
      await expect(page.getByText(`Supplier ${supplier.code} archived. Restore it from the archived view.`)).toBeVisible();
      await expect(page.locator("table tbody tr", { hasText: supplier.code })).toHaveCount(0);

      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(page.getByText("Archived suppliers", { exact: true })).toBeVisible();
      await expect(page.locator("table tbody tr", { hasText: supplier.code }).first()).toBeVisible();

      await page.getByRole("button", { name: `Actions for ${supplier.code}` }).first().click();
      await expect(page.getByRole("menuitem", { name: "Restore" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");

      await page.locator("table tbody tr", { hasText: supplier.code }).first().click();
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText("This supplier is archived. Pickers hide it and new intakes cannot use it.")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Edit supplier" })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Restore", exact: true }).click();
      await expect(page.getByText(`Supplier ${supplier.code} restored.`)).toBeVisible();

      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(page.locator("table tbody tr", { hasText: supplier.code }).first()).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
    } finally {
      await deleteTestSupplier(supplier.id).catch(() => {});
    }
  });

  test("deleting a supplier with intakes offers Archive instead", async ({ adminPage: page, seededData }) => {
    const { supplier, facility } = seededData;
    await openList(page, "suppliers", facility.id, supplier.code);
    await rowAction(page, supplier.code, "Delete");
    await page.getByRole("dialog").getByRole("button", { name: /^Delete/ }).last().click();

    await expect(page.getByText(`${supplier.code} is in use and cannot be deleted.`)).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
    await expect(page.getByText("Archive it instead. Existing records keep it, while pickers hide it.")).toBeVisible();
    await page.getByRole("button", { name: "Archive instead" }).click();
    await expect(page.getByText(`Supplier ${supplier.code} archived. Restore it from the archived view.`)).toBeVisible();
    await expect(page.getByText(`${supplier.code} is in use and cannot be deleted.`)).toHaveCount(0);
  });

  test("a feedstock keeping an archived supplier shows it, and the picker opens a read-only View with Restore", async ({ adminPage: page, seededData }) => {
    const { supplier, facility, feedstock } = seededData;
    await setArchived("suppliers", supplier.id, true);
    await page.goto(`/feedstocks?facility=${facility.id}&feedstock=${feedstock.id}&mode=edit`);
    await waitForSideSheet(page);

    const trigger = page.getByRole("dialog").locator('[data-testid="entity-select-trigger"]').filter({ hasText: supplier.name });
    await expect(trigger).toContainText("(Archived)", { timeout: SEARCH_TIMEOUT_MS });
    await trigger.click();
    await expect(page.getByTestId("entity-select-edit")).toHaveText(`View ${supplier.name}`);
    await page.getByTestId("entity-select-edit").click();

    const view = page.getByTestId("supplier-edit-dialog");
    await expect(view.getByText("This supplier is archived. Pickers hide it and new intakes cannot use it.")).toBeVisible();
    await expect(view.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await view.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByText(`Supplier ${supplier.code} restored.`)).toBeVisible();
    await expect(view).toHaveCount(0);
  });

  test("an archived supplier is hidden from the new feedstock picker", async ({ adminPage: page, seededData }) => {
    const { supplier, facility } = seededData;
    await setArchived("suppliers", supplier.id, true);
    await page.goto(`/feedstocks?facility=${facility.id}`);
    await page.getByRole("button", { name: "New feedstock" }).click();
    await waitForSideSheet(page);
    const dialog = page.getByRole("dialog");
    await dialog.locator("label").filter({ hasText: "Supplier" }).first()
      .locator("xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]")
      .locator('[data-testid="entity-select-trigger"]').click();
    await expect(page.getByTestId("entity-select-listbox")).toBeVisible();
    await expect(page.getByTestId(`entity-option-${supplier.id}`)).toHaveCount(0);
  });
});

test.describe("Customer archive and restore", () => {
  test("archive hides the row, the archived view lists it, the sheet is read-only, restore brings it back", async ({ adminPage: page, seededData }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const customer = await seedCustomer(tag);
    try {
      await openList(page, "customers", seededData.facility.id, customer.code);
      await expect(page.getByText("Active customers", { exact: true })).toBeVisible();

      await rowAction(page, customer.code, "Archive");
      await expect(page.getByText(`Customer ${customer.code} archived. Restore it from the archived view.`)).toBeVisible();
      await expect(page.locator("table tbody tr", { hasText: customer.code })).toHaveCount(0);

      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(page.getByText("Archived customers", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Actions for ${customer.code}` }).first().click();
      await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");

      await page.locator("table tbody tr", { hasText: customer.code }).first().click();
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText("This customer is archived. Pickers hide it and new orders cannot use it. Existing orders keep it.")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Edit customer" })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Restore", exact: true }).click();
      await expect(page.getByText(`Customer ${customer.code} restored.`)).toBeVisible();
    } finally {
      await removeCustomer(customer.id).catch(() => {});
    }
  });

  test("deleting a customer whose orders have deliveries offers Archive instead before anything is confirmed", async ({ adminPage: page, seededData }) => {
    const { customer, facility, customerLocation, formulation, productStorageLocation } = seededData;
    const { db, pool } = createDbConnection();
    try {
      const [order] = await db.insert(schema.orders).values({
        organizationId: DEC_ORG_ID, code: `E2E-OR-LC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, facilityId: facility.id,
        orderDate: new Date(), customerId: customer.id, customerLocationId: customerLocation.id,
        formulationId: formulation.id, quantityKg: 100, packaging: "loose",
      }).returning({ id: schema.orders.id });
      await db.insert(schema.deliveries).values({
        organizationId: DEC_ORG_ID, code: `E2E-DL-LC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, facilityId: facility.id,
        deliveryDate: new Date(), orderId: order!.id, storageLocationId: productStorageLocation.id, deliveredWetMassKg: 10,
      });
    } finally {
      await pool.end();
    }
    await openList(page, "customers", facility.id, customer.code);
    await rowAction(page, customer.code, "Delete");

    // The dry run refuses while the dialog opens, so the operator never sees a Delete button that cannot work.
    await expect(page.getByText(`${customer.code} is in use and cannot be deleted.`)).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Archive instead" }).click();
    await expect(page.getByText(`Customer ${customer.code} archived. Restore it from the archived view.`)).toBeVisible();
  });

  test("deleting a customer lists its orders without deliveries and deletes them with it", async ({ adminPage: page, seededData }) => {
    const { customer, facility, customerLocation, formulation } = seededData;
    const { db, pool } = createDbConnection();
    const orderCode = `E2E-OR-LC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      await db.insert(schema.orders).values({
        organizationId: DEC_ORG_ID, code: orderCode, facilityId: facility.id,
        orderDate: new Date(), customerId: customer.id, customerLocationId: customerLocation.id,
        formulationId: formulation.id, quantityKg: 100, packaging: "loose",
      });
      await openList(page, "customers", facility.id, customer.code);
      await rowAction(page, customer.code, "Delete");

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("This order has no deliveries and is deleted too:")).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      await expect(dialog.getByText(orderCode)).toBeVisible();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();

      await expect(page.getByText(`Customer deleted. Also deleted 1 order without deliveries: ${orderCode}.`)).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      expect(await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, customer.id))).toHaveLength(0);
      expect(await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.code, orderCode))).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  test("an order added while the dialog is open is shown for confirmation before anything is deleted", async ({ adminPage: page, seededData }) => {
    const { customer, facility, customerLocation, formulation } = seededData;
    const { db, pool } = createDbConnection();
    const firstCode = `E2E-OR-LC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const lateCode = `E2E-OR-LC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const orderValues = (code: string) => ({
      organizationId: DEC_ORG_ID, code, facilityId: facility.id, orderDate: new Date(), customerId: customer.id,
      customerLocationId: customerLocation.id, formulationId: formulation.id, quantityKg: 100, packaging: "loose" as const,
    });
    try {
      await db.insert(schema.orders).values(orderValues(firstCode));
      await openList(page, "customers", facility.id, customer.code);
      await rowAction(page, customer.code, "Delete");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(firstCode)).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });

      await db.insert(schema.orders).values(orderValues(lateCode));
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog.getByText("The orders deleted with this customer changed. Review the list and delete again.")).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      await expect(dialog.getByText(lateCode)).toBeVisible();
      expect(await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, customer.id))).toHaveLength(1);

      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByText(/^Customer deleted\. Also deleted 2 orders without deliveries/)).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      expect(await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.customerId, customer.id))).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});

test.describe("An order under an archived customer", () => {
  test("keeps the customer and stored destination, refuses another destination, and stays filterable", async ({ adminPage: page, seededData }) => {
    const { facility, customer, customerLocation, formulation } = seededData;
    const { db, pool } = createDbConnection();
    const orderCode = `E2E-OR-ARCH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    let secondLocationId: string | undefined;
    try {
      const [secondLocation] = await db.insert(schema.customerLocations).values({
        organizationId: DEC_ORG_ID, customerId: customer.id, name: "E2E Second Location", country: "Tanzania",
        gpsLatitude: -6.9, gpsLongitude: 39.3,
      }).returning({ id: schema.customerLocations.id });
      secondLocationId = secondLocation!.id;
      await db.insert(schema.orders).values({
        organizationId: DEC_ORG_ID, code: orderCode, facilityId: facility.id, orderDate: new Date(),
        customerId: customer.id, customerLocationId: customerLocation.id, formulationId: formulation.id,
        quantityKg: 100, packaging: "loose",
      });
      await setArchived("customers", customer.id, true);

      await page.goto(`/orders?facility=${facility.id}`);
      await expect(page.locator("table tbody tr", { hasText: orderCode }).first()).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });

      // The customer filter still lists the archived customer, marked as archived.
      await page.getByRole("combobox", { name: /Filter by customer/ }).click();
      await expect(page.getByTestId(`entity-option-${customer.id}`)).toContainText("Archived");
      await page.getByTestId(`entity-option-${customer.id}`).click();
      await expect(page.locator("table tbody tr", { hasText: orderCode }).first()).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
      await page.getByRole("button", { name: "Clear", exact: true }).click();

      await rowAction(page, orderCode, "Edit");
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("combobox", { name: /^Customer/ }).first()).toContainText(`${customer.name} (Archived)`);
      const destination = sheet.getByRole("combobox", { name: /^Customer location/ });
      await expect(destination).toContainText(customerLocation.name);
      await expect(destination).toHaveAttribute("aria-readonly", "true");
      await expect(sheet.getByText("This customer is archived, so the customer location stays as stored. Restore the customer to change it.")).toBeVisible();
      await destination.click({ force: true });
      await expect(page.getByTestId("entity-select-listbox")).toHaveCount(0);
      await expect(page.getByTestId("entity-select-edit")).toHaveCount(0);

      await page.keyboard.press("Escape");
    } finally {
      if (secondLocationId) await db.delete(schema.customerLocations).where(eq(schema.customerLocations.id, secondLocationId));
      await pool.end();
    }
  });

  test("a new order's customer picker hides an archived customer", async ({ adminPage: page, seededData }) => {
    const { facility, customer } = seededData;
    await setArchived("customers", customer.id, true);
    await page.goto(`/orders?facility=${facility.id}`);
    await page.getByRole("button", { name: "New order" }).click();
    await waitForSideSheet(page);
    await page.locator('[role="dialog"] label').filter({ hasText: "Customer" }).first()
      .locator("xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]")
      .locator('[data-testid="entity-select-trigger"]').click();
    await expect(page.getByTestId("entity-select-listbox")).toBeVisible();
    await expect(page.getByTestId(`entity-option-${customer.id}`)).toHaveCount(0);
  });
});
