/**
 * Links into an archived facility (#1499): delete refusals link blockers that
 * live in archived facilities, and those links open the record read only over
 * the current page. Seeds an order and a feedstock intake in a fresh facility,
 * archives it the way the cascade does, then opens their recordHref links.
 */
import { eq, inArray } from "drizzle-orm";
import * as crypto from "node:crypto";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import {
  test,
  expect,
  createTestFacility,
  createTestStorageLocation,
  deleteTestFacility,
  deleteTestStorageLocation,
  type TestFacility,
  type TestStorageLocation,
} from "./fixtures";
import { createDbConnection } from "./fixtures/db";

const SHEET_TIMEOUT_MS = 30_000;

type SeededChain = { customer: { id: string }; customerLocation: { id: string }; formulation: { id: string }; supplier: { id: string }; feedstockType: { id: string } };

/** An order and a feedstock intake in a fresh facility, archived the way the cascade does. */
async function seedArchivedFacility(seeded: SeededChain) {
  const facility: TestFacility = await createTestFacility();
  const bin: TestStorageLocation = await createTestStorageLocation(facility.id, { type: "feedstock_bin" });
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const orderCode = `E2E-OR-1499-${tag}`;
  const feedstockCode = `E2E-FS-1499-${tag}`;
  const { db, pool } = createDbConnection();
  try {
    const [order] = await db.insert(schema.orders).values({
      organizationId: DEC_ORG_ID, code: orderCode, facilityId: facility.id, orderDate: new Date(),
      customerId: seeded.customer.id, customerLocationId: seeded.customerLocation.id,
      formulationId: seeded.formulation.id, quantityKg: 100, packaging: "loose",
    }).returning({ id: schema.orders.id });
    const [feedstock] = await db.insert(schema.feedstocks).values({
      organizationId: DEC_ORG_ID, code: feedstockCode, facilityId: facility.id, deliveryDate: new Date(),
      supplierId: seeded.supplier.id, feedstockTypeId: seeded.feedstockType.id,
      massWetKg: 1000, massDryKg: 800, moistureContentPercent: 20, storageLocationId: bin.id,
    }).returning({ id: schema.feedstocks.id });
    const archivedAt = new Date();
    await db.update(schema.facilities).set({ archivedAt }).where(eq(schema.facilities.id, facility.id));
    await db.update(schema.storageLocations).set({ archivedAt }).where(eq(schema.storageLocations.id, bin.id));
    await db.update(schema.orders).set({ archivedAt }).where(eq(schema.orders.id, order.id));
    await db.update(schema.feedstocks).set({ archivedAt }).where(eq(schema.feedstocks.id, feedstock.id));
    return {
      facility, orderId: order.id, orderCode, feedstockId: feedstock.id, feedstockCode,
      async cleanup() {
        const conn = createDbConnection();
        try {
          await conn.db.delete(schema.orders).where(inArray(schema.orders.id, [order.id]));
          await conn.db.delete(schema.feedstocks).where(inArray(schema.feedstocks.id, [feedstock.id]));
        } finally {
          await conn.pool.end();
        }
        await deleteTestStorageLocation(bin.id);
        await deleteTestFacility(facility.id);
      },
    };
  } finally {
    await pool.end();
  }
}

test.describe("Links into an archived facility", () => {
  test("an order link opens the order read only and keeps the working facility", async ({ adminPage: page, seededData }) => {
    const seeded = await seedArchivedFacility(seededData);
    try {
      const { facility, orderId, orderCode } = seeded;
      await page.goto(`/orders?facility=${facility.id}&order=${orderId}`);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("heading", { name: orderCode })).toBeVisible({ timeout: SHEET_TIMEOUT_MS });
      await expect(sheet.getByText(`${facility.name} is archived, so this order is read-only.`)).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Edit order" })).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeVisible();
      // The archived facility never becomes the working facility.
      await expect.poll(() => new URL(page.url()).searchParams.get("facility")).not.toBe(facility.id);
      expect(new URL(page.url()).searchParams.get("order")).toBe(orderId);
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(sheet).toBeHidden();
    } finally {
      await seeded.cleanup();
    }
  });

  test("a feedstock edit link still opens the intake read only", async ({ adminPage: page, seededData }) => {
    const seeded = await seedArchivedFacility(seededData);
    try {
      const { facility, feedstockId, feedstockCode } = seeded;
      await page.goto(`/feedstock-intake?facility=${facility.id}&feedstock=${feedstockId}&mode=edit`);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("heading", { name: feedstockCode })).toBeVisible({ timeout: SHEET_TIMEOUT_MS });
      await expect(sheet.getByText(`${facility.name} is archived, so this feedstock intake is read-only.`)).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Edit feedstock" })).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Save changes" })).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get("facility")).not.toBe(facility.id);
    } finally {
      await seeded.cleanup();
    }
  });
});
