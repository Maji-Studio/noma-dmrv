/** Real Postgres regression coverage. The implementation sandbox does not execute this file. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns, feedstocks, productionProcesses, productionRunFeedstockDraws, productionRuns } from "@/db/schema";
import { createProductionRun, updateProductionRun } from "@/data-access/production-runs/mutations";
import { createCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { attachProductionRunToMatchingCreditBatch } from "@/data-access/credit-batch-membership";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { getOutputBinStockView } from "@/data-access/output-stock";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
import { getFacilityOutputStock } from "@/data-access/facility-output-stock";
import { previewProductStock } from "@/data-access/product-stock-preview";
import { outputReceiptMarker } from "@/data-access/output-stock-edit-lock";
import { getProductionRunById, getProductionRunStats } from "@/data-access/production-runs/queries";
import { updateStorageLocation, deleteStorageLocation } from "@/data-access/storage-locations";
import { storageLocations } from "@/db/schema";
import { readRecordDependents } from "@/data-access/record-lock-dependents";
import { runOperation } from "@/lib/operations/runner";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { DRY_MASS_BALANCE_MESSAGE } from "@/lib/production-runs/lifecycle";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";

const TIMEOUT_MS = 60_000;
const START = new Date("2026-10-13T08:00:00Z");
const END = new Date("2026-10-13T10:00:00Z");
const LATER = "2026-10-14T12:00:00Z";
const MERGED_AT = new Date("2026-10-13T11:00:00Z");
const NEXT_START = new Date("2026-10-15T08:00:00Z");
const NEXT_END = new Date("2026-10-15T10:00:00Z");
const INPUT_WET_KG = 10_000;
const DRAW_KG = 100;
const OUTPUT_KG = 50;
const MOISTURE_PERCENT = 20;
const DRY_FRACTION = 1 - MOISTURE_PERCENT / 100;
const INTAKE_DRY_FRACTION = 0.9;
const FIXTURE_DRY_KG = 1500;
const FIXTURE_WET_KG = 1750;
const OUTPUT_DRY_KG = 40;
const LOSS_WET_KG = 10;
const LEGACY_OUTPUT_KG = 60;
const REDUCED_DRAW_KG = 50;
let f: Awaited<ReturnType<typeof seedOutputStockParents>>;
let failedBinId: string;
let fuelBinId: string;
let fuelTypeId: string;

beforeEach(async () => {
  f = await seedOutputStockParents(db);
  const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  fuelTypeId = intake.feedstockTypeId;
  // Leave enough feedstock for a new run beyond the two fixture draws.
  await db.update(feedstocks).set({ massWetKg: INPUT_WET_KG, massDryKg: INPUT_WET_KG * INTAKE_DRY_FRACTION })
    .where(and(eq(feedstocks.organizationId, f.ctx.organizationId), eq(feedstocks.id, intake.id)));
  const [draw] = await db.select().from(productionRunFeedstockDraws).where(and(
    eq(productionRunFeedstockDraws.organizationId, f.ctx.organizationId), eq(productionRunFeedstockDraws.productionRunId, f.runs[0].id),
  ));
  fuelBinId = draw.storageLocationId;
  failedBinId = await createProductionRunOutputBin(f.ctx.organizationId, f.facility.id, true);
}, TIMEOUT_MS);
afterEach(async () => {
  if (!f) return;
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId));
  await db.delete(creditBatches).where(eq(creditBatches.organizationId, f.ctx.organizationId));
  await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, f.ctx.organizationId));
  await cleanupOutputStockFixture(db, f.ctx.organizationId);
}, TIMEOUT_MS);

function input() {
  return { code: `E2E-FAILED-${randomUUID()}`, facilityId: f.facility.id, reactorId: f.runs[0].reactorId!,
    status: "failed" as const, startTime: START, endTime: END,
    feedstockMoisturePercent: MOISTURE_PERCENT, feedstockDraws: [{ storageLocationId: fuelBinId, wetMassKg: DRAW_KG }],
    biocharOutputKg: OUTPUT_KG, biocharMoisturePercent: MOISTURE_PERCENT, biocharStorageLocationId: failedBinId };
}
const stored = async (id: string) => (await db.select().from(productionRuns).where(and(
  eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, id),
)))[0];
const version = async (id: string) => (await stored(id)).version;
const validation = (field: string) => ({ code: "validation_failed", issues: [expect.objectContaining({ path: [field] })] });
const edit = async (id: string, patch: Parameters<typeof updateProductionRun>[2]) => updateProductionRun(f.ctx, id, patch);

async function stockMovement(kind: "loss" | "count", wetMassKg: number) {
  return runOperation(recordOutputStockMovement, f.ctx, {
    storageLocationId: failedBinId, kind, occurredAt: LATER, wetMassKg, moisturePercent: wetMassKg === 0 ? 0 : MOISTURE_PERCENT, reason: `E2E ${kind}`,
  });
}

describe("Failed output in Uncarbonized bins", { timeout: TIMEOUT_MS }, () => {
  it("posts output stock, withdraws feedstock and records a linked intake and Lost mass", async () => {
    const before = await deriveFeedstockWetStockKg(f.ctx, db, fuelBinId);
    const run = await createProductionRun(f.ctx, input());
    expect(await deriveFeedstockWetStockKg(f.ctx, db, fuelBinId)).toBe(before - DRAW_KG);
    expect(await stored(run.id)).toMatchObject({ outputPostedAt: expect.any(Date), biocharStorageLocationId: failedBinId, biocharOutputKg: OUTPUT_KG });
    expect(await getOutputBinStockView(f.ctx, failedBinId)).toMatchObject({ dryMassKg: OUTPUT_DRY_KG, estimatedWetMassKg: OUTPUT_KG });
    const history = await getOutputStockHistory(f.ctx, failedBinId);
    expect(history).toContainEqual(expect.objectContaining({ id: run.id, kind: "intake", wetMassKg: OUTPUT_KG,
      source: { entity: "productionRun", id: run.id }, recordedAt: (await stored(run.id)).outputPostedAt!.toISOString() }));
    await stockMovement("loss", LOSS_WET_KG);
    expect(await getOutputBinStockView(f.ctx, failedBinId)).toMatchObject({ dryMassKg: OUTPUT_DRY_KG - LOSS_WET_KG * DRY_FRACTION, estimatedWetMassKg: OUTPUT_KG - LOSS_WET_KG });
    const after = await getOutputStockHistory(f.ctx, failedBinId);
    expect(after).toContainEqual(expect.objectContaining({ eventKind: "loss", editLockedReason: null }));
    await expect(edit(run.id, { expectedVersion: await version(run.id), biocharOutputKg: OUTPUT_KG + 1 })).rejects.toThrow();
  });

  it.each(["biocharOutputKg", "biocharMoisturePercent", "biocharStorageLocationId"] as const)("requires %s on create and update", async field => {
    await expect(createProductionRun(f.ctx, { ...input(), [field]: null })).rejects.toMatchObject(validation(field));
    const run = await createProductionRun(f.ctx, input());
    await expect(edit(run.id, { expectedVersion: await version(run.id), [field]: null })).rejects.toMatchObject(validation(field));
    expect((await stored(run.id)).outputPostedAt).toBeInstanceOf(Date);
  });

  it.each([0, -1])("refuses nonpositive Failed output: %s", async biocharOutputKg => {
    await expect(createProductionRun(f.ctx, { ...input(), biocharOutputKg })).rejects.toMatchObject(validation("biocharOutputKg"));
  });

  it("still requires an end time, feedstock and feedstock moisture", async () => {
    await expect(createProductionRun(f.ctx, { ...input(), endTime: null })).rejects.toThrow("A failed run needs an end time");
    await expect(createProductionRun(f.ctx, { ...input(), feedstockDraws: [] })).rejects.toMatchObject(validation("feedstockDraws"));
    await expect(createProductionRun(f.ctx, { ...input(), feedstockMoisturePercent: null })).rejects.toMatchObject(validation("feedstockMoisturePercent"));
  });

  it("still refuses Cancelled on create and foreign organization references", async () => {
    await expect(createProductionRun(f.ctx, { ...input(), status: "cancelled", cancellationReason: "Entered in error" }))
      .rejects.toThrow("A new production run can only start as Running, Complete or Failed.");
    await expect(createProductionRun({ ...f.ctx, organizationId: "e2e-foreign-failed-run" }, input())).rejects.toThrow(/not found/i);
  });

  it.each(["complete", "failed"] as const)("checks the %s bin tag on create and unchanged save", async status => {
    const wrongBinId = status === "failed" ? f.source.id : failedBinId;
    const message = status === "failed" ? "Choose an uncarbonized biochar bin for a failed run." : "Choose a biochar bin that is not uncarbonized for a complete run.";
    await expect(createProductionRun(f.ctx, { ...input(), status, biocharStorageLocationId: wrongBinId }))
      .rejects.toMatchObject({ ...validation("biocharStorageLocationId"), message });
    const run = await createProductionRun(f.ctx, { ...input(), status, biocharStorageLocationId: status === "failed" ? failedBinId : f.source.id });
    // A legacy row can exist because the Failed bin rule is intentionally enforced in the app.
    await db.update(productionRuns).set({ biocharStorageLocationId: wrongBinId }).where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, run.id)));
    await expect(edit(run.id, { expectedVersion: await version(run.id), electricityKwh: 1 })).rejects.toMatchObject({ ...validation("biocharStorageLocationId"), message });
    if (status === "failed") {
      expect((await getOutputStockHistory(f.ctx, wrongBinId)).some(entry => entry.id === run.id)).toBe(false);
      expect((await getOutputBinStockView(f.ctx, wrongBinId)).dryMassKg).toBe(FIXTURE_DRY_KG);
    }
  });

  it("retains the bin and receipt on metadata edits and moves the receipt on output edits", async () => {
    const run = await createProductionRun(f.ctx, input());
    const original = await stored(run.id);
    const marker = await outputReceiptMarker(f.ctx, failedBinId, db);
    await edit(run.id, { expectedVersion: await version(run.id), electricityKwh: 1 });
    expect(await stored(run.id)).toMatchObject({ biocharStorageLocationId: failedBinId, outputPostedAt: original.outputPostedAt });
    const [bin] = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, failedBinId)));
    await expect(deleteStorageLocation(f.ctx, failedBinId, bin.version)).rejects.toThrow();
    expect(marker.count).toBe(1);
    expect(await outputReceiptMarker(f.ctx, failedBinId, db)).toEqual(marker);
    // A controlled old marker avoids timing-dependent assertions in fast databases.
    await db.update(productionRuns).set({ outputPostedAt: END }).where(eq(productionRuns.id, run.id));
    await edit(run.id, { expectedVersion: await version(run.id), biocharOutputKg: OUTPUT_KG + 1 });
    expect((await stored(run.id)).outputPostedAt!.getTime()).toBeGreaterThan(END.getTime());
  });

  it.each(["complete", "failed"] as const)("refuses %s output edits after a later count while preserving metadata edits", async status => {
    if (status === "complete") failedBinId = await createProductionRunOutputBin(f.ctx.organizationId, f.facility.id);
    const run = await createProductionRun(f.ctx, { ...input(), status });
    await stockMovement("count", OUTPUT_KG);
    expect(await readRecordDependents(f.ctx, db, { entityType: "productionRun", entityId: run.id }))
      .toContainEqual(expect.objectContaining({ kind: "stockEntry" }));
    await expect(edit(run.id, { expectedVersion: await version(run.id), biocharOutputKg: OUTPUT_KG + 1 })).rejects.toThrow();
    await edit(run.id, { expectedVersion: await version(run.id), electricityKwh: 3 });
    expect(await stored(run.id)).toMatchObject({ biocharStorageLocationId: failedBinId, electricityKwh: 3, biocharOutputKg: OUTPUT_KG });
  });

  it("leaves older Failed rows readable but requires their output on the next save", async () => {
    const run = await createProductionRun(f.ctx, input());
    await db.update(productionRuns).set({ biocharOutputKg: null, biocharMoisturePercent: null, biocharDryMassKg: null,
      biocharStorageLocationId: null, outputPostedAt: null }).where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, run.id)));
    expect(await getProductionRunById(f.ctx, run.id)).toMatchObject({ status: "failed", biocharOutputKg: null });
    await expect(edit(run.id, { expectedVersion: await version(run.id), electricityKwh: 1 })).rejects.toMatchObject(validation("biocharOutputKg"));
  });

  it("refuses a Failed addition timed before a later switch back to split", async () => {
    await createProductionRun(f.ctx, input());
    const bin = async () => (await db.select().from(storageLocations).where(and(
      eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, failedBinId),
    )))[0];
    await updateStorageLocation(f.ctx, failedBinId, { expectedVersion: (await bin()).version, stockMode: "mix", mergedAt: MERGED_AT });
    await stockMovement("count", 0);
    await updateStorageLocation(f.ctx, failedBinId, { expectedVersion: (await bin()).version, stockMode: "split" });
    await expect(createProductionRun(f.ctx, { ...input(), startTime: NEXT_START, endTime: NEXT_END })).rejects.toThrow(/switched to split/);
  });

  it("checks Failed dry output against input on edits and transitions", async () => {
    const run = await createProductionRun(f.ctx, { ...input(), biocharOutputKg: LEGACY_OUTPUT_KG, biocharMoisturePercent: 0 });
    const reducedInput = { feedstockDraws: [{ storageLocationId: fuelBinId, wetMassKg: REDUCED_DRAW_KG }] };
    await expect(edit(run.id, { expectedVersion: await version(run.id), ...reducedInput })).rejects.toThrow(DRY_MASS_BALANCE_MESSAGE);
    await edit(run.id, { expectedVersion: await version(run.id), status: "running", endTime: null });
    await expect(edit(run.id, { expectedVersion: await version(run.id), status: "failed", endTime: END, ...reducedInput })).rejects.toThrow(DRY_MASS_BALANCE_MESSAGE);
    expect((await stored(run.id)).biocharOutputKg).toBe(LEGACY_OUTPUT_KG);
  });

  it("requires a different bin when Failed is reopened and completed", async () => {
    const run = await createProductionRun(f.ctx, input());
    await edit(run.id, { expectedVersion: await version(run.id), status: "running", endTime: null });
    expect((await stored(run.id)).outputPostedAt).toBeNull();
    expect((await getOutputBinStockView(f.ctx, failedBinId)).dryMassKg).toBe(0);
    await expect(edit(run.id, { expectedVersion: await version(run.id), status: "complete", endTime: END })).rejects.toMatchObject(validation("biocharStorageLocationId"));
    await edit(run.id, { expectedVersion: await version(run.id), status: "complete", endTime: END, biocharStorageLocationId: f.source.id });
    expect(await stored(run.id)).toMatchObject({ status: "complete", outputPostedAt: expect.any(Date), biocharStorageLocationId: f.source.id });
  });

  it("excludes posted Failed output from batch create, edit, auto-attach, facility biochar and product stock", async () => {
    const batchInput = { code: `E2E-CB-${f.tag}`, facilityId: f.facility.id, feedstockTypeId: fuelTypeId,
      startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), productionRunIds: [] };
    const run = await createProductionRun(f.ctx, input());
    expect((await stored(run.id)).outputPostedAt).toBeInstanceOf(Date);
    await expect(createCreditBatch(f.ctx, { ...batchInput, code: `E2E-CB-REFUSED-${f.tag}`, productionRunIds: [run.id] })).rejects.toThrow(/not complete/);
    const batch = await createCreditBatch(f.ctx, batchInput);
    await expect(updateCreditBatch(f.ctx, batch.id, { expectedVersion: batch.version, productionRunIds: [run.id] })).rejects.toThrow(/not complete/);
    expect(await db.transaction(tx => attachProductionRunToMatchingCreditBatch(f.ctx, tx, run.id))).toBeNull();
    await edit(run.id, { expectedVersion: await version(run.id), electricityKwh: 2 });
    expect(await db.select().from(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, run.id)))).toEqual([]);
    expect(await getProductionRunStats(f.ctx, f.facility.id)).toMatchObject({ totalBiocharKg: FIXTURE_WET_KG, totalBiocharDryKg: FIXTURE_DRY_KG });
    expect(await getFacilityOutputStock(f.ctx, f.facility.id)).toMatchObject({ biochar: { dryBiocharKg: FIXTURE_DRY_KG }, uncarbonized: { dryBiocharKg: OUTPUT_DRY_KG, wetKg: OUTPUT_KG } });
    await expect(previewProductStock(f.ctx, { facilityId: f.facility.id, formulationId: f.pure.id, placedAt: LATER,
      sourceBiocharStorageLocationId: failedBinId, storageLocationId: f.bin.id, massKg: OUTPUT_KG,
      moistureContentPercent: MOISTURE_PERCENT, waterAddedKg: 0 })).rejects.toMatchObject(validation("sourceBiocharStorageLocationId"));
  });
});
