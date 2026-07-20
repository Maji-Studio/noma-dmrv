import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed concurrency tests for DB-enforced sample_code uniqueness
 * (issue #395). The `samples_sample_code_unique` index is the sole
 * arbiter — the racy application-level pre-checks were removed:
 *
 *   1. Two concurrent creates racing the SAME explicit code (routed through
 *      `withAutoCode`, exactly as the sample server action does) → one commit,
 *      one friendly duplicate error, never a raw driver error.
 *   2. Two concurrent AUTO-code creates → both commit with DISTINCT codes,
 *      because `withAutoCode` retries the loser of the code-suffix race.
 *
 * Requires a running database (DATABASE_URL from .env.test / test defaults),
 * mirroring tests/credit-batch-sample-linking.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
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
import { createCreditBatch } from "@/data-access/credit-batches";
import { createSample, updateSample } from "@/data-access/samples";
import { withAutoCode } from "@/data-access/code-generator";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000395";

const createdIds = {
  facilities: [] as string[],
  reactors: [] as string[],
  feedstockTypes: [] as string[],
  feedstocks: [] as string[],
  productionRuns: [] as string[],
  creditBatches: [] as string[],
  samples: [] as string[],
};

let batchId: string;

/** One concurrent create, routed through `withAutoCode` like the server action. */
function createConcurrentSample(
  userCode: string | undefined,
): Promise<{ id: string; sampleCode: string }> {
  return withAutoCode(
    makeTestOrgContext(TEST_USER_ID),
    "SAM",
    samples,
    samples.sampleCode,
    userCode,
    async (sampleCode) => {
      const sample = await createSample(makeTestOrgContext(TEST_USER_ID), {
        sampleCode,
        creditBatchId: batchId,
        samplingTime: new Date("2025-06-15T10:00:00Z"),
        totalCarbonPercent: 80,
        organicCarbonPercent: 78,
      });
      createdIds.samples.push(sample.id);
      return { id: sample.id, sampleCode: sample.sampleCode };
    },
  );
}

beforeAll(() => ensureTestOrg());

beforeAll(async () => {
  const suffix = Date.now().toString(36);

  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Sample-Code Facility ${suffix}`,
      code: `FAC-SC-${suffix}`,
      durabilityOption: "200_year",
    })
    .returning({ id: facilities.id });
  createdIds.facilities.push(facility.id);

  const [reactor] = await db
    .insert(reactors)
    .values({
      organizationId: TEST_ORG_ID,
      code: `RE-SC-${suffix}`,
      facilityId: facility.id,
      identifier: "Sample-Code Reactor",
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });
  createdIds.reactors.push(reactor.id);

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Sample-Code Woodchips ${suffix}`,
      code: `FT-SC-${suffix}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  createdIds.feedstockTypes.push(feedstockType.id);

  const [feedstock] = await db
    .insert(feedstocks)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FS-SC-${suffix}`,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      massDryKg: 9000,
    })
    .returning({ id: feedstocks.id });
  createdIds.feedstocks.push(feedstock.id);

  const [run] = await db
    .insert(productionRuns)
    .values({
      organizationId: TEST_ORG_ID,
      code: `PR-SC-${suffix}`,
      facilityId: facility.id,
      status: "complete",
      reactorId: reactor.id,
      startTime: new Date("2025-06-10T08:00:00Z"),
      endTime: new Date("2025-06-10T12:00:00Z"),
      biocharDryMassKg: 4000,
    })
    .returning({ id: productionRuns.id });
  createdIds.productionRuns.push(run.id);

  await db.insert(productionRunFeedstocks).values({
    organizationId: TEST_ORG_ID,
    productionRunId: run.id,
    feedstockId: feedstock.id,
    massUsedKg: 400,
  });

  const batch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
    code: `CB-SC-${suffix}`,
    facilityId: facility.id,
    productionRunIds: [run.id],
    startDate: new Date("2025-06-01"),
    endDate: new Date("2025-06-30"),
    hToCorgRatio: 0.4,
    currency: "TZS",
    feedstockTypeId: feedstockType.id,
  });
  batchId = batch.id;
  createdIds.creditBatches.push(batch.id);
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


describe("sample_code uniqueness is DB-enforced (issue #395)", () => {
  it("two concurrent creates with the same explicit code → one success, one safe duplicate error", async () => {
    const explicitCode = `S-DUP-395-${Date.now()}`;

    const results = await Promise.allSettled([
      createConcurrentSample(explicitCode),
      createConcurrentSample(explicitCode),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Friendly, non-raw error — no leaked SQLSTATE / driver text.
    const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
    expect(reason.message).toMatch(/already exists/i);
    expect(reason.message).not.toMatch(/duplicate key|23505|constraint/i);
  });

  it("two concurrent auto-code creates → both succeed with distinct codes", async () => {
    const results = await Promise.all([
      createConcurrentSample(undefined),
      createConcurrentSample(undefined),
      createConcurrentSample(undefined),
    ]);

    const codes = results.map((r) => r.sampleCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^SAM-\d{2}-\d{3,}$/);
    }
  });
});

describe("updateSample reconciles carbon against the stored state (QA 2026-07-20)", () => {
  it("rejects a partial update whose effective organic carbon exceeds the stored total", async () => {
    // Seeded with totalCarbonPercent 80 / organicCarbonPercent 78; patching
    // only the organic value must be validated against the STORED total —
    // the update schema alone cannot see it.
    const { id } = await createConcurrentSample(undefined);

    await expect(
      updateSample(makeTestOrgContext(TEST_USER_ID), id, {
        organicCarbonPercent: 95,
      }),
    ).rejects.toThrow(/Organic carbon cannot exceed total carbon/);
  });

  it("rejects when all three carbon keys are explicitly present but undefined for the unrelated ones (mirrors the real fn payload shape)", async () => {
    // Regression pin for the P1 fix: src/fn/samples.ts always spells out all
    // three carbon keys on the object passed to updateSample, even when a
    // value is undefined for that call. A `"key" in data` check is therefore
    // always true and must not be reintroduced — this uses `!== undefined`
    // semantics that must still fall back to the stored total.
    const { id } = await createConcurrentSample(undefined);
    await expect(
      updateSample(makeTestOrgContext(TEST_USER_ID), id, {
        totalCarbonPercent: undefined,
        organicCarbonPercent: 95,
        inorganicCarbonPercent: undefined,
      }),
    ).rejects.toThrow(/Organic carbon cannot exceed total carbon/);
  });

  it("accepts a partial update that stays reconciled with the stored total", async () => {
    const { id } = await createConcurrentSample(undefined);

    const updated = await updateSample(makeTestOrgContext(TEST_USER_ID), id, {
      organicCarbonPercent: 75,
    });
    expect(updated.organicCarbonPercent).toBe(75);
  });

  // The organic + inorganic branch was previously unexercised: every case above
  // patches organic alone and asserts the first branch's message, so a flipped
  // sum or a dropped `inorganic != null` short-circuit would go unnoticed.
  // Seeded with total 80 / organic 78, so inorganic 5 puts the sum at 83.
  it("rejects when stored organic plus patched inorganic exceeds the stored total", async () => {
    const { id } = await createConcurrentSample(undefined);

    await expect(
      updateSample(makeTestOrgContext(TEST_USER_ID), id, {
        inorganicCarbonPercent: 5,
      }),
    ).rejects.toThrow(
      /Organic plus inorganic carbon cannot exceed total carbon/,
    );
  });

  it("accepts an explicit null inorganic patch (the null short-circuit)", async () => {
    const { id } = await createConcurrentSample(undefined);

    const updated = await updateSample(makeTestOrgContext(TEST_USER_ID), id, {
      inorganicCarbonPercent: null,
    });
    expect(updated.inorganicCarbonPercent).toBeNull();
  });
});
