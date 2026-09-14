import "../../setup";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "../../../src/db/org-defaults";
import { applications, biocharProducts, customerLocations, deliveries, orders, productionRuns, storageLocations } from "../../../src/db/schema";
import { seedOutputStockParents } from "../../helpers/output-stock-fixture";
import { db } from "../../../src/db";
import { createBiocharProduct } from "../../../src/data-access/biochar-product-create";
import { createOrder } from "../../../src/data-access/orders";
import { previewOutputStock } from "../../../src/data-access/output-stock-operations";
import { createDelivery } from "../../../src/data-access/delivery-output-writes";

export const FIFO_BROWSER_DATE = "2026-09-14";
export const FIFO_MATCHING_BIN_COUNT = 24;
const FIELD_LATITUDE = -6.8;
const FIELD_LONGITUDE = 39.2;

/** Seed prerequisites through the real writers; all browser mutations use HTTP auth. */
export async function seedOutputStockBrowserFixture(userId: string, shipped = false) {
  const f = await seedOutputStockParents(db, { organizationId: DEC_ORG_ID, userId });
  const [location] = await db.insert(customerLocations).values({
    organizationId: f.ctx.organizationId, customerId: f.customer.id,
    name: `E2E FIFO field ${f.tag}`, country: "Tanzania", isDefault: true,
    gpsLatitude: FIELD_LATITUDE, gpsLongitude: FIELD_LONGITUDE,
  }).returning();
  const products = [];
  for (const [index, wet, moisture, ingredientWet, ingredientMoisture, placedAt] of [
    [0, 1000, 10, 500, 60, "2026-09-10"],
    [1, 750, 20, 250, 52, "2026-09-12"],
  ] as const) {
    const preview = await previewOutputStock(f.ctx, {
      storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: placedAt,
      kind: "production_draw", wetMassKg: wet, moisturePercent: moisture,
    });
    products.push(await createBiocharProduct(f.ctx, {
      code: `E2E-FIFO-${index}-${f.tag}`, facilityId: f.facility.id,
      formulationId: f.recipe.id, placedAt, sourceBiocharStorageLocationId: f.source.id,
      storageLocationId: f.bin.id, massKg: wet + ingredientWet,
      moistureContentPercent: moisture, waterAddedKg: 0,
      idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint,
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id,
        feedstockTypeId: f.ingredientType.id, massKg: ingredientWet,
        moistureContentPercent: ingredientMoisture, moistureSource: "operator_override" }] },
    }));
  }
  const emptyBins = await db.insert(storageLocations).values(
    Array.from({ length: FIFO_MATCHING_BIN_COUNT }, (_, index) => ({
      organizationId: f.ctx.organizationId, facilityId: f.facility.id,
      code: `E2E-FIFO-EMPTY-${String(index).padStart(2, "0")}-${f.tag}`,
      name: `E2E Empty bin ${String(index).padStart(2, "0")} ${f.tag}`,
      type: "product_bin" as const, formulationId: f.pure.id,
    })),
  ).returning();
  const order = await createOrder(f.ctx, {
    code: `E2E-FIFO-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: location.id,
    formulationId: f.recipe.id, orderDate: new Date(FIFO_BROWSER_DATE), quantityKg: 5000, packaging: "loose",
  });
  let delivery: Awaited<ReturnType<typeof createDelivery>> | undefined;
  if (shipped) {
    const preview = await previewOutputStock(f.ctx, {
      storageLocationId: f.bin.id, facilityId: f.facility.id, physicalDate: FIFO_BROWSER_DATE,
      kind: "delivery", wetMassKg: 2000, moisturePercent: 30,
    });
    delivery = await createDelivery(f.ctx, {
      code: `E2E-FIFO-D-${f.tag}`, orderId: order.id, facilityId: f.facility.id,
      deliveryDate: new Date(FIFO_BROWSER_DATE), storageLocationId: f.bin.id,
      deliveredWetMassKg: 2000, moistureContentPercent: 30,
      idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint,
    });
  }
  return { ...f, location, products, emptyBins, order, delivery };
}

export async function readOutputStockBrowserFixture(f: Awaited<ReturnType<typeof seedOutputStockBrowserFixture>>) {
  return {
    applications: await db.select({ application: applications }).from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(eq(deliveries.orderId, f.order.id)).then(rows => rows.map(row => row.application)),
    deliveries: await db.select().from(deliveries).where(eq(deliveries.orderId, f.order.id)),
    products: await db.select().from(biocharProducts).where(eq(biocharProducts.storageLocationId, f.bin.id)),
    orders: await db.select().from(orders).where(eq(orders.facilityId, f.facility.id)),
    balance: await previewOutputStock(f.ctx, {
      storageLocationId: f.bin.id, facilityId: f.facility.id, physicalDate: FIFO_BROWSER_DATE,
      kind: "count", wetMassKg: 0,
    }),
  };
}

export async function seedPureBrowserSource(f: Awaited<ReturnType<typeof seedOutputStockBrowserFixture>>) {
  await db.insert(productionRuns).values({
    organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    reactorId: f.runs[0].reactorId, code: `E2E-FIFO-PURE-R-${f.tag}`, status: "complete",
    startTime: new Date("2026-09-13T08:00:00Z"), endTime: new Date("2026-09-13T12:00:00Z"),
    biocharStorageLocationId: f.source.id, biocharOutputKg: 200,
    biocharMoisturePercent: 50, biocharDryMassKg: 100,
  });
}
