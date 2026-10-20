/**
 * One double-click on Create saves one record (#1238).
 *
 * Each test fills a create form, double-clicks its submit button once, reloads
 * the list and reads the database: exactly one new record must exist. The
 * list screenshot (sidebar cropped) is attached as evidence.
 */
import type { Page, TestInfo } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { createDbConnection } from "./fixtures/db";
import { test, expect } from "./fixtures";
import { selectEntity, waitForSideSheet, waitForSideSheetClose } from "./fixtures/page-helpers";

const VIEWPORT = { width: 1440, height: 1000 };
/** The sidebar footer shows the signed-in email; evidence crops it off. */
const SIDEBAR_WIDTH_PX = 240;
const WET_KG = 1500;
const MOISTURE_PERCENT = 20;
const ORDER_KG = "150.5";
/** Lets a late second request commit before the database is read. */
const SETTLE_MS = 1500;

async function shootList(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({
    path,
    clip: { x: SIDEBAR_WIDTH_PX, y: 0, width: VIEWPORT.width - SIDEBAR_WIDTH_PX, height: VIEWPORT.height },
  });
  await info.attach(name, { path, contentType: "image/png" });
}

async function openCreateSheet(page: Page, url: string, facilityName: string, buttonName: string) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(url);
  await expect(page.locator("aside").getByText(facilityName, { exact: false })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await waitForSideSheet(page);
}

test.describe("Double-click on Create", () => {
  test("saves one feedstock intake", async ({ adminPage: page, seededData }, info) => {
    const { db, pool } = createDbConnection();
    const scope = and(eq(schema.feedstocks.organizationId, DEC_ORG_ID), eq(schema.feedstocks.facilityId, seededData.facility.id));
    try {
      const before = new Set((await db.select({ id: schema.feedstocks.id }).from(schema.feedstocks).where(scope)).map((row) => row.id));
      await openCreateSheet(page, `/feedstocks?facility=${seededData.facility.id}`, seededData.facility.name, "New feedstock");
      await page.locator('input[name="deliveryDate"]').fill("2026-01-15");
      await selectEntity(page, "Supplier", seededData.supplier.id, seededData.supplier.name);
      await selectEntity(page, "Feedstock Type", seededData.feedstockType.id, seededData.feedstockType.name);
      await page.locator('input[name="totalWetMassKg"]').fill(String(WET_KG));
      await page.locator('input[name="moisturePercent"]').fill(String(MOISTURE_PERCENT));
      await selectEntity(page, "Storage Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
      await expect(page.locator('input[name="allocations.0.allocatedWetMassKg"]')).toHaveValue(String(WET_KG));

      await page.getByRole("dialog").getByRole("button", { name: "Create feedstock", exact: true }).dblclick();
      await waitForSideSheetClose(page);
      await page.waitForTimeout(SETTLE_MS);
      await page.reload();
      await expect(page.locator("table tbody").getByText(/^FS-/).first()).toBeVisible({ timeout: 15000 });
      await shootList(page, info, "intake-list");

      const created = (await db.select({ id: schema.feedstocks.id }).from(schema.feedstocks).where(scope)).filter((row) => !before.has(row.id));
      expect(created).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  test("saves one order", async ({ adminPage: page, seededData }, info) => {
    const { db, pool } = createDbConnection();
    const scope = and(eq(schema.orders.organizationId, DEC_ORG_ID), eq(schema.orders.customerId, seededData.customer.id));
    try {
      await openCreateSheet(page, `/orders?facility=${seededData.facility.id}`, seededData.facility.name, "New order");
      await page.locator('input[name="orderDate"]').fill("2026-03-02");
      await selectEntity(page, "Customer", seededData.customer.id, seededData.customer.name);
      await selectEntity(page, "Customer location", seededData.customerLocation.id, seededData.customerLocation.name);
      await page.selectOption('select[name="packaging"]', "loose");
      await page.locator('input[name="quantityKg"]').fill(ORDER_KG);
      await selectEntity(page, "Formulation", seededData.formulation.id);

      await page.getByRole("dialog").getByRole("button", { name: "Create order", exact: true }).dblclick();
      await waitForSideSheetClose(page);
      await page.waitForTimeout(SETTLE_MS);
      await page.reload();
      await expect(page.locator("table tbody").getByText(/^OR-/).first()).toBeVisible({ timeout: 15000 });
      await shootList(page, info, "order-list");

      const created = await db.select({ id: schema.orders.id }).from(schema.orders).where(scope);
      expect(created).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
