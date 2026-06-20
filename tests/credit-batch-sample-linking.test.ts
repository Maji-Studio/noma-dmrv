/**
 * DB-backed tests for the credit-batch ↔ lab-sample linking write paths
 * (ADR 0015: a Sample characterises the credit batch its run belongs to, and
 * BOTH links stay populated). Two derivation/back-fill paths must keep
 * `samples.creditBatchId` consistent with run membership:
 *
 *   1. Sample side — `createSample`/`updateSample` derive `creditBatchId` from
 *      the run's batch membership when not set explicitly (the form never sets
 *      it). Null for an uncommitted run.
 *   2. Batch side — `createCreditBatch`/`updateCreditBatch` back-fill the member
 *      runs' existing samples onto the batch, and re-point (unlink removed runs'
 *      samples, link added runs') on a membership change.
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
import { resolveRunCreditBatchId } from "@/data-access/credit-batch-samples";

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
// Six independent runs (all single-feedstock, in the June window) so each test
// owns its own runs — a run belongs to at most one batch (unique constraint).
let runDerive: string;
let runUncommitted: string;
let runBackfill: string;
let runReA: string;
let runReB: string;
let runReC: string;
let runUpdate: string;

const baseBatchData = {
  startDate: new Date("2025-06-01"),
  endDate: new Date("2025-06-30"),
  certifier: "isometric" as const,
  durabilityOption: "200_year" as const,
  hToCorgRatio: 0.4,
  currency: "TZS" as const,
};

async function makeSample(
  runId: string,
  code: string,
  overrides: { hToCOrgRatio?: number; oToCOrgRatio?: number } = {},
): Promise<string> {
  const sample = await createSample(TEST_USER_ID, {
    sampleCode: code,
    productionRunId: runId,
    samplingTime: new Date("2025-06-15T10:00:00Z"),
    totalCarbonPercent: 80,
    organicCarbonPercent: 78,
    ...overrides,
  });
  createdIds.samples.push(sample.id);
  return sample.id;
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
      ["derive", "uncommitted", "backfill", "reA", "reB", "reC", "update"].map(
        (tag, i) => ({
          code: `PR-SL-${tag}-${runId}`,
          facilityId,
          reactorId: reactor.id,
          date: `2025-06-1${i}`,
          startTime: new Date(`2025-06-1${i}T08:00:00Z`),
          endTime: new Date(`2025-06-1${i}T12:00:00Z`),
          biocharDryMassKg: 4000,
        }),
      ),
    )
    .returning({ id: productionRuns.id });
  [runDerive, runUncommitted, runBackfill, runReA, runReB, runReC, runUpdate] =
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

describe("resolveRunCreditBatchId", () => {
  it("returns null for an uncommitted run", async () => {
    expect(await resolveRunCreditBatchId(db, runUncommitted)).toBeNull();
  });

  it("returns null for a null run id", async () => {
    expect(await resolveRunCreditBatchId(db, null)).toBeNull();
  });
});

describe("Sample side — derive creditBatchId from the run's batch", () => {
  it("createSample derives the batch when the run is already committed", async () => {
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-DERIVE-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runDerive],
    });
    createdIds.creditBatches.push(batch.id);

    expect(await resolveRunCreditBatchId(db, runDerive)).toBe(batch.id);

    const sampleId = await makeSample(runDerive, `S-SL-DERIVE-${Date.now()}`);
    expect(await batchIdOfSample(sampleId)).toBe(batch.id);
  });

  it("createSample leaves creditBatchId null for an uncommitted run", async () => {
    const sampleId = await makeSample(
      runUncommitted,
      `S-SL-UNCOMMITTED-${Date.now()}`,
    );
    expect(await batchIdOfSample(sampleId)).toBeNull();
  });

  it("updateSample re-derives the batch when the sample's run changes", async () => {
    // A sample created on an uncommitted run (null link).
    const sampleId = await makeSample(
      runUncommitted,
      `S-SL-MOVE-${Date.now()}`,
    );
    expect(await batchIdOfSample(sampleId)).toBeNull();

    // A batch on a different run; moving the sample to it must re-derive the link.
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-UPDATE-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runUpdate],
    });
    createdIds.creditBatches.push(batch.id);

    await updateSample(TEST_USER_ID, sampleId, { productionRunId: runUpdate });
    expect(await batchIdOfSample(sampleId)).toBe(batch.id);
  });
});

describe("Batch side — back-fill and re-point member runs' samples", () => {
  it("createCreditBatch back-fills a pre-existing sample on its member run", async () => {
    // Sample created BEFORE the batch exists → starts unlinked.
    const sampleId = await makeSample(
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

  it("updateCreditBatch unlinks a removed run's sample and links an added run's sample", async () => {
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: `CB-SL-REPOINT-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runReA, runReB],
    });
    createdIds.creditBatches.push(batch.id);

    const sampleA = await makeSample(runReA, `S-SL-REA-${Date.now()}`);
    const sampleB = await makeSample(runReB, `S-SL-REB-${Date.now()}`);
    // A pre-existing unlinked sample on a run NOT yet in the batch.
    const sampleC = await makeSample(runReC, `S-SL-REC-${Date.now()}`);
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
