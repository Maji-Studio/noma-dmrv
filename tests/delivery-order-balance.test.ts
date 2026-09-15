import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, outputStockAllocations, orders } from "@/db/schema";
import { createDelivery, updateDelivery, deleteDelivery } from "@/data-access/deliveries";
import { createApplication } from "@/data-access/applications";
import { createOrder, updateOrder } from "@/data-access/orders";
import { getOrderEntityById } from "@/data-access/entities/orders";
import { getStockAvailability } from "@/data-access/stock-availability";
import { getOutputBinDryBalance } from "@/data-access/output-stock";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
import { createDeliverySchema } from "@/schemas/deliveries";
import { postedStockFixture, postDelivery, deliveryInput, postMeasurement, cleanupPostedStock, STOCK_DATE } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
async function fixture(quantityKg = 100, stockKg = 1000) {
  const f = await postedStockFixture({ quantityKg, stockKg }); fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });

async function correction(f: Awaited<ReturnType<typeof fixture>>, deliveryId: string, wetMassKg: number, moisturePercent = 0) {
  const [allocation] = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, deliveryId));
  return postMeasurement(f, { kind: "delivery", wetMassKg, moisturePercent, correctsMovementId: allocation.movementId });
}

describe("completed delivery order balance", () => {
  it("rejects a delivery without positive measured wet mass", async () => {
    const f = await fixture();
    const input = await deliveryInput(f, 1);
    expect(createDeliverySchema.safeParse({ ...input, deliveredWetMassKg: null }).success).toBe(false);
    await expect(createDelivery(f.ctx, { ...input, deliveredWetMassKg: 0 })).rejects.toThrow();
    expect(await db.select().from(deliveries).where(eq(deliveries.orderId, f.order.id))).toHaveLength(0);
  });
  it("accepts completed deliveries only, with no upcoming reservation state", async () => {
    const f = await fixture(); const input = await deliveryInput(f, 50);
    expect(createDeliverySchema.safeParse({ ...input, status: "upcoming" }).success).toBe(false);
    expect((await createDelivery(f.ctx, input)).status).toBe("delivered");
  });
  it("uses measured shipment moisture to remove dry solids", async () => {
    const f = await fixture(1000); const delivery = await postDelivery(f, 1000, 40);
    expect(delivery.massDryKg).toBe(600);
    await expect(updateDelivery(f.ctx, delivery.id, { moistureContentPercent: 5 })).rejects.toThrow("Correct entry");
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(400);
  });
  it("closes the exact dry remainder across partial measured deliveries", async () => {
    const f = await fixture(2000);
    const first = await postDelivery(f, 333.333, 0);
    const last = await postDelivery(f, 1333.334, 50);
    expect(first.massDryKg).toBe(333.333); expect(last.massDryKg).toBe(666.667);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(0);
  });
  it("allows a wetter later truck without changing recorded product creation mass", async () => {
    const f = await fixture(2000); await postDelivery(f, 500);
    const wetter = await postDelivery(f, 1000, 50);
    expect(wetter.massDryKg).toBe(500); expect(f.product?.massKg).toBe(1000);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(0);
  });
  it("reports only commercial wet order remainder without guessing dry provenance", async () => {
    const f = await fixture(1000); await postDelivery(f, 250);
    await expect(getOrderEntityById(f.ctx, f.order.id)).resolves.toMatchObject({ remainingMass: { wetKg: 750, dryKg: null } });
  });
  it("keeps an unchanged metadata save from rewriting posted allocation history", async () => {
    const f = await fixture(); const delivery = await postDelivery(f, 50);
    const before = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    await updateDelivery(f.ctx, delivery.id, { code: `E2E-RENAMED-${f.tag}`, deliveredWetMassKg: 50 });
    expect(await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id))).toEqual(before);
  });
  it("blocks explicit stock correction after a downstream application exists", async () => {
    const f = await fixture(); const delivery = await postDelivery(f, 50);
    await createApplication(f.ctx, { code: `E2E-AP-${f.tag}`, deliveryId: delivery.id, applicationDate: new Date(STOCK_DATE), biocharAppliedTons: 0.025, fieldSizeHa: 1, evidenceMethod: "location" });
    await expect(correction(f, delivery.id, 40)).rejects.toThrow(/application/i);
    await expect(updateDelivery(f.ctx, delivery.id, { deliveredWetMassKg: 40 })).rejects.toThrow("Correct entry");
  });
  it("allows competing orders without reserving or over-allocating physical stock", async () => {
    const f = await fixture(800);
    const other = await createOrder(f.ctx, { code: `E2E-OTHER-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id, formulationId: f.pure.id, orderDate: new Date(STOCK_DATE), quantityKg: 800, packaging: "loose" });
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(1000);
    await postDelivery(f, 800);
    await expect(postDelivery({ ...f, order: other }, 300)).rejects.toThrow(/Insufficient/);
  });
  it("locks the order formulation once a completed delivery uses it", async () => {
    const f = await fixture(); const delivery = await postDelivery(f, 50);
    await expect(updateOrder(f.ctx, f.order.id, { formulationId: f.recipe.id })).rejects.toThrow(delivery.code);
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].formulationId).toBe(f.pure.id);
  });
  it("counts completed trucks toward the remaining commercial order quantity", async () => {
    const f = await fixture(); await postDelivery(f, 60);
    await expect(postDelivery(f, 50)).rejects.toThrow("Only 40 kg remains on this order");
  });
  it("re-credits the original truck only through explicit correction", async () => {
    const f = await fixture(); await postDelivery(f, 20); const current = await postDelivery(f, 60);
    await expect(correction(f, current.id, 81)).rejects.toThrow("80 kg");
    await correction(f, current.id, 80);
    expect((await db.select().from(deliveries).where(eq(deliveries.id, current.id)))[0].deliveredWetMassKg).toBe(80);
    expect((await getOutputStockHistory(f.ctx, f.bin.id)).some(entry => entry.kind === "reversal")).toBe(true);
  });
  it("blocks correcting an earlier truck after a later movement used its source layer", async () => {
    const f = await fixture(); const first = await postDelivery(f, 60); const later = await postDelivery(f, 20);
    await expect(correction(f, first.id, 50)).rejects.toThrow(later.code);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(920);
  });
  it("reports live order availability for another completed truck", async () => {
    const f = await fixture(); const current = await postDelivery(f, 60); await postDelivery(f, 20);
    await expect(getStockAvailability(f.ctx, { kind: "delivery", orderId: f.order.id })).resolves.toMatchObject({ orderAvailableKg: 20 });
    await expect(getStockAvailability(f.ctx, { kind: "delivery", orderId: f.order.id, deliveryId: current.id })).resolves.toMatchObject({ orderAvailableKg: 80 });
  });
  it("serializes concurrent completed trucks against the same order", async () => {
    const f = await fixture(); const inputs = await Promise.all([deliveryInput(f, 60), deliveryInput(f, 60)]);
    const results = await Promise.allSettled(inputs.map(input => createDelivery(f.ctx, input)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(940);
  });
  it("serializes an order shrink against a concurrent completed truck", async () => {
    const f = await fixture(); const input = await deliveryInput(f, 60);
    const results = await Promise.allSettled([updateOrder(f.ctx, f.order.id, { quantityKg: 50 }), createDelivery(f.ctx, input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });
  it("rejects an order shrink below completed delivery mass", async () => {
    const f = await fixture(); await postDelivery(f, 60);
    await expect(updateOrder(f.ctx, f.order.id, { quantityKg: 59 })).rejects.toThrow("60 kg");
    await expect(updateOrder(f.ctx, f.order.id, { quantityKg: 60 })).resolves.toMatchObject({ quantityKg: 60 });
  });
  it("rounds the actionable commercial minimum upward for fractional mass", async () => {
    const f = await fixture(); await postDelivery(f, 60.05);
    await expect(updateOrder(f.ctx, f.order.id, { quantityKg: 60 })).rejects.toThrow("60.1 kg");
  });
  it("accepts unchanged stock fields on metadata edits but retains history on delete", async () => {
    const f = await fixture(); const delivery = await postDelivery(f, 60);
    await expect(updateDelivery(f.ctx, delivery.id, { code: `E2E-D-${randomUUID().toUpperCase()}`, orderId: f.order.id, facilityId: f.facility.id,
      storageLocationId: f.bin.id, deliveryDate: new Date(STOCK_DATE), deliveredWetMassKg: 60, moistureContentPercent: 0 })).resolves.toMatchObject({ massDryKg: 60 });
    await expect(updateOrder(f.ctx, f.order.id, { quantityKg: 100, formulationId: f.pure.id })).resolves.toMatchObject({ quantityKg: 100 });
    await expect(deleteDelivery(f.ctx, delivery.id)).rejects.toThrow("history");
  });
});
