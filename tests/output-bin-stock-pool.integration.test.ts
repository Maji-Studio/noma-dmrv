/**
 * The stock reads hold one snapshot transaction for their whole run. At the
 * production pool size of one connection, any query that escaped to the
 * global pool would wait on the connection the transaction holds until the
 * acquisition timeout. Both reads must finish on that one connection.
 */
import type { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { findApiOutputBinStock } from "@/data-access/api-output-bin-stock";
import { getOutputSubBins } from "@/data-access/output-sub-bins";
import { cleanupPostedStock, postedStockFixture, postMeasurement, postProduct } from "./helpers/posted-output-stock-fixture";

// Read by `src/db/index.ts` when it builds the pool, so they must be set before it is imported.
const poolEnv = vi.hoisted(() => {
  const original = { max: process.env.DB_POOL_MAX, timeout: process.env.DB_POOL_CONNECTION_TIMEOUT_MS };
  process.env.DB_POOL_MAX = "1";
  // An escaped query fails fast instead of waiting the default ten seconds.
  process.env.DB_POOL_CONNECTION_TIMEOUT_MS = "2000";
  return original;
});
const TIMEOUT_MS = 30_000;

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });
afterAll(() => {
  if (poolEnv.max === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = poolEnv.max;
  if (poolEnv.timeout === undefined) delete process.env.DB_POOL_CONNECTION_TIMEOUT_MS;
  else process.env.DB_POOL_CONNECTION_TIMEOUT_MS = poolEnv.timeout;
});

describe("output bin stock reads on a pool of one connection", { timeout: TIMEOUT_MS }, () => {
  it("runs on a single pooled connection", () => {
    expect((db.$client as Pool).options.max).toBe(1);
  });

  it("reads a product bin with readings, and a biochar bin, through the API read and the picker", async () => {
    const f = await postedStockFixture({ stockKg: 0 });
    fixtures.push(f);
    await postProduct(f, { massKg: 400, placedAt: "2026-09-12T12:00:00.000Z" });
    await postProduct(f, { massKg: 300, placedAt: "2026-09-13T12:00:00.000Z" });
    const subBinsNow = () => getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id });
    /** What a sub-bin holds and its moisture, without its movements. */
    const stockOf = (subBins: Awaited<ReturnType<typeof subBinsNow>>) => subBins.subBins.map(subBin => ({ layerId: subBin.layerId, dryMassKg: subBin.dryMassKg, solidsKg: subBin.solidsKg,
      wetEstimateKg: subBin.wetEstimateKg, moisturePercent: subBin.moisturePercent, basis: subBin.basis }));
    const beforeCount = stockOf(await subBinsNow());
    expect(beforeCount.map(subBin => [subBin.dryMassKg, subBin.moisturePercent, subBin.basis?.source])).toEqual([[400, 0, "recorded"], [300, 0, "recorded"]]);
    // 700 kg wet at 10% is 630 kg solids: the count takes 70 kg and sets every sub-bin to 10%.
    const count = await postMeasurement(f, { kind: "count", wetMassKg: 700, moisturePercent: 10 });
    const product = await findApiOutputBinStock(f.ctx, { identifier: { code: f.bin.code }, facilityId: f.facility.id });
    expect(product).toMatchObject({ status: "resolved", subBins: [{}, {}] });
    expect((await findApiOutputBinStock(f.ctx, { identifier: { id: f.source.id } })).status).toBe("resolved");
    const picker = await subBinsNow();
    expect(picker.subBins[0].recentMovements.length).toBeGreaterThan(0);
    const counted = stockOf(picker);
    expect(counted.reduce((sum, subBin) => sum + subBin.dryMassKg, 0)).toBeCloseTo(630, 9);
    expect(counted.map(subBin => [subBin.moisturePercent, subBin.basis?.source])).toEqual([[10, "reading"], [10, "reading"]]);
    // A correction of the count reads the sub-bins as they were before it: its draw restored, its readings dropped.
    const correcting = await getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: new Date().toISOString(),
      correctsMovementId: count.movementId, kind: "count" });
    expect(stockOf(correcting)).toEqual(beforeCount);
  });
});
