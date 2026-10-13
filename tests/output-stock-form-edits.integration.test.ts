import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { db } from "@/db";
import { binMovements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { correctOutputStockEntry } from "@/data-access/output-stock-form-edits";
import { createDelivery, updateDelivery } from "@/data-access/delivery-output-writes";
import { cleanupPostedStock, postedStockFixture, postMeasurement, postDelivery, postProduct, deliveryInput, STOCK_TIME } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });
async function fixture() { const f = await postedStockFixture(); fixtures.push(f); return f; }

it("edits the latest Lost mass with a reversal and replacement and changes the balance", async () => {
  const f = await fixture();
  const original = await postMeasurement(f, { kind: "loss", wetMassKg: 100 });
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss" as const,
    wetMassKg: 40, moisturePercent: 0, correctsMovementId: original.movementId };
  const preview = await previewOutputStock(f.ctx, input);
  const saved = await correctOutputStockEntry(f.ctx, { ...input, reason: "Wrong scale reading", idempotencyKey: randomUUID(),
    basisFingerprint: preview.basisFingerprint, expectedProductVersions: preview.expectedProductVersions });
  expect(saved.preview.afterDryKg).toBe(960);
  const [movement] = await db.select().from(binMovements).where(eq(binMovements.id, saved.movementId));
  expect(movement.inputSnapshot).not.toHaveProperty("receiptIds");
  expect(movement.inputSnapshot?.receiptMarker).toMatchObject({ count: 1, identityHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "reversal", correctsMovementId: original.movementId }),
    expect.objectContaining({ id: saved.movementId, kind: "replacement", wetMassKg: 40, editLockedReason: null }),
  ]));
});

it("refuses a delivery date change through the stock form correction boundary", async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const movement = (await getOutputStockHistory(f.ctx, f.bin.id)).find(entry => entry.deliveryId === delivery.id)!;
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: "2026-09-13T12:00:00.000Z", kind: "delivery" as const,
    wetMassKg: 40, moisturePercent: 0, correctsMovementId: movement.id };
  const preview = await previewOutputStock(f.ctx, input);
  await expect(correctOutputStockEntry(f.ctx, { ...input, reason: "Wrong reading", idempotencyKey: randomUUID(),
    basisFingerprint: preview.basisFingerprint, expectedProductVersions: preview.expectedProductVersions })).rejects.toThrow("Choose a Lost mass entry to edit.");
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "replacement" })]));
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveredWetMassKg: 40 }))
    .toMatchObject({ deliveryDate: delivery.deliveryDate, deliveredWetMassKg: 40 });
});

it("keeps an existing receiptIds snapshot editable until another receipt arrives", async () => {
  const f = await fixture();
  const original = await postMeasurement(f, { kind: "loss", wetMassKg: 100 });
  const [movement] = await db.select().from(binMovements).where(eq(binMovements.id, original.movementId));
  const snapshot = { ...movement.inputSnapshot };
  delete snapshot.receiptMarker;
  await db.update(binMovements).set({ inputSnapshot: { ...snapshot, receiptIds: [f.product!.id] } }).where(eq(binMovements.id, movement.id));
  expect((await getOutputStockHistory(f.ctx, f.bin.id)).find(entry => entry.id === movement.id)?.editLockedReason).toBeNull();
  await postProduct(f, { massKg: 100, placedAt: "2026-09-11T12:00:00.000Z" });
  expect((await getOutputStockHistory(f.ctx, f.bin.id)).find(entry => entry.id === movement.id)?.editLockedReason).toMatch(/^Locked/);
});

it("refuses a Lost mass edit after a newer movement even from an unrelated sub-bin", async () => {
  const f = await fixture();
  const other = await postProduct(f, { massKg: 100 });
  const original = await postMeasurement(f, { kind: "loss", wetMassKg: 100, sources: [{ layerId: other.id, moisturePercent: 0 }] });
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss" as const,
    wetMassKg: 40, sources: [{ layerId: other.id, moisturePercent: 0 }], correctsMovementId: original.movementId };
  const preview = await previewOutputStock(f.ctx, input);
  await postMeasurement(f, { kind: "loss", wetMassKg: 10, sources: [{ layerId: f.product!.id, moisturePercent: 0 }], occurredAt: "2026-09-13T12:00:00.000Z" });
  expect((await previewOutputStock(f.ctx, input)).blockingMessage).toBeNull();
  await expect(correctOutputStockEntry(f.ctx, { ...input, reason: "Wrong reading", idempotencyKey: randomUUID(),
    basisFingerprint: preview.basisFingerprint, expectedProductVersions: preview.expectedProductVersions })).rejects.toMatchObject({
    message: "Locked because newer stock entries were recorded on this bin after it.", conflict: { entity: "storageLocation", id: f.bin.id },
  });
});

it("corrects a latest delivery wet mass and keeps its row and stock movement in agreement", async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const saved = await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveredWetMassKg: 40 });
  expect(saved).toMatchObject({ deliveredWetMassKg: 40, massDryKg: 40, deliveryDate: delivery.deliveryDate });
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history.filter(e => e.deliveryId === delivery.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "reversal" }),
    expect.objectContaining({ kind: "replacement", wetMassKg: 40, afterDryKg: 960, editLockedReason: null }),
  ]));
});

it("refuses delivery mass changes after a newer movement but allows transport edits", async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  await postMeasurement(f, { kind: "loss", wetMassKg: 10 });
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveredWetMassKg: 40 })).rejects.toMatchObject({
    message: "Locked because newer stock entries were recorded on this bin after it.", conflict: { entity: "storageLocation", id: f.bin.id },
  });
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, distanceNote: "Route note" })).toMatchObject({ deliveredWetMassKg: 100 });
});

it("corrects the delivery's split-bin draw and per-sub-bin moisture and can edit the latest replacement again", async () => {
  const f = await fixture();
  const other = await postProduct(f, { massKg: 100 });
  const delivery = await createDelivery(f.ctx, { ...await deliveryInput(f, 100), sources: [{ layerId: f.product!.id, moisturePercent: 20 }] });
  const saved = await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveredWetMassKg: 50,
    sources: [{ layerId: other.id, moisturePercent: 40 }] });
  expect(saved).toMatchObject({ deliveredWetMassKg: 50, moistureContentPercent: 40, massDryKg: 30 });
  const current = (await getOutputStockHistory(f.ctx, f.bin.id)).find(e => e.kind === "replacement")!;
  expect(current).toMatchObject({ afterDryKg: 1070, sources: [{ layerId: other.id, moisturePercent: 40 }] });
  expect(current.allocations).toMatchObject([{ layerId: other.id, dryMassKg: 30 }]);
  const again = await updateDelivery(f.ctx, saved.id, { expectedVersion: saved.version, correctsMovementId: current.id, deliveredWetMassKg: 25,
    sources: [{ layerId: other.id, moisturePercent: 20 }] });
  expect(again).toMatchObject({ deliveredWetMassKg: 25, moistureContentPercent: 20, massDryKg: 20 });
});

it("locks a latest loss when a newer product is added, including a physically older placement", async () => {
  const f = await fixture();
  const original = await postMeasurement(f, { kind: "loss", wetMassKg: 100 });
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss" as const,
    wetMassKg: 40, moisturePercent: 0, correctsMovementId: original.movementId };
  const preview = await previewOutputStock(f.ctx, input);
  await postProduct(f, { massKg: 100, placedAt: "2026-09-11T12:00:00.000Z" });
  await expect(correctOutputStockEntry(f.ctx, { ...input, reason: "Wrong reading", idempotencyKey: randomUUID(),
    basisFingerprint: preview.basisFingerprint, expectedProductVersions: preview.expectedProductVersions })).rejects.toMatchObject({
    message: "Locked because newer stock entries were recorded on this bin after it.",
  });
  expect((await getOutputStockHistory(f.ctx, f.bin.id)).find(e => e.id === original.movementId)?.editLockedReason).toMatch(/^Locked/);
});
