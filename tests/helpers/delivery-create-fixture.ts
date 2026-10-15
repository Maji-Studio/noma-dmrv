import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { recordOrder } from "@/lib/operations/orders";
import { runOperationInProcess } from "@/lib/operations/runner";
import { seedOutputStockParents } from "./output-stock-fixture";
export const TIME = "2026-09-14T12:00:00.000Z";
export async function createDeliveryFixture() {
  const f = await seedOutputStockParents(db);
  await db.update(storageLocations).set({ stockMode: "mix" }).where(eq(storageLocations.id, f.bin.id));
  const product = await createBiocharProduct(f.ctx, {
    code: `E2E-P-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id,
    placedAt: "2026-09-12T12:00:00.000Z", sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
    massKg: 1000, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
    composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: 200, moistureContentPercent: 60 }] },
  });
  const order = await runOperationInProcess(recordOrder, f.ctx, { facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: f.location.id, formulationId: f.recipe.id, orderDate: "2026-09-12", quantityKg: 100, packaging: "loose" });
  const input = { orderId: order.id, storageLocationId: f.bin.id, deliveredAt: TIME, deliveredWetMassKg: 100, moisturePercent: 20, idempotencyKey: randomUUID() };
  return { ...f, product, order, input };
}
