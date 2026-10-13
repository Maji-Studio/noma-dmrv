/**
 * The stock reads hold one snapshot transaction for their whole run. At the
 * production pool size of one connection, any query that escaped to the
 * global pool would wait on the connection the transaction holds until the
 * acquisition timeout. Both reads must finish on that one connection.
 */
import type { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { readApiOutputBinStock } from "@/data-access/api-output-bin-stock";
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
    const count = await postMeasurement(f, { kind: "count", wetMassKg: 800, moisturePercent: 10 });
    const product = await readApiOutputBinStock(f.ctx, { identifier: { code: f.bin.code }, facilityId: f.facility.id });
    expect(product).toMatchObject({ status: "resolved", subBins: [{}, {}] });
    expect((await readApiOutputBinStock(f.ctx, { identifier: { id: f.source.id } })).status).toBe("resolved");
    const picker = await getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: new Date().toISOString() });
    expect(picker.subBins).toHaveLength(2);
    expect(picker.subBins[0].recentMovements.length).toBeGreaterThan(0);
    // A correction preview reads the corrected entry through the same connection.
    const correcting = await getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: new Date().toISOString(),
      correctsMovementId: count.movementId, kind: "count" });
    expect(correcting.subBins).toHaveLength(2);
  });
});
