import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";
import { labLogisticsVersion } from "./helpers/lab-logistics-version";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed tests for the credit-batch ↔ lab-sample linking write paths.
 * Since issue #309 a Sample anchors on ONE credit batch directly — the batch's
 * biochar is commingled across runs, so `createSample` requires
 * `creditBatchId` and never takes a production run. Two paths must keep
 * `samples.creditBatchId` consistent:
 *
 *   1. Sample side — `createSample` links the given batch (and rejects an
 *      unknown one); `updateSample` can move a sample to another batch.
 *   2. Membership edits preserve the Sample's batch attachment.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test
 * defaults), mirroring tests/credit-batch-validation.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
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
let runReA: string;
let runReB: string;
let runUpdate: string;
let runMoveB: string;
// A spare run on the MAIN (200-year) facility — the "move from" batch in the
// 1000-year guard block must be a 200-year batch (ADR 0021).
let runTierFrom: string;

const baseBatchData = {
  startDate: new Date("2025-06-01"),
  endDate: new Date("2025-06-30"),
  certifier: "isometric" as const,
  // Durability tier is inherited from the facility (ADR 0021), no longer a batch
  // field — the main test facility is explicitly 200-year below.
  // Feedstock type is now DECLARED (ADR 0016 amendment) and guarded against the
  // member runs. Set in beforeAll to the single seeded type all runs share.
  feedstockTypeId: "",
};

function batchDataForMonth(month: string) {
  const startDate = new Date(`${month}-01T00:00:00.000Z`);
  const endDate = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0),
  );
  return { ...baseBatchData, startDate, endDate };
}

/** Create a sample through the write path — anchored on a credit batch. */
async function makeSample(
  creditBatchId: string,
  code: string,
): Promise<string> {
  const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
    sampleCode: code,
    creditBatchId,
    samplingTime: new Date("2025-06-15T10:00:00Z"),
    totalCarbonPercent: 80,
    organicCarbonPercent: 78,
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

beforeAll(() => ensureTestOrg());

beforeAll(async () => {
  const runId = Date.now().toString(36);

  const [facility] = await db
    .insert(facilities)
    .values({ timezone: "UTC",
      organizationId: TEST_ORG_ID,
      name: `Sample-Link Facility ${runId}`,
      code: `FAC-SL-${runId}`,
      // Explicit 200-year: the base/derive/move tests create samples without R₀,
      // which the 1000-year intake guard would reject (ADR 0021).
      durabilityOption: "200_year",
    })
    .returning({ id: facilities.id });
  facilityId = facility.id;
  createdIds.facilities.push(facility.id);

  const [reactor] = await db
    .insert(reactors)
    .values({
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
      name: `Sample-Link Woodchips ${runId}`,
      code: `FT-SL-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  createdIds.feedstockTypes.push(feedstockType.id);
  baseBatchData.feedstockTypeId = feedstockType.id;

  const [feedstock] = await db
    .insert(feedstocks)
    .values(await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID,
      code: `FS-SL-${runId}`,
      facilityId,
      feedstockTypeId: feedstockType.id,
      massDryKg: 9000,
    }))
    .returning({ id: feedstocks.id });
  createdIds.feedstocks.push(feedstock.id);

  const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, facilityId);
  const runRows = await db
    .insert(productionRuns)
    .values(
      [
        ["derive", "2025-01-15"],
        ["reA", "2025-06-10"],
        ["reB", "2025-06-11"],
        ["update", "2025-02-15"],
        ["moveB", "2025-03-15"],
        ["tierFrom", "2025-04-15"],
      ].map(([tag, date]) => ({
        organizationId: TEST_ORG_ID,
        code: `PR-SL-${tag}-${runId}`,
        facilityId,
        status: "complete" as const,
        reactorId: reactor.id,
        startTime: new Date(`${date}T08:00:00Z`),
        endTime: new Date(`${date}T12:00:00Z`),
        biocharStorageLocationId: outputBinId, biocharMoisturePercent: 0,
        biocharDryMassKg: 4000,
      })),
    )
    .returning({ id: productionRuns.id });
  [
    runDerive,
    runReA,
    runReB,
    runUpdate,
    runMoveB,
    runTierFrom,
  ] = runRows.map((r) => r.id);
  createdIds.productionRuns.push(...runRows.map((r) => r.id));

  // Every run needs a single-feedstock link for createCreditBatch's derivation.
  await db.insert(productionRunFeedstocks).values(
    createdIds.productionRuns.map((productionRunId) => ({
      organizationId: TEST_ORG_ID,
      productionRunId,
      feedstockId: feedstock.id,
      wetMassUsedKg: 400,
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
      await cleanupFeedstockFixtureParents(tx);
    }
    if (createdIds.facilities.length > 0) {
      await tx.delete(storageLocations).where(inArray(storageLocations.facilityId, createdIds.facilities));
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
  await cleanupFeedstockFixtureParents(db);
});


describe("Sample side — anchor directly on the credit batch (issue #309)", () => {
  it("createSample links the sample to the given batch, with no run link", async () => {
    const batch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...batchDataForMonth("2025-01"),
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
      createSample(makeTestOrgContext(TEST_USER_ID), {
        sampleCode: `S-SL-NOBATCH-${Date.now()}`,
        creditBatchId: "00000000-0000-4000-8000-000000000000",
        samplingTime: new Date("2025-06-15T10:00:00Z"),
        totalCarbonPercent: 80,
        organicCarbonPercent: 78,
      }),
    ).rejects.toThrow(
      // The writer reads the batch under its lock; the Server Action always showed this copy
      // ("Credit batch not found", as SafeError normalizes it).
      "Credit batch was not found.",
    );
  });

  it("updateSample moves the sample to another batch", async () => {
    const batchA = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...batchDataForMonth("2025-02"),
      code: `CB-SL-MOVE-A-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runUpdate],
    });
    createdIds.creditBatches.push(batchA.id);

    const sampleId = await makeSample(batchA.id, `S-SL-MOVE-${Date.now()}`);
    expect(await batchIdOfSample(sampleId)).toBe(batchA.id);

    const batchB = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...batchDataForMonth("2025-03"),
      code: `CB-SL-MOVE-B-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runMoveB],
    });
    createdIds.creditBatches.push(batchB.id);

    await updateSample(makeTestOrgContext(TEST_USER_ID), sampleId, { expectedVersion: await labLogisticsVersion(makeTestOrgContext(TEST_USER_ID), "samples", sampleId), creditBatchId: batchB.id });
    expect(await batchIdOfSample(sampleId)).toBe(batchB.id);
  });
});

describe("Server-side 1000-year evidence guard — batch tier is source of truth (PR #336)", () => {
  let tier1000BatchId: string;
  let fromBatchId: string;

  beforeAll(async () => {
    const suffix = Date.now().toString(36);

    // The tier is now facility-scoped (ADR 0021), so this guard block runs under
    // its OWN 1000-year facility (with dedicated reactor/feedstock/runs); the
    // main test facility is 200-year. Both batches here inherit 1000-year.
    const [tier1000Facility] = await db
      .insert(facilities)
      .values({ timezone: "UTC",
        organizationId: TEST_ORG_ID,
        name: `Sample-Link 1000yr Facility ${suffix}`,
        code: `FAC-SL-K-${suffix}`,
        durabilityOption: "1000_year",
      })
      .returning({ id: facilities.id });
    createdIds.facilities.push(tier1000Facility.id);

    const [tier1000Reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RE-SL-K-${suffix}`,
        facilityId: tier1000Facility.id,
        identifier: "Sample-Link 1000yr Reactor",
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });
    createdIds.reactors.push(tier1000Reactor.id);

    const [tier1000Feedstock] = await db
      .insert(feedstocks)
      .values(await feedstockFixtureValues(db, {
        organizationId: TEST_ORG_ID,
        code: `FS-SL-K-${suffix}`,
        facilityId: tier1000Facility.id,
        feedstockTypeId: baseBatchData.feedstockTypeId,
        massDryKg: 9000,
      }))
      .returning({ id: feedstocks.id });
    createdIds.feedstocks.push(tier1000Feedstock.id);

    const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, tier1000Facility.id);
    const [kRun] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-SL-k-tier1000-${suffix}`,
        facilityId: tier1000Facility.id,
        status: "complete",
        biocharStorageLocationId: outputBinId, biocharMoisturePercent: 0,
        reactorId: tier1000Reactor.id,
        startTime: new Date("2025-06-20T08:00:00Z"),
        endTime: new Date("2025-06-20T12:00:00Z"),
        biocharDryMassKg: 4000,
      })
      .returning({ id: productionRuns.id });
    createdIds.productionRuns.push(kRun.id);
    await db.insert(productionRunFeedstocks).values({
      organizationId: TEST_ORG_ID,
      productionRunId: kRun.id,
      feedstockId: tier1000Feedstock.id,
      wetMassUsedKg: 400,
    });

    const tier1000Batch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...baseBatchData,
      code: `CB-SL-T1000-${suffix}`,
      facilityId: tier1000Facility.id,
      productionRunIds: [kRun.id],
    });
    tier1000BatchId = tier1000Batch.id;
    createdIds.creditBatches.push(tier1000Batch.id);

    // The "move from" batch is 200-year — created on the MAIN facility so an
    // evidence-less sample can be created on it before the move-onto-1000-year
    // update is rejected.
    const fromBatch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...batchDataForMonth("2025-04"),
      code: `CB-SL-TFROM-${suffix}`,
      facilityId,
      productionRunIds: [runTierFrom],
    });
    fromBatchId = fromBatch.id;
    createdIds.creditBatches.push(fromBatch.id);
  });

  /** A replicate carrying the full 1000-year evidence set. */
  function completeEvidence() {
    return {
      samplingTime: new Date("2025-06-15T10:00:00Z"),
      totalCarbonPercent: 80,
      organicCarbonPercent: 78,
      randomReflectanceR0Percent: 2.1,
      sReflectanceFraction: 0.92,
      residualCarbonPercent: 65,
    };
  }

  it("createSample allows missing mean R₀ and TGA on a 1000-year batch", async () => {
    const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
      sampleCode: `S-SL-OPTIONAL-${Date.now()}`,
      creditBatchId: tier1000BatchId,
      samplingTime: new Date("2025-06-15T10:00:00Z"),
      totalCarbonPercent: 80,
      organicCarbonPercent: 78,
    });
    createdIds.samples.push(sample.id);
    expect(sample.randomReflectanceR0Percent).toBeNull();
    expect(sample.residualCarbonPercent).toBeNull();
  });

  it("createSample accepts a 1000-year batch sample carrying R₀ + TGA evidence", async () => {
    const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
      sampleCode: `S-SL-T1000-OK-${Date.now()}`,
      creditBatchId: tier1000BatchId,
      ...completeEvidence(),
    });
    createdIds.samples.push(sample.id);
    expect(await batchIdOfSample(sample.id)).toBe(tier1000BatchId);
    expect(sample.sReflectanceFraction).toBe(0.92);
  });

  it("createSample saves a 1000-year batch sample missing s_fraction", async () => {
    const action = createSample(makeTestOrgContext(TEST_USER_ID), {
      sampleCode: `S-SL-NO-S-FRACTION-${Date.now()}`,
      creditBatchId: tier1000BatchId,
      samplingTime: new Date("2025-06-15T10:00:00Z"),
      totalCarbonPercent: 80,
      organicCarbonPercent: 78,
      randomReflectanceR0Percent: 2.1,
      residualCarbonPercent: 65,
    }).then((sample) => {
      createdIds.samples.push(sample.id);
      return sample;
    });
    await expect(action).resolves.toMatchObject({ creditBatchId: tier1000BatchId, sReflectanceFraction: null });
  });

  it("updateSample allows moving a Sample without optional evidence onto a 1000-year batch", async () => {
    const sampleId = await makeSample(fromBatchId, `S-SL-TMOVE-${Date.now()}`);
    await expect(
      updateSample(makeTestOrgContext(TEST_USER_ID), sampleId, { expectedVersion: await labLogisticsVersion(makeTestOrgContext(TEST_USER_ID), "samples", sampleId), creditBatchId: tier1000BatchId }),
    ).resolves.toBeDefined();
    expect(await batchIdOfSample(sampleId)).toBe(tier1000BatchId);
  });

  it("updateSample allows clearing mean R₀ on a 1000-year batch Sample", async () => {
    const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
      sampleCode: `S-SL-TNULL-${Date.now()}`,
      creditBatchId: tier1000BatchId,
      ...completeEvidence(),
    });
    createdIds.samples.push(sample.id);

    await expect(
      updateSample(makeTestOrgContext(TEST_USER_ID), sample.id, { expectedVersion: await labLogisticsVersion(makeTestOrgContext(TEST_USER_ID), "samples", sample.id),
        randomReflectanceR0Percent: null,
      }),
    ).resolves.toBeDefined();
  });

  it("updateSample still allows unrelated edits on a compliant 1000-year batch sample", async () => {
    const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
      sampleCode: `S-SL-TEDIT-${Date.now()}`,
      creditBatchId: tier1000BatchId,
      ...completeEvidence(),
    });
    createdIds.samples.push(sample.id);

    const updated = await updateSample(makeTestOrgContext(TEST_USER_ID), sample.id, { expectedVersion: await labLogisticsVersion(makeTestOrgContext(TEST_USER_ID), "samples", sample.id),
      labName: "Tier Lab",
    });
    expect(updated.labName).toBe("Tier Lab");
  });

  it("updateSample persists a changed s_fraction", async () => {
    const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
      sampleCode: `S-SL-T-S-FRACTION-${Date.now()}`,
      creditBatchId: tier1000BatchId,
      ...completeEvidence(),
    });
    createdIds.samples.push(sample.id);
    const updated = await updateSample(makeTestOrgContext(TEST_USER_ID), sample.id, { expectedVersion: await labLogisticsVersion(makeTestOrgContext(TEST_USER_ID), "samples", sample.id),
      sReflectanceFraction: 0.94,
    });
    expect(updated.sReflectanceFraction).toBe(0.94);
  });
});

describe("Batch membership preserves sample attachment", () => {
  it("keeps batch Samples when the member runs change", async () => {
    const batch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...batchDataForMonth("2025-06"),
      code: `CB-SL-PRESERVE-${Date.now().toString(36)}`,
      facilityId,
      productionRunIds: [runReA, runReB],
    });
    createdIds.creditBatches.push(batch.id);
    const sampleId = await makeSample(batch.id, `S-SL-PRESERVE-${Date.now()}`);
    await updateCreditBatch(makeTestOrgContext(TEST_USER_ID), batch.id, {
      expectedVersion: await labLogisticsVersion(makeTestOrgContext(TEST_USER_ID), "creditBatches", batch.id),
      productionRunIds: [],
    });
    expect(await batchIdOfSample(sampleId)).toBe(batch.id);
  });
});
