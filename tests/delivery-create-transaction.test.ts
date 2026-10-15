import { TEST_SITE_POSITION } from "./helpers/test-org";
import { rationalToNumber, readRational } from "@/lib/output-stock";
import { recordOutputStockMovementInTransaction } from "@/data-access/output-stock-post";
import { certifyOutputLineage, cleanupCertifiedOutputLineage } from "./helpers/certified-output-lineage";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { updateStorageLocation } from "@/data-access/storage-locations";
import { archiveFacility } from "@/data-access/facilities";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, binMovements, outputStockAllocations, outputStockRunAllocations, storageLocations, orders, drivers, vehicles, facilities, biocharProducts, transportLegs } from "@/db/schema";
import { createDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";

vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
const organizations: string[] = [];
const TIME = "2026-09-14T12:00:00.000Z";
afterEach(async () => { for (const id of organizations.splice(0)) {
  await cleanupCertifiedOutputLineage(id);
  await db.update(deliveries).set({ driverId: null, vehicleId: null }).where(eq(deliveries.organizationId, id));
  await db.delete(drivers).where(eq(drivers.organizationId, id));
  await db.delete(vehicles).where(eq(vehicles.organizationId, id));
  await cleanupOutputStockFixture(db, id);
} });
async function fixture() {
  const f = await createDeliveryFixture();
  organizations.push(f.ctx.organizationId);
  return f;
}
describe("delivery create in the caller transaction", () => {
  it("posts blended stock, returns stored allocations, and replays without another draw at pool size one", async () => {
    const f = await fixture();
    expect(db.$client.options.max).toBe(1);
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(result.delivery.massDryKg).toBeCloseTo(result.allocations.reduce((sum, a) => sum + a.dryBiocharKg, 0));
    expect(result.allocations).toMatchObject([{ layerId: f.product.id, solidsKg: 80, wetKg: 100, policy: "pro_rata" }]);
    const allocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, result.delivery.id));
    expect(Number(allocations[0].dryMassKg)).toBe(result.allocations[0].dryBiocharKg);
    const before = await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId));
    const replay = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(replay.delivery.id).toBe(result.delivery.id);
    expect(replay.allocations).toEqual(result.allocations);
    expect(replay.basisFingerprint).toBe(result.basisFingerprint);
    expect(await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId))).toEqual(before);
  });
  it("refuses one gram over the order remainder without inserting a delivery", async () => {
    const f = await fixture();
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredWetMassKg: 100.001 }))).rejects.toMatchObject({ code: "conflict", issues: [{ path: ["deliveredWetMassKg"], meta: { measure: "order_remaining_wet", availableWetKg: 100, requestedWetKg: 100.001, unit: "kg" } }] });
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toEqual([]);
  });
  it("refuses future instants and accepts exactly the injected clock", async () => {
    const f = await fixture();
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input, { now: new Date("2026-09-14T11:59:59Z") }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["deliveredAt"] }] });
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input, { now: new Date(TIME) }))).resolves.toHaveProperty("delivery.id");
  });
});

describe("delivery reference refusals and replay", () => {
  it.each(["driverId", "vehicleId", "orderId", "storageLocationId"] as const)("refuses unknown %s without claiming the key", async field => {
    const f = await fixture();
    const before = await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, [field]: randomUUID() }))).rejects.toMatchObject({ code: "not_found", issues: [{ path: [field] }] });
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId))).toEqual(before);
  });
  it("refuses unknown source layers before planning and backdated layers at their array pointer", async () => {
    const f = await fixture();
    for (const [layerId, deliveredAt, code] of [[randomUUID(), TIME, "not_found"], [f.product.id, "2026-09-11T12:00:00Z", "validation_failed"]]) {
      await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredAt, sources: [{ layerId, moisturePercent: 20 }] }))).rejects.toMatchObject({ code, issues: [{ path: ["sources", 0, "layerId"] }] });
    }
  });
  it.each(["order", "facility"])("replays after %s archive and refuses a fresh key", async target => {
    const f = await fixture();
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    if (target === "order") await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, f.order.id));
    else await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const postingCounts = async () => (await Promise.all([
      db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId)),
      db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId)),
      db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, f.ctx.organizationId)),
      db.select().from(outputStockRunAllocations).where(eq(outputStockRunAllocations.organizationId, f.ctx.organizationId)),
    ])).map(rows => rows.length);
    const before = await postingCounts();
    const replay = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(replay.delivery.id).toBe(result.delivery.id);
    expect(replay.allocations).toEqual(result.allocations);
    expect(replay.basisFingerprint).toBe(result.basisFingerprint);
    expect(await postingCounts()).toEqual(before);
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, idempotencyKey: randomUUID() }))).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["orderId"] }] });
  });
  it.each([
    [{ type: "biochar_bin", formulationId: null }, "validation_failed", "product bin"],
    [{ archivedAt: new Date() }, "not_found", "Source bin was not found."],
  ] as const)("refuses an ineligible own bin: %s", async (change, code, message) => {
    const f = await fixture();
    await db.update(storageLocations).set(change).where(eq(storageLocations.id, f.bin.id));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input))).rejects.toMatchObject({ code, issues: [{ path: ["storageLocationId"], message: expect.stringContaining(message) }] });
  });
  it("returns total-solids shortage metadata", async () => {
    const f = await fixture();
    await db.update(orders).set({ quantityKg: 2000 }).where(eq(orders.id, f.order.id));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredWetMassKg: 1000.001 }))).rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["deliveredWetMassKg"], meta: { measure: "total_solids", availableSolidsKg: 800, unit: "kg" } }] });
  });
  it("reports a forced custom-code collision at /code", async () => {
    const f = await fixture();
    await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, code: "DL-COLLISION", deliveredWetMassKg: 10 }));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, code: "DL-COLLISION", idempotencyKey: randomUUID(), deliveredWetMassKg: 10 }))).rejects.toMatchObject({ code: "conflict", issues: [{ path: ["code"] }] });
  });
  it("returns the same basis and allocations as a rolled-back preview", async () => {
    const f = await fixture();
    const rollback = new Error("Preview rollback");
    let preview: Awaited<ReturnType<typeof createDeliveryInTransaction>> | undefined;
    await expect(db.transaction(async tx => { preview = await createDeliveryInTransaction(f.ctx, tx, f.input); throw rollback; })).rejects.toBe(rollback);
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(result.basisFingerprint).toBe(preview!.basisFingerprint);
    expect(result.allocations).toEqual(preview!.allocations);
  });
});

describe("timed delivery allocation", () => {
  async function twoProducts(mode: "mix" | "split", drawOrder: "oldest_first" | "newest_first" = "oldest_first") {
    const f = await fixture();
    await db.update(storageLocations).set({ stockMode: mode, drawOrder }).where(eq(storageLocations.id, f.bin.id));
    await db.update(orders).set({ quantityKg: 2000 }).where(eq(orders.id, f.order.id));
    const second = await createBiocharProduct(f.ctx, {
      code: `E2E-P2-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id,
      placedAt: "2026-09-13T12:00:00Z", sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      massKg: 500, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: 100, moistureContentPercent: 60 }] },
    });
    return { ...f, second };
  }
  it("draws a mixed bin pro rata including ingredient solids", async () => {
    const f = await twoProducts("mix");
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredWetMassKg: 300 }));
    expect(result.allocations).toMatchObject([
      { layerId: f.product.id, solidsKg: 160, dryBiocharKg: 144, wetKg: 200, policy: "pro_rata" },
      { layerId: f.second.id, solidsKg: 80, dryBiocharKg: 72, wetKg: 100, policy: "pro_rata" },
    ]);
    expect(result.delivery.massDryKg).toBe(216);
  });
  it("returns every stored allocation field for a fractional multi-layer draw", async () => {
    const f = await twoProducts("mix");
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredWetMassKg: 100.001, moisturePercent: 23.4567 }));
    const stored = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, result.delivery.id));
    expect(stored).toHaveLength(2);
    const tuples = stored.map(row => ({ layerId: row.biocharProductId, code: row.basisSnapshot.code,
      dryBiocharKg: Number(row.dryMassKg), solidsKg: rationalToNumber(readRational(row.basisSnapshot.solidsKg)),
      wetKg: row.wetMassKg === null ? null : Number(row.wetMassKg), moisturePercent: Number(row.basisSnapshot.readingPercent), policy: row.basisSnapshot.policy }));
    expect(result.allocations).toEqual(result.allocations.map(allocation => tuples.find(row => row.layerId === allocation.layerId)));
    expect(result.allocations.map(a => a.wetKg)).toEqual([66.668, 33.333]);
  });
  it.each(["oldest_first", "newest_first"] as const)("uses split default %s", async drawOrder => {
    const f = await twoProducts("split", drawOrder);
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(result.allocations).toMatchObject([{ layerId: drawOrder === "oldest_first" ? f.product.id : f.second.id, policy: drawOrder === "oldest_first" ? "fifo" : "lifo", solidsKg: 80 }]);
    const stored = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, result.delivery.id));
    expect(stored[0].basisSnapshot).toMatchObject({ defaultDrawOrder: drawOrder, order: null });
  });
  it("keeps operator order, a partial final layer and solids-weighted moisture", async () => {
    const f = await twoProducts("split");
    const sources = [{ layerId: f.second.id, moisturePercent: 50 }, { layerId: f.product.id, moisturePercent: 20 }];
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, sources, deliveredWetMassKg: 900 }));
    expect(result.allocations).toMatchObject([
      { layerId: f.second.id, dryBiocharKg: 360, solidsKg: 400, wetKg: 800, moisturePercent: 50, policy: "operator_order" },
      { layerId: f.product.id, dryBiocharKg: 72, solidsKg: 80, wetKg: 100, moisturePercent: 20, policy: "operator_order" },
    ]);
    expect(result.delivery.massDryKg).toBe(432);
    expect(result.delivery.moistureContentPercent).toBeCloseTo(46.6667, 3);
    const stored = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, result.delivery.id));
    expect(stored.every(a => JSON.stringify(a.basisSnapshot.order) === JSON.stringify([f.second.id, f.product.id]))).toBe(true);
  });
  it("accepts sources before a split-to-mix merge and refuses them after it", async () => {
    const f = await twoProducts("split");
    await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, stockMode: "mix", mergedAt: new Date("2026-09-15T12:00:00Z") });
    const sources = [{ layerId: f.product.id, moisturePercent: 20 }];
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, sources }));
    expect(result.allocations[0].policy).toBe("operator_order");
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, sources, idempotencyKey: randomUUID(), deliveredAt: "2026-09-16T12:00:00Z" }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["sources"] }] });
  });
});

describe("delivery tenant and lineage boundaries", () => {
  it("checks drivers and vehicles through the one-connection transaction, hiding foreign references", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const [driver] = await db.insert(drivers).values({ organizationId: foreign.ctx.organizationId, code: "E2E-DRIVER", name: "E2E Driver" }).returning();
    const [vehicle] = await db.insert(vehicles).values({ organizationId: foreign.ctx.organizationId, code: "E2E-VEHICLE", name: "E2E Vehicle", vehicleType: "truck" }).returning();
    for (const [field, id] of [["driverId", driver.id], ["vehicleId", vehicle.id], ["orderId", foreign.order.id], ["storageLocationId", foreign.bin.id]]) {
      await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, [field]: id }))).rejects.toMatchObject({ code: "not_found", issues: [{ path: [field] }] });
    }
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, sources: [{ layerId: foreign.product.id, moisturePercent: 20 }] }))).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["sources", 0, "layerId"] }] });
    await db.update(drivers).set({ organizationId: f.ctx.organizationId }).where(eq(drivers.id, driver.id));
    await db.update(vehicles).set({ organizationId: f.ctx.organizationId }).where(eq(vehicles.id, vehicle.id));
    const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, driverId: driver.id, vehicleId: vehicle.id }));
    expect(result.delivery).toMatchObject({ driverId: driver.id, vehicleId: vehicle.id });
  });
  it("distinguishes wrong formulation, another facility and a source in another bin", async () => {
    const f = await fixture();
    await db.update(storageLocations).set({ formulationId: f.pure.id }).where(eq(storageLocations.id, f.bin.id));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["storageLocationId"], message: expect.stringContaining("formulation") }] });
    await db.update(storageLocations).set({ formulationId: f.recipe.id }).where(eq(storageLocations.id, f.bin.id));
    const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: f.ctx.organizationId, code: "E2E-OTHER", name: "E2E Other", timezone: "UTC" }).returning();
    const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: facility.id, code: "E2E-OTHER", name: "E2E Other", type: "product_bin", formulationId: f.recipe.id }).returning();
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, storageLocationId: bin.id }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["storageLocationId"], message: expect.stringContaining("facility") }] });
    const [otherBin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, code: "E2E-EMPTY", name: "E2E Empty", type: "product_bin", formulationId: f.recipe.id }).returning();
    await db.update(biocharProducts).set({ storageLocationId: otherBin.id }).where(eq(biocharProducts.id, f.product.id));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, sources: [{ layerId: f.product.id, moisturePercent: 20 }] }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["sources", 0, "layerId"], message: expect.stringContaining("another bin") }] });
  });
  it("refuses submitted order lineage with the order pointer", async () => {
    const f = await fixture();
    await certifyOutputLineage(f, { runId: f.runs[0].id, productId: f.product.id, submitted: true });
    const [existing] = await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId));
    await db.update(orders).set({ formulationId: f.recipe.id, quantityKg: 2000 }).where(eq(orders.id, existing.orderId));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, orderId: existing.orderId }))).rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["orderId"] }] });
  });
  it.each([{ date: "2026-03-29", time: "02:30" }, { date: "2026-10-25", time: "02:30" }])("refuses facility-zone DST gap or fold: %s", async deliveredAt => {
    const f = await fixture();
    await db.update(facilities).set({ timezone: "Europe/Zurich" }).where(eq(facilities.id, f.facility.id));
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredAt }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["deliveredAt"] }] });
  });
  it("refuses sources in a past mix period even though the bin is split now", async () => {
    const f = await fixture();
    await db.transaction(tx => recordOutputStockMovementInTransaction(f.ctx, tx, { storageLocationId: f.bin.id, facilityId: f.facility.id, kind: "count", occurredAt: "2026-09-15T12:00:00Z", wetMassKg: 0, idempotencyKey: randomUUID(), reason: "E2E empty bin" }));
    await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, stockMode: "split" });
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, sources: [{ layerId: f.product.id, moisturePercent: 20 }] }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["sources"] }], message: expect.stringContaining("split bin") });
  });
});


it("rolls back every posting side effect on late stock refusal and stale basis", async () => {
  const f = await fixture();
  await db.update(orders).set({ quantityKg: 2000 }).where(eq(orders.id, f.order.id));
  const snapshot = () => Promise.all([
    db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId)),
    db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId)),
    db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, f.ctx.organizationId)),
    db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId)),
  ]);
  const before = await snapshot();
  for (const change of [{ deliveredWetMassKg: 1000.001 }, { basisFingerprint: "stale" }, { deliveredAt: "2026-09-11T12:00:00Z" }]) {
    await expect(db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, ...change }))).rejects.toHaveProperty("code");
    expect(await snapshot()).toEqual(before);
  }
});

it("resolves a local instant in the order facility zone", async () => {
  const f = await fixture();
  await db.update(facilities).set({ timezone: "Europe/Zurich" }).where(eq(facilities.id, f.facility.id));
  const result = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredAt: { date: "2026-09-14", time: "14:00" } }));
  expect(result.delivery.deliveryDate).toEqual(new Date(TIME));
});

// Change the discovered zone at the existing observer seam, before its share lock.
it.each(["local", "offset", "date"] as const)("revalidates a changed facility zone for %s input", async kind => {
  const f = await fixture();
  const deliveredAt = kind === "local" ? { date: "2026-09-14", time: "12:00" } : kind === "date" ? new Date(TIME) : TIME;
  const write = db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredAt }, {
    snapshotStock: async lockedTx => {
      await lockedTx.update(facilities).set({ timezone: "Europe/Zurich" }).where(eq(facilities.id, f.facility.id));
    },
  }));
  if (kind === "local") {
    await expect(write).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["deliveredAt"], message: "Facility time zone changed. Refresh and retry." }] });
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toEqual([]);
  } else {
    expect((await write).delivery.deliveryDate).toEqual(new Date(TIME));
  }
});
