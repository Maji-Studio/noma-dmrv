/**
 * DB-backed tests for the credit-batch ↔ lab-sample linking write paths.
 * Since issue #309 a Sample anchors on ONE credit batch directly — the batch's
 * biochar is commingled across runs, so `createSample` requires
 * `creditBatchId` and never takes a production run. Two paths must keep
 * `samples.creditBatchId` consistent:
 *
 *   1. Sample side — `createSample` links the given batch (and rejects an
 *      unknown one); `updateSample` can move a sample to another batch.
 *   2. Batch side (legacy rows) — pre-re-grain samples carry a
 *      `productionRunId`; `createCreditBatch`/`updateCreditBatch` still
 *      back-fill those onto the batch via run membership, and re-point
 *      (unlink removed runs' samples, link added runs') on a membership
 *      change. Batch-anchored samples (null run link) are never re-pointed.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test
 * defaults), mirroring tests/credit-batch-validation.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities, reactors } from "@/db/schema/facilities";
import { feedstockTypes, feedstocks } from "@/db/schema/feedstock";
import {
  productionRuns,
  productionRunFeedstocks,
  samples,
} from "@/db/schema/production";
import {
  creditBatches,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { productionProcesses } from "@/db/schema/production-processes";
import {
  createCreditBatch,
  updateCreditBatch,
} from "@/data-access/credit-batches";
import { createSample, updateSample } from "@/data-access/samples";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000777";

const createdIds = {
  facilities: [] as string[],
  reactors: [] as string[],
  feedstockTypes: [] as string[],
  feedstocks: [] as string[],
  productionRuns: [] as string[],
  creditBatches: [] as string[],
  samples: [] as string[],
};

let facilityId: string;
// Independent runs (all single-feedstock, in the June window) so each test
// owns its own runs — a run belongs to at most one batch (unique constraint).
let runDerive: string;
let runBackfill: string;
let runReA: string;
let runReB: string;
let runReC: string;
let runUpdate: string;
let runMoveB: string;

const baseBatchData = {
  startDate: new Date("2025-06-01"),
  endDate: new Date("2025-06-30"),
  certifier: "isometric" as const,
  durabilityOption: "200_year" as const,
  hToCorgRatio: 0.4,
  currency: "TZS" as const,
};

/** Create a sample through the write path — anchored on a credit batch. */
async function makeSample(
  creditBatchId: string,
  code: string,
): Promise<string> {
  const sample = await createSample(TEST_USER_ID, {
    sampleCode: code,
    creditBatchId,
    samplingTime: new Date("2025-06-15T10:00:00Z"),
    totalCarbonPercent: 80,
    organicCarbonPercent: 78,
  });
  createdIds.samples.push(sample.id);
  return sample.id;
}

/**
 * Insert a LEGACY pre-re-grain sample row directly: run-linked, with the batch
 * link as it stood (the batch-side back-fill/re-point paths only act on these).
 */
async function insertLegacySample(
  productionRunId: string,
  code: string,
  creditBatchId: string | null = null,
): Promise<string> {
  const [row] = await db
    .insert(samples)
    .values({
      sampleCode: code,
      productionRunId,
      creditBatchId,
      samplingTime: new Date("2025-06-15T10:00:00Z"),
      totalCarbonPercent: 80,
      organicCarbonPercent: 78,
    })
    .returning({ id: samples.id });
  createdIds.samples.push(row.id);
  return row.id;
}

async function batchIdOfSample(sampleId: string): Promise<string | null> {
  const [row] = await db
    .select({ creditBatchId: samples.creditBatchId })
    .from(samples)
    .where(eq(samples.id, sampleId));
  return row?.creditBatchId ?? null;
}

beforeAll(async () => {
  const runId = Date.now().toString(36);

  const [facility] = await db
    .insert(facilities)
    .values({ name: `Sample-Link Facility ${runId}`, code: `FAC-SL-${runId}` })
    .returning({ id: facilities.id });
  facilityId = facility.id;
  createdIds.facilities.push(facility.id);

  const [reactor] = await db
    .insert(reactors)
    .values({
      code: `RE-SL-${runId}`,
      facilityId,
      identifier: "Sample-Link Reactor",
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });
  createdIds.reactors.push(reactor.id);

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      name: `Sample-Link Woodchips ${runId}`,
      code: `FT-SL-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  createdIds.feedstockTypes.push(feedstockType.id);

  const [feedstock] = await db
    .insert(feedstocks)
    .values({
      code: `FS-SL-${runId}`,
      facilityId,
      feedstockTypeId: feedstockType.id,
      massDryKg: 9000,
    })
    .returning({ id: feedstocks.id });
  createdIds.feedstocks.push(feedstock.id);

  const runRows = await db
    .insert(productionRuns)
    .values(
      ["derive", "backfill", "reA", "reB", "reC", "update", "moveB"].map((tag, i) => ({
        code: `PR-SL-${tag}-${runId}`,
        facilityId,
        reactorId: reactor.id,
        date: `2025-06-1${i}`,
        startTime: new Date(`2025-06-1${i}T08:00:00Z`),
        endTime: new Date(`2025-06-1${i}T12:00:00Z`),
        biocharDryMassKg: 4000,
      })),
    )
    .returning({ id: productionRuns.id });
  [runDerive, runBackfill, runReA, runReB, runReC, runUpdate, runMoveB] =
    runRows.map((r) => r.id);
  createdIds.productionRuns.push(...runRows.map((r) => r.id));

  // Every run needs a single-feedstock link for createCreditBatch's derivation.
  await db.insert(productionRunFeedstocks).values(
    createdIds.productionRuns.map((productionRunId) => ({
      productionRunId,
      feedstockId: feedstock.id,
      massUsedKg: 400,
    })),
  );
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    if (createdIds.samples.length > 0) {
      await tx.delete(samples).where(inArray(samples.id, createdIds.samples));
    }
    if (createdIds.creditBatches.length > 0) {
      await tx
        .delete(creditBatchProductionRuns)
        .where(
          inArray(
            creditBatchProductionRuns.creditBatchId,
            createdIds.creditBatches,
          ),
        );
      await tx
        .delete(creditBatches)
        .where(inArray(creditBatches.id, createdIds.creditBatches));
    }
    if (createdIds.productionRuns.length > 0) {
      await tx
        .delete(productionRunFeedstocks)
        .where(
          inArray(
            productionRunFeedstocks.productionRunId,
            createdIds.productionRuns,
          ),
        );
      await tx
        .delete(productionRuns)
        .where(inArray(productionRuns.id, createdIds.productionRuns));
    }
    if (createdIds.feedstocks.length > 0) {
      await tx
        .delete(feedstocks)
        .where(inArray(feedstocks.id, createdIds.feedstocks));
    }
    if (createdIds.facilities.length > 0) {
      // createCreditBatch find-or-creates a production_processes row per
      // (facility, feedstockType) — untracked, so clear it by facility.
      await tx
        .delete(productionProcesses)
        .where(inArray(productionProcesses.facilityId, createdIds.facilities));
      await tx
        .delete(reactors)
        .where(inArray(reactors.id, createdIds.reactors));
      await tx
        .delete(facilities)
        .where(inArray(facilities.id, createdIds.facilities));
    }
    if (createdIds.feedstockTypes.length > 0) {
      await tx
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, createdIds.feedstockTypes));
    }
  });
});

describe("Sample side — anchor directly on the credit batch (issue #309)", () => {
  it("createSample links the sample to the given batch, with no run link", async () => {
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-DERIVE-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runDerive],
    });
    createdIds.creditBatches.push(batch.id);

    const sampleId = await makeSample(batch.id, `S-SL-DIRECT-${Date.now()}`);
    expect(await batchIdOfSample(sampleId)).toBe(batch.id);

    const [row] = await db
      .select({ productionRunId: samples.productionRunId })
      .from(samples)
      .where(eq(samples.id, sampleId));
    expect(row.productionRunId).toBeNull();
  });

  it("createSample rejects an unknown credit batch", async () => {
    await expect(
      createSample(TEST_USER_ID, {
        sampleCode: `S-SL-NOBATCH-${Date.now()}`,
        creditBatchId: "00000000-0000-4000-8000-000000000000",
        samplingTime: new Date("2025-06-15T10:00:00Z"),
        totalCarbonPercent: 80,
        organicCarbonPercent: 78,
      }),
    ).rejects.toThrow("Credit batch not found");
  });

  it("updateSample moves the sample to another batch", async () => {
    const batchA = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-MOVE-A-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runUpdate],
    });
    createdIds.creditBatches.push(batchA.id);

    const sampleId = await makeSample(batchA.id, `S-SL-MOVE-${Date.now()}`);
    expect(await batchIdOfSample(sampleId)).toBe(batchA.id);

    const batchB = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-MOVE-B-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runMoveB],
    });
    createdIds.creditBatches.push(batchB.id);

    await updateSample(TEST_USER_ID, sampleId, { creditBatchId: batchB.id });
    expect(await batchIdOfSample(sampleId)).toBe(batchB.id);
  });
});

describe("Batch side — back-fill and re-point LEGACY run-linked samples", () => {
  it("createCreditBatch back-fills a pre-existing legacy sample on its member run", async () => {
    // Legacy sample created BEFORE the batch exists → starts unlinked.
    const sampleId = await insertLegacySample(
      runBackfill,
      `S-SL-BACKFILL-${Date.now()}`,
    );
    expect(await batchIdOfSample(sampleId)).toBeNull();

    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-BACKFILL-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runBackfill],
    });
    createdIds.creditBatches.push(batch.id);

    // Forming the batch links the run's existing sample to it.
    expect(await batchIdOfSample(sampleId)).toBe(batch.id);
  });

  it("updateCreditBatch unlinks a removed run's legacy sample and links an added run's", async () => {
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-REPOINT-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runReA, runReB],
    });
    createdIds.creditBatches.push(batch.id);

    const sampleA = await insertLegacySample(
      runReA,
      `S-SL-REA-${Date.now()}`,
      batch.id,
    );
    const sampleB = await insertLegacySample(
      runReB,
      `S-SL-REB-${Date.now()}`,
      batch.id,
    );
    // A pre-existing unlinked legacy sample on a run NOT yet in the batch.
    const sampleC = await insertLegacySample(runReC, `S-SL-REC-${Date.now()}`);
    expect(await batchIdOfSample(sampleA)).toBe(batch.id);
    expect(await batchIdOfSample(sampleB)).toBe(batch.id);
    expect(await batchIdOfSample(sampleC)).toBeNull();

    // Drop runReB, add runReC.
    await updateCreditBatch(TEST_USER_ID, batch.id, {
      productionRunIds: [runReA, runReC],
    });

    expect(await batchIdOfSample(sampleA)).toBe(batch.id); // kept
    expect(await batchIdOfSample(sampleB)).toBeNull(); // removed run → unlinked
    expect(await batchIdOfSample(sampleC)).toBe(batch.id); // added run → linked
  });
});
