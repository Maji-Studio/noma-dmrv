import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outputStockMoistureReadings } from "@/db/schema";
import { createDelivery } from "@/data-access/delivery-output-writes";
import { getOutputBinStockView } from "@/data-access/output-stock";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
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
  it("resets only the sub-bin a delivery leaves behind and shows the change before saving", async () => {
    const f = await splitBin();
    const sources = [{ layerId: f.p2.id, moisturePercent: 20 }, { layerId: f.p1.id, moisturePercent: 25 }];
    const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery" as const, wetMassKg: 500, sources };
    const preview = await previewOutputStock(f.ctx, input);
    // P2 is emptied at 375 kg wet; P1 gives 93.75 kg solids and keeps 306.25 kg.
    expect(preview.moistureEstimate).toMatchObject({ moisturePercent: 20, wetKg: 875, basis: { source: "recorded" } });
    expect(preview.beforeEstimatedWetKg).toBe(875);
    expect(preview.afterEstimatedWetKg).toBeCloseTo(306.25 / 0.75, 9);
    expect(preview.moistureReset).toEqual({ layerCodes: [f.p1.code], before: { moisturePercent: 20, wetKg: 306.25 / 0.8 }, after: { moisturePercent: 25, wetKg: expect.closeTo(306.25 / 0.75, 9) } });

    const delivery = await createDelivery(f.ctx, { code: `E2E-MC-D-${f.tag}`, facilityId: f.facility.id, orderId: f.order.id, storageLocationId: f.bin.id,
      deliveryDate: new Date(STOCK_TIME), deliveredWetMassKg: 500, sources, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
    const readings = await readingsOf(f.bin.id);
    expect(readings.map(r => [r.biocharProductId, r.moisturePercent])).toEqual([[f.p1.id, 25]]);
    expect(readings[0].solidsBasisKg).toEqual({ numerator: "1225", denominator: "4" });
    // Dry biochar is untouched by the reading; only the wet estimate moved.
    expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 306.25, estimatedMoisturePercent: 25, estimatedWetMassKg: expect.closeTo(306.25 / 0.75, 9) });

    const history = await getOutputStockHistory(f.ctx, f.bin.id);
    const movement = history.find(entry => entry.deliveryId === delivery.id)!;
    const update = history[history.indexOf(movement) + 1];
    expect(update).toMatchObject({ kind: "moisture_update", measuredByMovementId: movement.id, moistureReset: preview.moistureReset, dryMassKg: 0 });
    expect(movement.sources).toEqual(sources);
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

  it("drops a corrected entry's reading and starts its correction from the stock before it", async () => {
    const f = await splitBin();
    // 100 kg wet at 50% loses 50 kg solids from P1, which the reading resets to 50%.
    const loss = await postMeasurement(f, { kind: "loss", wetMassKg: 100, moisturePercent: 50 });
    expect((await getOutputBinStockView(f.ctx, f.bin.id)).estimatedWetMassKg).toBeCloseTo(350 / 0.5 + 375, 9);
    const correction = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss" as const, wetMassKg: 100, moisturePercent: 40, correctsMovementId: loss.movementId };
    // Before the correction the bin is estimated as if the original loss never happened.
    expect((await previewOutputStock(f.ctx, correction)).moistureEstimate).toMatchObject({ moisturePercent: 20, wetKg: 875 });
    await postMeasurement(f, correction);
    expect((await getOutputBinStockView(f.ctx, f.bin.id)).estimatedWetMassKg).toBeCloseTo(340 / 0.6 + 375, 9);
    const history = await getOutputStockHistory(f.ctx, f.bin.id);
    expect(history.filter(entry => entry.kind === "moisture_update").map(entry => entry.moistureReset?.after.moisturePercent)).toEqual([50, 40]);
  });
});
