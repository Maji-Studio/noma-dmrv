import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, deliveries, outputStockAllocations, storageLocations } from "@/db/schema";
import { createDelivery } from "@/data-access/delivery-output-writes";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { SafeError } from "@/lib/errors";
import { cleanupPostedStock, postedStockFixture, postMeasurement, postProduct, STOCK_TIME } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });

/** A split product bin with two pure sub-bins: P1 holds 400 kg dry, P2 (newer) holds 300 kg. */
async function splitBin() {
  const f = await postedStockFixture({ quantityKg: 5000, stockKg: 0 });
  fixtures.push(f);
  const p1 = await postProduct(f, { massKg: 400, placedAt: "2026-09-12T12:00:00.000Z" });
  const p2 = await postProduct(f, { massKg: 300, placedAt: "2026-09-13T12:00:00.000Z" });
  return { ...f, p1, p2 };
}
const allocationsOf = (movementId: string) => db.select().from(outputStockAllocations)
  .where(eq(outputStockAllocations.movementId, movementId)).orderBy(outputStockAllocations.createdAt);

describe("split bin draws in PostgreSQL", () => {
  it("saves one allocation per sub-bin with its own reading, in the operator's order", async () => {
    const f = await splitBin();
    // P2 first: 300 / 0.80 = 375 kg wet empties it; the other 125 kg wet at 25% takes 93.75 kg from P1.
    const sources = [{ layerId: f.p2.id, moisturePercent: 20 }, { layerId: f.p1.id, moisturePercent: 25 }];
    const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery", wetMassKg: 500, sources });
    expect(preview.blockingMessage).toBeNull();
    expect(preview.removedDryKg).toBe(393.75);
    const delivery = await createDelivery(f.ctx, { code: `E2E-SPLIT-D-${f.tag}`, facilityId: f.facility.id, orderId: f.order.id, storageLocationId: f.bin.id,
      deliveryDate: new Date(STOCK_TIME), deliveredWetMassKg: 500, sources, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
    const [saved] = await db.select().from(deliveries).where(eq(deliveries.id, delivery.id));
    // Overall moisture is 1 − solids ÷ wet = 1 − 393.75 ÷ 500.
    expect(saved).toMatchObject({ massDryKg: 393.75, moistureContentPercent: 21.25 });
    const rows = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    const byLayer = new Map(rows.map(row => [row.biocharProductId, row]));
    expect(byLayer.get(f.p2.id)).toMatchObject({ dryMassKg: "300.000", wetMassKg: "375.000" });
    expect(byLayer.get(f.p1.id)).toMatchObject({ dryMassKg: "93.750", wetMassKg: "125.000" });
    for (const [id, reading] of [[f.p2.id, "20"], [f.p1.id, "25"]] as const) {
      expect(byLayer.get(id)?.basisSnapshot).toMatchObject({ policy: "operator_order", order: [f.p2.id, f.p1.id], readingPercent: reading });
    }
  });

  it("asks to untick a sub-bin the load never reaches and blocks an overdraw", async () => {
    const f = await splitBin();
    const base = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery" as const };
    const untick = await previewOutputStock(f.ctx, { ...base, wetMassKg: 300, sources: [{ layerId: f.p2.id, moisturePercent: 20 }, { layerId: f.p1.id, moisturePercent: 25 }] });
    expect(untick.blockingMessage).toBe(`This load is used up before it reaches ${f.p1.code}. Untick ${f.p1.code}.`);
    const overdraw = await previewOutputStock(f.ctx, { ...base, wetMassKg: 500, sources: [{ layerId: f.p1.id, moisturePercent: 0 }] });
    expect(overdraw.blockingMessage).toBe(`This load holds more dry biochar than ${f.p1.code} holds by the records. Record a count first.`);
  });

  it("replays the saved order and readings when a split-bin loss is corrected", async () => {
    const f = await splitBin();
    const original = await postMeasurement(f, { kind: "loss", wetMassKg: 100, sources: [{ layerId: f.p2.id, moisturePercent: 50 }] });
    expect((await allocationsOf(original.movementId)).map(a => [a.biocharProductId, a.dryMassKg])).toEqual([[f.p2.id, "50.000"]]);
    // The replacement names another sub-bin and reading; the saved P2 at 50% wins.
    const replacement = await postMeasurement(f, { kind: "loss", wetMassKg: 200, correctsMovementId: original.movementId,
      sources: [{ layerId: f.p1.id, moisturePercent: 0 }] });
    const rows = await allocationsOf(replacement.movementId);
    expect(rows.map(a => [a.biocharProductId, a.dryMassKg, a.basisSnapshot.readingPercent])).toEqual([[f.p2.id, "100.000", "50"]]);
    const [movement] = await db.select().from(binMovements).where(eq(binMovements.id, replacement.movementId));
    expect(movement.inputSnapshot?.sources).toEqual([{ layerId: f.p2.id, moisturePercent: 50 }]);
  });

  it("records oldest-first draws as FIFO with their one reading", async () => {
    const f = await splitBin();
    const loss = await postMeasurement(f, { kind: "loss", wetMassKg: 10, moisturePercent: 10 });
    expect((await allocationsOf(loss.movementId)).map(a => [a.biocharProductId, a.basisSnapshot.policy, a.basisSnapshot.readingPercent])).toEqual([[f.p1.id, "fifo", "10"]]);
  });

  it("refuses a sub-bin order on a mix bin", async () => {
    const f = await splitBin();
    await db.update(storageLocations).set({ stockMode: "mix" }).where(and(eq(storageLocations.id, f.bin.id), eq(storageLocations.organizationId, f.ctx.organizationId)));
    await expect(previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss", wetMassKg: 10,
      sources: [{ layerId: f.p1.id, moisturePercent: 10 }] })).rejects.toThrow(SafeError);
  });
});
