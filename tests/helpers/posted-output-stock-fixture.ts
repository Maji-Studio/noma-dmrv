import { withProductStockFingerprint } from "./product-stock-preview-fixture";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks, storageLocations } from "@/db/schema";
import { createBiocharProduct, type CreateBiocharProductInput } from "@/data-access/biochar-product-create";
import { createDelivery } from "@/data-access/delivery-output-writes";
import { createOrder } from "@/data-access/orders";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { postOutputStock } from "@/data-access/output-stock-post";
import type { OutputStockPreviewInput } from "@/types/output-stock";
import { seedOutputStockParents } from "./output-stock-fixture";
import { cleanupOutputStockFixture } from "./output-stock-cleanup";

export type PostedStockParents = Awaited<ReturnType<typeof seedOutputStockParents>>;
export const STOCK_DATE = "2026-09-14";

/** Stock tests post through the real writer; only upstream production facts are seeded. */
export async function postedStockFixture(options: { quantityKg?: number; stockKg?: number } = {}) {
  const f = await seedOutputStockParents(db);
  await db.update(storageLocations).set({ formulationId: f.pure.id }).where(eq(storageLocations.id, f.bin.id));
  const product = options.stockKg === 0 ? null : await postProduct(f, { massKg: options.stockKg ?? 1000 });
  const order = await createOrder(f.ctx, { code: `E2E-STOCK-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id,
    formulationId: f.pure.id, orderDate: new Date(STOCK_DATE), quantityKg: options.quantityKg ?? 1000, packaging: "loose" });
  return { ...f, product, order };
}

export async function productInput(f: PostedStockParents, changes: Partial<CreateBiocharProductInput> = {}): Promise<CreateBiocharProductInput> {
  const data = { code: `E2E-STOCK-P-${randomUUID().toUpperCase()}`, facilityId: f.facility.id, formulationId: f.pure.id,
    placedAt: "2026-09-12", sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
    massKg: 100, moistureContentPercent: 0, waterAddedKg: 0, ...changes };
  return withProductStockFingerprint(f.ctx, { ...data, idempotencyKey: changes.idempotencyKey ?? randomUUID() });
}
export async function postProduct(f: PostedStockParents, changes: Partial<CreateBiocharProductInput> = {}) {
  return createBiocharProduct(f.ctx, await productInput(f, changes));
}
export async function deliveryInput(f: Awaited<ReturnType<typeof postedStockFixture>>, wetMassKg: number, moisturePercent = 0) {
  const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, physicalDate: STOCK_DATE, kind: "delivery", wetMassKg, moisturePercent });
  return { code: `E2E-STOCK-D-${randomUUID().toUpperCase()}`, facilityId: f.facility.id, orderId: f.order.id, storageLocationId: f.bin.id,
    deliveryDate: new Date(STOCK_DATE), deliveredWetMassKg: wetMassKg, moistureContentPercent: moisturePercent, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint };
}
export async function postDelivery(f: Awaited<ReturnType<typeof postedStockFixture>>, wetMassKg: number, moisturePercent = 0) {
  return createDelivery(f.ctx, await deliveryInput(f, wetMassKg, moisturePercent));
}
export async function postMeasurement(f: PostedStockParents, changes: Partial<OutputStockPreviewInput> & Pick<OutputStockPreviewInput, "kind" | "wetMassKg">) {
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, physicalDate: STOCK_DATE, moisturePercent: 0, ...changes };
  const preview = await previewOutputStock(f.ctx, input);
  return postOutputStock(f.ctx, { ...input, basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: "E2E stock contract measurement" });
}
export async function cleanupPostedStock(f: PostedStockParents) {
  await db.delete(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  await cleanupOutputStockFixture(db, f.ctx.organizationId);
}
