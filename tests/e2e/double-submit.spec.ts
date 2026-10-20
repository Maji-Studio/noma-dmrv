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
import { retireDocumentsForEntities } from "@/data-access/documents";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { createDbConnection } from "./fixtures/db";
import { test, expect } from "./fixtures";
import { selectEntity, selectFirstEntity, waitForSideSheet, waitForSideSheetClose } from "./fixtures/page-helpers";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import { fillStockMoisture } from "./helpers/stock-moisture";

const VIEWPORT = { width: 1440, height: 1000 };
/** The sidebar footer shows the signed-in email; evidence crops it off. */
const SIDEBAR_WIDTH_PX = 240;
const WET_KG = 1500;
const MOISTURE_PERCENT = 20;
const DELIVERY_MOISTURE_PERCENT = "10";
const ORDER_KG = "150.5";
const APPLICATION_KG = "100";
const APPLICATION_FIELD_SIZE_HA = "2";
const PURE_BIOCHAR_PERCENT = "100";
const APPLICATION_ATTACHMENT = {
  name: "double-submit-application.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% e2e application double submit probe\n"),
};
const LAB_REPORT = {
  name: "double-submit-lab-report.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% e2e double submit probe\n"),
};
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

  test("saves one Sample with its lab report", async ({ adminPage: page, seededData, testUsers }) => {
    const { db, pool } = createDbConnection();
    const ctx = { organizationId: DEC_ORG_ID, userId: testUsers.admin.id, orgRole: "owner" as const, isPlatformAdmin: true };
    const sampleIds: string[] = [];
    try {
      const batch = await seedCreditBatch(seededData.facility.id, crypto.randomUUID().slice(0, 8).toUpperCase(), seededData.feedstockType.id);
      await openCreateSheet(page, `/samples?facility=${seededData.facility.id}`, seededData.facility.name, "New Sample");
      const dialog = page.getByRole("dialog", { name: "Create Sample" });
      await selectFirstEntity(page, "Credit Batch");
      const samplingTime = dialog.locator('input[name="samplingTime"]');
      await expect(samplingTime).toBeEnabled();
      // The fixture facility uses UTC.
      await samplingTime.fill(new Date().toISOString().slice(0, 16));
      await page.fill('input[name="totalCarbonPercent"]', "75");
      await page.fill('input[name="organicCarbonPercent"]', "70");
      await dialog.locator("#sample-deferred-documents-upload").setInputFiles(LAB_REPORT);
      await expect(dialog.getByText(LAB_REPORT.name)).toBeVisible();

      await dialog.getByRole("button", { name: "Create Sample", exact: true }).dblclick();
      await waitForSideSheetClose(page);
      await page.waitForTimeout(SETTLE_MS);

      const created = await db.select({ id: schema.samples.id }).from(schema.samples)
        .where(and(eq(schema.samples.organizationId, DEC_ORG_ID), eq(schema.samples.creditBatchId, batch.id)));
      sampleIds.push(...created.map((row) => row.id));
      expect(created).toHaveLength(1);
      const attached = await db.select({ id: schema.documents.id }).from(schema.documents)
        .where(and(eq(schema.documents.organizationId, DEC_ORG_ID), eq(schema.documents.entityType, "sample"), eq(schema.documents.entityId, created[0]!.id)));
      expect(attached).toHaveLength(1);
    } finally {
      // The teardown sweep removes the Sample; its uploaded file goes through
      // the app's own retire path so the stored object is deleted too.
      if (sampleIds.length > 0) {
        await db.transaction((tx) => retireDocumentsForEntities(ctx, tx, sampleIds.map((entityId) => ({ entityType: "sample", entityId })), "system"));
        await processPendingStorageObjectDeletions(ctx);
      }
      await pool.end();
    }
  });

  test("saves one application with its PDF attachment", async ({ adminPage: page, seededData, testUsers }, info) => {
    const { db, pool } = createDbConnection();
    const ctx = { organizationId: DEC_ORG_ID, userId: testUsers.admin.id, orgRole: "owner" as const, isPlatformAdmin: true };
    const fieldIdentifier = `E2E-Double-Submit-${crypto.randomUUID()}`;
    const scope = and(eq(schema.applications.organizationId, DEC_ORG_ID), eq(schema.applications.fieldIdentifier, fieldIdentifier));
    try {
      // Use the seeded product bin, with an order and delivery created by the UI.
      await openCreateSheet(page, `/orders?facility=${seededData.facility.id}`, seededData.facility.name, "New order");
      await page.locator('input[name="orderDate"]').fill(new Date().toISOString().slice(0, 10));
      await selectEntity(page, "Customer", seededData.customer.id, seededData.customer.name);
      await selectEntity(page, "Customer location", seededData.customerLocation.id, seededData.customerLocation.name);
      await selectEntity(page, "Formulation", seededData.formulation.id, seededData.formulation.name);
      await page.selectOption('select[name="packaging"]', "loose");
      await page.locator('input[name="quantityKg"]').fill(ORDER_KG);
      await page.getByRole("dialog").getByRole("button", { name: "Create order", exact: true }).click();
      await waitForSideSheetClose(page);

      await openCreateSheet(page, `/deliveries?facility=${seededData.facility.id}`, seededData.facility.name, "New delivery");
      await selectFirstEntity(page, "Order");
      await selectEntity(page, "Actual source bin", seededData.productStorageLocation.id, seededData.productStorageLocation.name);
      await page.locator('input[name="deliveredWetMassKg"]').fill(ORDER_KG);
      await fillStockMoisture(page, "delivery", DELIVERY_MOISTURE_PERCENT);
      await page.getByRole("dialog").getByRole("button", { name: "Create delivery", exact: true }).click();
      await waitForSideSheetClose(page);

      await openCreateSheet(page, `/applications?facility=${seededData.facility.id}`, seededData.facility.name, "New application");
      const dialog = page.getByRole("dialog", { name: "Create application" });
      await page.locator('input[name="applicationDate"]').fill(new Date().toISOString().slice(0, 10));
      await selectFirstEntity(page, "Delivery");
      await page.locator('input[name="biocharAppliedKg"]').fill(APPLICATION_KG);
      await page.locator('input[name="fieldSizeHa"]').fill(APPLICATION_FIELD_SIZE_HA);
      await page.locator('input[name="fieldIdentifier"]').fill(fieldIdentifier);
      await page.locator('input[name="cropType"]').fill("maize");
      await dialog.locator("#application-create-supporting-evidence-upload").setInputFiles(APPLICATION_ATTACHMENT);
      await expect(dialog.getByText(APPLICATION_ATTACHMENT.name)).toBeVisible();

      await dialog.getByRole("button", { name: "Create application", exact: true }).dblclick();
      await waitForSideSheetClose(page);
      await page.waitForTimeout(SETTLE_MS);
      const created = await db.select({ id: schema.applications.id, code: schema.applications.code }).from(schema.applications).where(scope);
      expect(created).toHaveLength(1);
      await page.reload();
      await expect(page.locator("table tbody").getByText(created[0]!.code, { exact: true })).toBeVisible();
      await shootList(page, info, "application-list");
      const attached = await db.select({ id: schema.documents.id }).from(schema.documents)
        .where(and(eq(schema.documents.organizationId, DEC_ORG_ID), eq(schema.documents.entityType, "application"), eq(schema.documents.entityId, created[0]!.id)));
      expect(attached).toHaveLength(1);
    } finally {
      // Retire uploads even if an assertion fails; the global sweep removes rows.
      const created = await db.select({ id: schema.applications.id }).from(schema.applications).where(scope);
      if (created.length > 0) {
        await db.transaction((tx) => retireDocumentsForEntities(ctx, tx, created.map(({ id: entityId }) => ({ entityType: "application", entityId })), "system"));
        await processPendingStorageObjectDeletions(ctx);
      }
      await pool.end();
    }
  });

  test("saves one formulation", async ({ adminPage: page, seededData }, info) => {
    const { db, pool } = createDbConnection();
    // The global teardown sweeps this name prefix, including automatic codes.
    const name = `E2E Double Submit Formulation ${crypto.randomUUID()}`;
    const scope = and(eq(schema.formulations.organizationId, DEC_ORG_ID), eq(schema.formulations.name, name));
    try {
      await openCreateSheet(page, `/formulations?facility=${seededData.facility.id}`, seededData.facility.name, "New formulation");
      const dialog = page.getByRole("dialog", { name: "Create formulation" });
      await dialog.locator('input[name="name"]').fill(name);
      await dialog.locator('input[name="biocharPercent"]').fill(PURE_BIOCHAR_PERCENT);
      await dialog.getByRole("button", { name: "Create formulation", exact: true }).dblclick();
      await waitForSideSheetClose(page);
      await page.waitForTimeout(SETTLE_MS);
      await page.reload();
      await expect(page.locator("table tbody").getByText(name, { exact: true })).toBeVisible();
      await shootList(page, info, "formulation-list");

      const created = await db.select({ id: schema.formulations.id }).from(schema.formulations).where(scope);
      expect(created).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

});
