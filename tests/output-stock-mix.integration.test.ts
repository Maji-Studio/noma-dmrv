import { masterDataVersion } from "./helpers/master-data-version";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, outputStockAllocations, outputStockMoistureReadings, storageLocations } from "@/db/schema";
import { createApplication } from "@/data-access/applications";
import { createDelivery } from "@/data-access/delivery-output-writes";
import { getMixBinHeldApplicationIds } from "@/data-access/mix-bin-credit-hold";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { getOutputSubBins } from "@/data-access/output-sub-bins";
import { updateStorageLocation } from "@/data-access/storage-locations";
import { SafeError } from "@/lib/errors";
import { cleanupPostedStock, postedStockFixture, postMeasurement, postProduct, STOCK_DATE, STOCK_TIME } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });

/** A product bin with two pure batches: P1 holds 400 kg dry, P2 (newer) holds 300 kg. */
async function twoBatches() {
  const f = await postedStockFixture({ quantityKg: 5000, stockKg: 0 });
  fixtures.push(f);
  const p1 = await postProduct(f, { massKg: 400, placedAt: "2026-09-12T12:00:00.000Z" });
  const p2 = await postProduct(f, { massKg: 300, placedAt: "2026-09-13T12:00:00.000Z" });
  return { ...f, p1, p2 };
}
type Fixture = Awaited<ReturnType<typeof twoBatches>>;
const setMode = async (f: Fixture, stockMode: "split" | "mix", mergedAt?: Date) =>
  updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: await masterDataVersion(f.ctx, "storageLocations", f.bin.id), stockMode, mergedAt });
const allocationsOf = async (movementId: string) => (await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.movementId, movementId)))
  .map(a => ({ layer: a.biocharProductId, dry: a.dryMassKg, policy: a.basisSnapshot.policy, reading: a.basisSnapshot.readingPercent }));
async function mixDelivery(f: Fixture, wetMassKg: number, moisturePercent: number) {
  const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery", wetMassKg, moisturePercent });
  expect(preview.blockingMessage).toBeNull();
  return createDelivery(f.ctx, { code: `E2E-MIX-D-${randomUUID().toUpperCase()}`, facilityId: f.facility.id, orderId: f.order.id, storageLocationId: f.bin.id,
    deliveryDate: new Date(STOCK_TIME), deliveredWetMassKg: wetMassKg, moistureContentPercent: moisturePercent, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
}

describe("mix bin draws in PostgreSQL", () => {
  it("draws every batch pro-rata, saves the policy, and keeps the pile's moisture", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-12T00:00:00.000Z"));
    const pile = () => previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss", wetMassKg: 1, moisturePercent: 0 });
    const before = (await pile()).moistureEstimate!;
    // 350 kg wet at 20% is 280 kg solids: 4/7 from P1 and 3/7 from P2.
    const delivery = await mixDelivery(f, 350, 20);
    expect(delivery.massDryKg).toBe(280);
    const rows = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    expect(rows.map(r => [r.biocharProductId, r.dryMassKg, r.basisSnapshot.policy, r.basisSnapshot.readingPercent]).sort())
      .toEqual([[f.p1.id, "160.000", "pro_rata", "20"], [f.p2.id, "120.000", "pro_rata", "20"]].sort());
    expect(await db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.movementId, rows[0].movementId))).toEqual([]);
    const after = (await pile()).moistureEstimate!;
    expect(after.wetKg).toBeCloseTo(before.wetKg! - 350, 6);
    expect(after.moisturePercent).toBeCloseTo(before.moisturePercent!, 9);
  });

  it("plans an entry timed before the merge as split and one after it as pro-rata", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-14T00:00:00.000Z"));
    const before = await postMeasurement(f, { kind: "loss", wetMassKg: 10, moisturePercent: 0, occurredAt: "2026-09-13T18:00:00.000Z" });
    expect(await allocationsOf(before.movementId)).toEqual([{ layer: f.p1.id, dry: "10.000", policy: "fifo", reading: "0" }]);
    const after = await postMeasurement(f, { kind: "loss", wetMassKg: 69, moisturePercent: 0 });
    expect((await allocationsOf(after.movementId)).map(a => [a.layer, a.dry, a.policy]).sort()).toEqual([[f.p1.id, "39.000", "pro_rata"], [f.p2.id, "30.000", "pro_rata"]].sort());
    // The sub-bin picker follows the same timeline.
    const at = (occurredAt: string) => getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt });
    expect((await at("2026-09-13T18:00:00.000Z")).stockMode).toBe("split");
    expect((await at(STOCK_TIME)).stockMode).toBe("mix");
    await expect(previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss", wetMassKg: 1,
      sources: [{ layerId: f.p1.id, moisturePercent: 0 }] })).rejects.toThrow(SafeError);
    const merge = (await getOutputStockHistory(f.ctx, f.bin.id)).find(entry => entry.kind === "merge");
    expect(merge).toMatchObject({ occurredAt: "2026-09-14T00:00:00.000Z", beforeDryKg: 700, afterDryKg: 700, allocations: [] });
  });

  it("switches a mix bin back to split only once it is empty", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-14T00:00:00.000Z"));
    await expect(setMode(f, "split")).rejects.toThrow("Empty this bin before switching it to split.");
    await postMeasurement(f, { kind: "count", wetMassKg: 0, moisturePercent: null });
    const saved = await setMode(f, "split");
    expect(saved.stockMode).toBe("split");
    const history = await getOutputStockHistory(f.ctx, f.bin.id);
    expect(history.filter(entry => entry.kind === "merge" || entry.kind === "split").map(entry => entry.kind).sort()).toEqual(["merge", "split"]);
  });

  it("plans a mix-era entry pro-rata after the switch back to split, and refuses to restore it across the switch", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-12T00:00:00.000Z"));
    // A 700 kg delivery at 0% empties the pile, so the bin may switch back to split.
    const delivery = await mixDelivery(f, 700, 0);
    await setMode(f, "split");
    const [original] = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery", wetMassKg: 350, moisturePercent: 0, correctsMovementId: original.movementId });
    expect(preview.blockingMessage).toMatch(/^Correction blocked by the switch to split at /);
    const app = await createApplication(f.ctx, { code: `E2E-MIX-AP-C-${f.tag}`, deliveryId: delivery.id, applicationDate: new Date(STOCK_DATE), biocharAppliedTons: 0.1, fieldSizeHa: 1, evidenceMethod: "location" });
    expect(await getMixBinHeldApplicationIds(f.ctx, db, [app.id])).toEqual(new Set([app.id]));
  });

  it("refuses a merge timed at or before the bin's last recorded movement", async () => {
    const f = await twoBatches();
    await postMeasurement(f, { kind: "loss", wetMassKg: 10, moisturePercent: 0 });
    await expect(setMode(f, "mix", new Date("2026-09-14T06:00:00.000Z"))).rejects.toThrow("Set Merged at later than the bin's last recorded movement");
    await expect(setMode(f, "mix", new Date(STOCK_TIME))).rejects.toThrow("Set Merged at later than");
    expect((await setMode(f, "mix", new Date("2026-09-14T12:00:01.000Z"))).stockMode).toBe("mix");
  });

  it("refuses an addition timed before a later switch to split", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-14T00:00:00.000Z"));
    await postMeasurement(f, { kind: "count", wetMassKg: 0, moisturePercent: null });
    await setMode(f, "split");
    await expect(postProduct(f, { massKg: 10, placedAt: "2026-09-14T13:00:00.000Z" })).rejects.toThrow(/^This bin was switched to split at /);
    expect((await postProduct(f, { massKg: 10, placedAt: new Date().toISOString() })).id).toBeTruthy();
  });

  it("refuses to switch to split while a movement is recorded for later than now", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-12T00:00:00.000Z"));
    await postMeasurement(f, { kind: "count", wetMassKg: 0, moisturePercent: null, occurredAt: new Date(Date.now() + 86_400_000).toISOString() });
    await expect(setMode(f, "split")).rejects.toThrow(/^This bin has a movement recorded for .*Switch it to split after that time\.$/);
  });

  it("changes a never-stocked bin's mode without leaving a movement", async () => {
    const f = await postedStockFixture({ stockKg: 0 });
    fixtures.push(f);
    expect((await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: await masterDataVersion(f.ctx, "storageLocations", f.bin.id), stockMode: "mix", mergedAt: new Date() })).stockMode).toBe("mix");
    expect(await db.select().from(binMovements).where(eq(binMovements.storageLocationId, f.bin.id))).toEqual([]);
  });

  it("refuses a merge in the future", async () => {
    const f = await twoBatches();
    await expect(setMode(f, "mix", new Date(Date.now() + 60_000))).rejects.toThrow("Merged at cannot be in the future.");
    const [bin] = await db.select().from(storageLocations).where(and(eq(storageLocations.id, f.bin.id), eq(storageLocations.organizationId, f.ctx.organizationId)));
    expect(bin.stockMode).toBe("split");
    expect(await db.select().from(binMovements).where(and(eq(binMovements.storageLocationId, f.bin.id), eq(binMovements.outputKind, "merge")))).toEqual([]);
  });

  it("names the saved removals a backdated entry was not part of", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-12T00:00:00.000Z"));
    const loss = await postMeasurement(f, { kind: "loss", wetMassKg: 10, moisturePercent: 0 });
    const backdated = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: "2026-09-14T06:00:00.000Z", kind: "loss", wetMassKg: 5, moisturePercent: 0 });
    expect(backdated.calculatedWithout).toEqual([{ id: loss.movementId, occurredAt: STOCK_TIME, label: expect.stringMatching(/^Stock loss \(Sep 14, 2026, /) }]);
    const later = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: "2026-09-14T18:00:00.000Z", kind: "loss", wetMassKg: 5, moisturePercent: 0 });
    expect(later.calculatedWithout).toEqual([]);
  });

  it("warns an entry timed while the bin was split that a later mix removal drew without it", async () => {
    const f = await twoBatches();
    await setMode(f, "mix", new Date("2026-09-14T00:00:00.000Z"));
    const loss = await postMeasurement(f, { kind: "loss", wetMassKg: 10, moisturePercent: 0 });
    const early = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: "2026-09-13T18:00:00.000Z", kind: "loss", wetMassKg: 5, moisturePercent: 0 });
    expect(early.stockMode).toBe("split");
    expect(early.calculatedWithout?.map(e => e.id)).toEqual([loss.movementId]);
  });
});

describe("mix bin credit hold", () => {
  it("holds out an application drawn from a mix bin, and not one from a split bin", async () => {
    const split = await twoBatches();
    const splitDelivery = await mixDelivery(split, 100, 0);
    const splitApp = await createApplication(split.ctx, { code: `E2E-MIX-AP-S-${split.tag}`, deliveryId: splitDelivery.id, applicationDate: new Date(STOCK_DATE), biocharAppliedTons: 0.1, fieldSizeHa: 1, evidenceMethod: "location" });
    expect(await getMixBinHeldApplicationIds(split.ctx, db, [splitApp.id])).toEqual(new Set());

    const mix = await twoBatches();
    await setMode(mix, "mix", new Date("2026-09-12T00:00:00.000Z"));
    const mixed = await mixDelivery(mix, 100, 0);
    const mixApp = await createApplication(mix.ctx, { code: `E2E-MIX-AP-M-${mix.tag}`, deliveryId: mixed.id, applicationDate: new Date(STOCK_DATE), biocharAppliedTons: 0.1, fieldSizeHa: 1, evidenceMethod: "location" });
    expect(await getMixBinHeldApplicationIds(mix.ctx, db, [mixApp.id])).toEqual(new Set([mixApp.id]));
  });

  it("holds out an application whose product was made from a mix biochar bin", async () => {
    const f = await postedStockFixture({ quantityKg: 5000, stockKg: 0 });
    fixtures.push(f);
    await db.update(storageLocations).set({ stockMode: "mix" }).where(and(eq(storageLocations.id, f.source.id), eq(storageLocations.organizationId, f.ctx.organizationId)));
    await postProduct(f, { massKg: 400, placedAt: "2026-09-12T12:00:00.000Z" });
    const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "delivery", wetMassKg: 100, moisturePercent: 0 });
    const delivery = await createDelivery(f.ctx, { code: `E2E-MIX-D-${f.tag}`, facilityId: f.facility.id, orderId: f.order.id, storageLocationId: f.bin.id,
      deliveryDate: new Date(STOCK_TIME), deliveredWetMassKg: 100, moistureContentPercent: 0, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
    const app = await createApplication(f.ctx, { code: `E2E-MIX-AP-P-${f.tag}`, deliveryId: delivery.id, applicationDate: new Date(STOCK_DATE), biocharAppliedTons: 0.1, fieldSizeHa: 1, evidenceMethod: "location" });
    expect(await getMixBinHeldApplicationIds(f.ctx, db, [app.id])).toEqual(new Set([app.id]));
  });
});
