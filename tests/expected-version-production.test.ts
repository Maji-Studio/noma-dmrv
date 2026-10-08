import { masterDataVersion } from "./helpers/master-data-version";
/** Real PostgreSQL coverage; run after generating the production-version migration. */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { biocharProducts, productionRuns, incidentReports, productionSamples, outputStockAllocations, outputStockMoistureReadings } from "@/db/schema";
import { createProductionRun, updateProductionRun, deleteProductionRun } from "@/data-access/production-runs";
import { createProductionIncident, updateProductionIncident, deleteProductionIncident } from "@/data-access/production-incidents";
import { createProductionSample, updateProductionSample, deleteProductionSample } from "@/data-access/production-samples";
import { updateBiocharProduct, deleteBiocharProduct } from "@/data-access/biochar-products";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { getOutputBinStockView } from "@/data-access/output-stock";
import { postOutputStock } from "@/data-access/output-stock-post";
import { STALE_VERSION_CONFLICT_CODE } from "@/lib/stale-version";
import { postedStockFixture, cleanupPostedStock, postProduct, postMeasurement, STOCK_TIME } from "./helpers/posted-output-stock-fixture";

const INITIAL_VERSION = 1;
const VERSION_INCREMENT = 1;
const ONE_WINNER = 1;
const FIRST_VALUE = 12;
const SECOND_VALUE = 13;
const LOSS_WET_KG = 10;
const CORRECTED_LOSS_WET_KG = 5;
const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
async function fixture() {
  const f = await postedStockFixture();
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await db.delete(incidentReports).where(eq(incidentReports.organizationId, f.ctx.organizationId));
    await db.delete(productionSamples).where(eq(productionSamples.organizationId, f.ctx.organizationId));
    await cleanupPostedStock(f);
  }
});
const stale = { code: "stale_version", conflict: { code: STALE_VERSION_CONFLICT_CODE } };

type Subject = {
  version: number;
  save: (expectedVersion: number, value: number) => Promise<{ version: number }>;
  remove: (expectedVersion: number) => Promise<void>;
};
const subjects = {
  productionRun: async (f: Awaited<ReturnType<typeof fixture>>): Promise<Subject> => {
    // Version checks need an editable run, without terminal feedstock/output requirements.
    const run = await createProductionRun(f.ctx, {
      code: `E2E-VERSION-PR-${f.tag}`,
      facilityId: f.facility.id,
      reactorId: f.runs[0].reactorId,
      status: "draft",
      startTime: new Date(STOCK_TIME),
      endTime: null,
      feedstockDraws: [],
    });
    return {
      version: run.version,
      save: (expectedVersion, feedingRateKgHr) => updateProductionRun(f.ctx, run.id, { expectedVersion, feedingRateKgHr }),
      remove: expectedVersion => deleteProductionRun(f.ctx, run.id, expectedVersion),
    };
  },
  productionIncident: async (f: Awaited<ReturnType<typeof fixture>>): Promise<Subject> => {
    const row = await createProductionIncident(f.ctx, { productionRunId: f.runs[0].id, incidentTime: new Date(STOCK_TIME), description: "E2E incident", severity: "low" });
    return { version: row.version,
      save: (expectedVersion, value) => updateProductionIncident(f.ctx, row.id, { expectedVersion, notes: String(value) }),
      remove: expectedVersion => deleteProductionIncident(f.ctx, row.id, expectedVersion) };
  },
  productionSample: async (f: Awaited<ReturnType<typeof fixture>>): Promise<Subject> => {
    const row = await createProductionSample(f.ctx, { productionRunId: f.runs[0].id, timestamp: new Date(STOCK_TIME) });
    return { version: row.version,
      save: (expectedVersion, temperatureC) => updateProductionSample(f.ctx, row.id, { expectedVersion, temperatureC }),
      remove: expectedVersion => deleteProductionSample(f.ctx, row.id, expectedVersion) };
  },
  biocharProduct: async (f: Awaited<ReturnType<typeof fixture>>): Promise<Subject> => ({
    version: f.product!.version,
    save: (expectedVersion, densityKgM3) => updateBiocharProduct(f.ctx, f.product!.id, { expectedVersion, densityKgM3 }),
    remove: expectedVersion => deleteBiocharProduct(f.ctx, f.product!.id, expectedVersion),
  }),
};

describe.each(Object.entries(subjects))("%s row versions", (_entity, makeSubject) => {
  it("increments each committed update and refuses stale updates and deletes", async () => {
    const subject = await makeSubject(await fixture());
    expect(subject.version).toBe(INITIAL_VERSION);
    const saved = await subject.save(subject.version, FIRST_VALUE);
    expect(saved.version).toBe(subject.version + VERSION_INCREMENT);
    await expect(subject.save(subject.version, SECOND_VALUE)).rejects.toMatchObject(stale);
    await expect(subject.remove(subject.version)).rejects.toMatchObject(stale);
    const savedAgain = await subject.save(saved.version, SECOND_VALUE);
    expect(savedAgain.version).toBe(saved.version + VERSION_INCREMENT);
  });
  it("commits exactly one of two writers sharing a version", async () => {
    const subject = await makeSubject(await fixture());
    const outcomes = await Promise.allSettled([
      subject.save(subject.version, FIRST_VALUE), subject.save(subject.version, SECOND_VALUE),
    ]);
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(ONE_WINNER);
    const refused = outcomes.filter(row => row.status === "rejected");
    expect(refused).toHaveLength(ONE_WINNER);
    expect(refused[0].reason).toMatchObject(stale);
  });
});

it("facility archive and restore each bump their production runs and products", async () => {
  const f = await fixture();
  const read = async () => {
    const [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[0].id)));
    const [product] = await db.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, f.ctx.organizationId), eq(biocharProducts.id, f.product!.id)));
    return [run.version, product.version];
  };
  const opened = await read();
  await archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
  expect(await read()).toEqual(opened.map(version => version + VERSION_INCREMENT));
  await restoreFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
  expect(await read()).toEqual(opened.map(version => version + VERSION_INCREMENT + VERSION_INCREMENT));
});

it("stock posting and correction check preview versions, bump products and preserve replays", async () => {
  const f = await fixture();
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: "loss" as const, wetMassKg: LOSS_WET_KG, moisturePercent: 0 };
  const preview = await previewOutputStock(f.ctx, input);
  const saved = await updateBiocharProduct(f.ctx, f.product!.id, { expectedVersion: f.product!.version, densityKgM3: FIRST_VALUE });
  const command = { ...input, expectedProductVersions: preview.expectedProductVersions!, basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: "E2E version loss" };
  await expect(postOutputStock(f.ctx, command)).rejects.toMatchObject(stale);
  const refreshed = await previewOutputStock(f.ctx, input);
  const current = { ...command, expectedProductVersions: refreshed.expectedProductVersions!, basisFingerprint: refreshed.basisFingerprint };
  const posted = await postOutputStock(f.ctx, current);
  expect(posted.savedProducts[0].version).toBe(saved.version + VERSION_INCREMENT);
  const replay = await postOutputStock(f.ctx, current);
  expect(replay.savedProducts[0].version).toBe(posted.savedProducts[0].version);
  const correction = { ...input, correctsMovementId: posted.movementId, wetMassKg: CORRECTED_LOSS_WET_KG };
  const correctionPreview = await previewOutputStock(f.ctx, correction);
  const corrected = await postOutputStock(f.ctx, { ...correction, expectedProductVersions: correctionPreview.expectedProductVersions!, basisFingerprint: correctionPreview.basisFingerprint, idempotencyKey: randomUUID(), reason: "E2E correction" });
  expect(corrected.savedProducts[0].version).toBe(posted.savedProducts[0].version + VERSION_INCREMENT);
});


it("checks and bumps products whose count readings are reversed without replacement readings", async () => {
  const f = await fixture();
  const later = await postProduct(f, { massKg: 100, placedAt: "2026-09-13T12:00:00.000Z" });
  // Exactly 1100 kg solids: no allocations, but both products receive readings.
  const count = await postMeasurement(f, { kind: "count", wetMassKg: 1375, moisturePercent: 20 });
  expect(await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.movementId, count.movementId))).toEqual([]);
  const originalReadings = await db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.movementId, count.movementId));
  expect(originalReadings.map(row => row.biocharProductId).sort()).toEqual([f.product!.id, later.id].sort());

  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, kind: "count" as const,
    occurredAt: "2026-09-12T18:00:00.000Z", wetMassKg: 1250, moisturePercent: 20, correctsMovementId: count.movementId };
  const preview = await previewOutputStock(f.ctx, input);
  expect(preview.allocations).toEqual([]);
  const edited = await updateBiocharProduct(f.ctx, later.id, {
    expectedVersion: preview.expectedProductVersions![later.id], densityKgM3: FIRST_VALUE,
  });
  const command = { ...input, expectedProductVersions: preview.expectedProductVersions!, basisFingerprint: preview.basisFingerprint,
    idempotencyKey: randomUUID(), reason: "E2E backdated allocation-free count" };
  await expect(postOutputStock(f.ctx, command)).rejects.toMatchObject(stale);
  const refreshed = await previewOutputStock(f.ctx, input);
  // Metadata alone leaves the stock fingerprint unchanged: the version check matters.
  expect(refreshed.basisFingerprint).toBe(preview.basisFingerprint);
  const corrected = await postOutputStock(f.ctx, { ...command, expectedProductVersions: refreshed.expectedProductVersions! });
  expect(corrected.savedProducts.map(row => row.id).sort()).toEqual([f.product!.id, later.id].sort());
  expect(corrected.savedProducts.find(row => row.id === later.id)?.version).toBe(edited.version + VERSION_INCREMENT);
  const replacementReadings = await db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.movementId, corrected.movementId));
  expect(replacementReadings.map(row => row.biocharProductId)).toEqual([f.product!.id]);
  expect((await getOutputBinStockView(f.ctx, f.bin.id)).estimatedWetMassKg).toBe(1350);
});
