import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outputStockMoistureReadings } from "@/db/schema";
import { createDelivery } from "@/data-access/delivery-output-writes";
import { getOutputBinStockView } from "@/data-access/output-stock";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
import { getOutputSubBins } from "@/data-access/output-sub-bins";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { cleanupPostedStock, postedStockFixture, postMeasurement, postProduct, STOCK_TIME } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });

/**
 * A split product bin with two sub-bins recorded at 20% moisture:
 * P1 holds 400 kg solids (500 kg wet), P2 (newer) 300 kg solids (375 kg wet).
 */
async function splitBin() {
  const f = await postedStockFixture({ quantityKg: 5000, stockKg: 0 });
  fixtures.push(f);
  const p1 = await postProduct(f, { massKg: 400, waterAddedKg: 100, placedAt: "2026-09-12T12:00:00.000Z" });
  const p2 = await postProduct(f, { massKg: 300, waterAddedKg: 75, placedAt: "2026-09-13T12:00:00.000Z" });
  return { ...f, p1, p2 };
}
const readingsOf = (binId: string) => db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.storageLocationId, binId));

describe("moisture readings in PostgreSQL", () => {
  it("takes a delivery's wet mass from the wet stock and keeps each sub-bin's moisture", async () => {
    const f = await splitBin();
    const sources = [{ layerId: f.p2.id, moisturePercent: 20 }, { layerId: f.p1.id, moisturePercent: 25 }];
    const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery" as const, wetMassKg: 500, sources };
    const preview = await previewOutputStock(f.ctx, input);
    // P2 is emptied at 375 kg wet; P1 gives the other 125 kg wet (93.75 kg solids at 25%) and keeps 375 kg wet at 20%.
    expect(preview.moistureEstimate).toMatchObject({ moisturePercent: 20, wetKg: 875, basis: { source: "recorded" } });
    expect(preview.beforeEstimatedWetKg).toBe(875);
    expect(preview.afterEstimatedWetKg).toBeCloseTo(375, 9);
    expect(preview.moistureReset).toBeNull();

    const delivery = await createDelivery(f.ctx, { code: `E2E-MC-D-${f.tag}`, facilityId: f.facility.id, orderId: f.order.id, storageLocationId: f.bin.id,
      deliveryDate: new Date(STOCK_TIME), deliveredWetMassKg: 500, sources, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
    expect(await readingsOf(f.bin.id)).toEqual([]);
    expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 306.25, estimatedMoisturePercent: expect.closeTo(20, 9), estimatedWetMassKg: expect.closeTo(375, 9) });

    const history = await getOutputStockHistory(f.ctx, f.bin.id);
    expect(history.some(entry => entry.kind === "moisture_update")).toBe(false);
    expect(history.find(entry => entry.deliveryId === delivery.id)!.sources).toEqual(sources);
  });

  it("resets every sub-bin present with a count's moisture", async () => {
    const f = await splitBin();
    // 700 kg wet at 10% is 630 kg solids: the 70 kg difference comes off P1 first.
    const count = await postMeasurement(f, { kind: "count", wetMassKg: 700, moisturePercent: 10 });
    expect(count.preview.beforeEstimatedWetKg).toBe(875);
    expect(count.preview.afterEstimatedWetKg).toBeCloseTo(700, 9);
    expect((await readingsOf(f.bin.id)).map(r => [r.biocharProductId, r.moisturePercent]).sort()).toEqual([[f.p1.id, 10], [f.p2.id, 10]].sort());
    expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 630, estimatedMoisturePercent: expect.closeTo(10, 9) });
  });

  it("blocks a removal the dry biochar cannot cover while wet stock still shows", async () => {
    const f = await splitBin();
    // P1 holds 500 kg wet at 20%. 400 kg wet read at 5% takes 380 kg of its 400 kg solids.
    await postMeasurement(f, { kind: "loss", wetMassKg: 400, moisturePercent: 5, sources: [{ layerId: f.p1.id, moisturePercent: 5 }] });
    const subBins = await getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME });
    expect(subBins.subBins.find(bin => bin.layerId === f.p1.id)).toMatchObject({ solidsKg: expect.closeTo(20, 9), wetEstimateKg: expect.closeTo(100, 9), moisturePercent: expect.closeTo(20, 9) });
    // 100 kg wet still shows, but 50 kg read at 5% is 47.5 kg solids and only 20 kg are left.
    const refused = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss", wetMassKg: 50,
      sources: [{ layerId: f.p1.id, moisturePercent: 5 }] });
    expect(refused.blockingMessage).not.toBeNull();
  });

  it("drops a corrected entry's wet mass and starts its correction from the stock before it", async () => {
    const f = await splitBin();
    const loss = await postMeasurement(f, { kind: "loss", wetMassKg: 100, moisturePercent: 50 });
    expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ estimatedWetMassKg: expect.closeTo(775, 9), estimatedMoisturePercent: expect.closeTo(20, 9) });
    const correction = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss" as const, wetMassKg: 60, moisturePercent: 40, correctsMovementId: loss.movementId };
    // Before the correction the bin is estimated as if the original loss never happened.
    expect((await previewOutputStock(f.ctx, correction)).moistureEstimate).toMatchObject({ moisturePercent: 20, wetKg: 875 });
    await postMeasurement(f, correction);
    expect((await getOutputBinStockView(f.ctx, f.bin.id)).estimatedWetMassKg).toBeCloseTo(815, 9);
    expect(await readingsOf(f.bin.id)).toEqual([]);
  });
});
