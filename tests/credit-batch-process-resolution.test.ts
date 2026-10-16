import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, count, eq, inArray } from "drizzle-orm";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { db } from "@/db";
import { activityEvents, certifierCredentials, certifierProjects, creditBatches, facilities, feedstockTypes, organizations, productionProcesses, samples } from "@/db/schema";
import { createCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { findOrCreateProductionProcess, getMethodBEligibility } from "@/data-access/production-processes";
import { countEligibleSamplesByProcess } from "@/data-access/isometric";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const ctx = { ...makeTestOrgContext(), organizationId: `org_process_epochs_${crypto.randomUUID()}` };
const EARLIEST_EPOCH = new Date("2025-01-01T00:00:00Z");
const MIDDLE_EPOCH = new Date("2025-06-01T00:00:00Z");
const LATEST_EPOCH = new Date("2025-09-01T00:00:00Z");
const ELIGIBILITY_NOW = new Date("2026-10-16T12:00:00Z");
const FUTURE_SAMPLE_TIME = new Date("2026-10-17T12:00:00Z");

describe("credit batch production-process resolution", () => {
  let facilityId: string;
  let feedstockTypeId: string;
  let earliestProcessId: string;
  let middleProcessId: string;
  let latestProcessId: string;
  let tag: string;
  const facilityIds: string[] = [];
  const feedstockTypeIds: string[] = [];

  beforeEach(async () => {
    await db.insert(organizations).values({ id: ctx.organizationId, name: "Process epochs", slug: ctx.organizationId });
    tag = crypto.randomUUID();
    const [facility] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION, organizationId: ctx.organizationId, timezone: "UTC",
      code: `FAC-EPOCH-${tag}`, name: `Process epochs ${tag}`,
    }).returning();
    facilityId = facility.id;
    facilityIds.push(facilityId);
    const [feedstockType] = await db.insert(feedstockTypes).values({
      organizationId: ctx.organizationId, code: `FT-EPOCH-${tag}`,
      name: `Process epochs ${tag}`, category: "forestry", usage: "pyrolysis",
    }).returning();
    feedstockTypeId = feedstockType.id;
    feedstockTypeIds.push(feedstockTypeId);
    // Insert out of epoch order so row-creation time cannot define the interval.
    const processes = await db.insert(productionProcesses).values(
      [LATEST_EPOCH, EARLIEST_EPOCH, MIDDLE_EPOCH].map(establishedAt => ({
        organizationId: ctx.organizationId, facilityId, feedstockTypeId, establishedAt,
      })),
    ).returning();
    earliestProcessId = processes.find(process => process.establishedAt.getTime() === EARLIEST_EPOCH.getTime())!.id;
    middleProcessId = processes.find(process => process.establishedAt.getTime() === MIDDLE_EPOCH.getTime())!.id;
    latestProcessId = processes.find(process => process.establishedAt.getTime() === LATEST_EPOCH.getTime())!.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (facilityIds.length) {
      await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), inArray(activityEvents.facilityId, facilityIds)));
      await db.delete(samples).where(and(eq(samples.organizationId, ctx.organizationId), inArray(samples.creditBatchId,
        db.select({ id: creditBatches.id }).from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.facilityId, facilityIds))),
      )));
      await db.delete(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.facilityId, facilityIds)));
      await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, ctx.organizationId), inArray(productionProcesses.facilityId, facilityIds)));
      await db.delete(certifierProjects).where(and(eq(certifierProjects.organizationId, ctx.organizationId), inArray(certifierProjects.facilityId, facilityIds)));
      await db.delete(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), inArray(facilities.id, facilityIds)));
      facilityIds.length = 0;
    }
    if (feedstockTypeIds.length) {
      await db.delete(feedstockTypes).where(and(eq(feedstockTypes.organizationId, ctx.organizationId), inArray(feedstockTypes.id, feedstockTypeIds)));
      feedstockTypeIds.length = 0;
    }
    await db.delete(certifierCredentials).where(eq(certifierCredentials.organizationId, ctx.organizationId));
    await db.delete(organizations).where(eq(organizations.id, ctx.organizationId));
  });

  function create(startDate: Date) {
    return createCreditBatch(ctx, {
      facilityId, feedstockTypeId, code: `CB-EPOCH-${tag}`, productionRunIds: [],
      startDate, endDate: startDate,
    });
  }

  function insertSamples(creditBatchId: string, samplingTimes: Date[]) {
    return db.insert(samples).values(samplingTimes.map((samplingTime, index) => ({
      organizationId: ctx.organizationId, creditBatchId, samplingTime,
      sampleCode: `S-EPOCH-${creditBatchId}-${index}`, totalCarbonPercent: 80, organicCarbonPercent: 78,
    }))).returning();
  }

  it("previews A's eligibility for an A-era date after an ineligible B is established", async () => {
    await db.update(productionProcesses).set({
      agreedBaselineSize: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      randomSamplingPlanRef: "Agreed sampling plan", moisturePathway: "measured_every_batch",
    }).where(and(eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.id, earliestProcessId)));
    const batch = await create(new Date("2025-02-01T00:00:00Z"));
    await insertSamples(batch.id, Array.from({ length: METHOD_B_MINIMUM_METHOD_A_SAMPLES }, () => new Date("2025-02-15T12:00:00Z")));

    expect(await getMethodBEligibility(ctx, {
      facilityId, feedstockTypeId, batchStartDate: new Date("2025-03-01T00:00:00Z"),
    })).toMatchObject({
      productionProcessId: earliestProcessId, eligibleSampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      prerequisitesRecorded: true, unsampledAllowed: true,
    });
    expect(await getMethodBEligibility(ctx, { facilityId, feedstockTypeId })).toMatchObject({
      productionProcessId: latestProcessId, eligibleSampleCount: 0, unsampledAllowed: false,
    });
  });

  it.each([
    ["current-month", "2026-10-01", "2026-09-01", "2026-10-10T12:00:00Z", "latest"],
    ["back-entered", "2025-03-01", "2025-02-01", "2025-04-15T12:00:00Z", "earliest"],
  ] as const)("agrees on preview and save eligibility for a %s batch using Samples up to now", async (_label, startDay, baselineDay, sampleTime, epoch) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ELIGIBILITY_NOW);
    const processId = epoch === "earliest" ? earliestProcessId : latestProcessId;
    await db.insert(certifierProjects).values({
      organizationId: ctx.organizationId, facilityId, provider: "isometric",
      externalProjectId: `project-${tag}`, externalFacilityId: `facility-${tag}`,
    });
    await db.insert(certifierCredentials).values({
      organizationId: ctx.organizationId, provider: "isometric",
      accessTokenEncrypted: "unused-test-placeholder", clientSecretEncrypted: "unused-test-placeholder",
    });
    await db.update(productionProcesses).set({
      agreedBaselineSize: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      randomSamplingPlanRef: "Agreed sampling plan", moisturePathway: "measured_every_batch",
    }).where(and(eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.id, processId)));
    const baselineBatch = await create(new Date(baselineDay));
    const baselineSamples = await insertSamples(baselineBatch.id, [
      ...Array.from({ length: METHOD_B_MINIMUM_METHOD_A_SAMPLES - 1 }, () => new Date(sampleTime)),
      FUTURE_SAMPLE_TIME,
    ]);
    const batchStartDate = new Date(startDay);
    const input = {
      facilityId, feedstockTypeId, code: `CB-UNSAMPLED-${tag}`, productionRunIds: [],
      startDate: batchStartDate, endDate: batchStartDate, sampling: "unsampled" as const,
    };
    expect(await getMethodBEligibility(ctx, { facilityId, feedstockTypeId, batchStartDate })).toMatchObject({
      productionProcessId: processId, eligibleSampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES - 1,
      prerequisitesRecorded: true, unsampledAllowed: false,
    });
    await expect(createCreditBatch(ctx, input)).rejects.toThrow("qualifying Method-A Samples");

    await db.update(samples).set({ samplingTime: new Date(sampleTime) }).where(and(
      eq(samples.organizationId, ctx.organizationId), eq(samples.id, baselineSamples.at(-1)!.id),
    ));
    expect(await getMethodBEligibility(ctx, { facilityId, feedstockTypeId, batchStartDate })).toMatchObject({
      productionProcessId: processId, eligibleSampleCount: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      prerequisitesRecorded: true, unsampledAllowed: true,
    });
    expect(await createCreditBatch(ctx, input)).toMatchObject({ productionProcessId: processId, sampling: "unsampled" });
  });

  it("preserves Sample attachments and recomputes both process counts when a batch crosses an epoch", async () => {
    const [earliestBatch, middleBatch, movingBatch] = await db.insert(creditBatches).values([
      { startDate: "2025-04-01", endDate: "2025-04-30", productionProcessId: earliestProcessId, suffix: "A" },
      { startDate: "2025-06-21", endDate: "2025-06-30", productionProcessId: middleProcessId, suffix: "B" },
      { startDate: "2025-06-10", endDate: "2025-06-20", productionProcessId: middleProcessId, suffix: "MOVE" },
    ].map(({ suffix, ...batch }) => ({
      ...batch, organizationId: ctx.organizationId, facilityId, feedstockTypeId,
      code: `CB-EPOCH-${suffix}-${tag}`, sampling: "sampled" as const,
    }))).returning();
    await insertSamples(earliestBatch.id, [new Date("2025-04-15T12:00:00Z")]);
    await insertSamples(middleBatch.id, [new Date("2025-06-26T12:00:00Z")]);
    const movingSamples = await insertSamples(movingBatch.id, [
      new Date("2025-05-25T12:00:00Z"), new Date("2025-06-15T12:00:00Z"),
    ]);
    const asOfDate = new Date("2025-07-01T00:00:00Z");

    async function expectCounts(sampleCounts: number[], eligibleCounts: number[]) {
      const counts = await db.select({ processId: creditBatches.productionProcessId, sampleCount: count(samples.id) })
        .from(samples).innerJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
        .where(and(eq(samples.organizationId, ctx.organizationId), eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)))
        .groupBy(creditBatches.productionProcessId);
      const sampleCountsByProcess = new Map(counts.map(row => [row.processId, row.sampleCount]));
      const eligibleCountsByProcess = await countEligibleSamplesByProcess(ctx, db, { facilityId, asOfDate });
      const processIds = [earliestProcessId, middleProcessId];
      expect(processIds.map(id => sampleCountsByProcess.get(id) ?? 0)).toEqual(sampleCounts);
      expect(processIds.map(id => eligibleCountsByProcess.get(id) ?? 0)).toEqual(eligibleCounts);
      const attached = await db.select({ id: samples.id, creditBatchId: samples.creditBatchId }).from(samples)
        .where(and(eq(samples.organizationId, ctx.organizationId), inArray(samples.id, movingSamples.map(sample => sample.id))));
      expect(attached).toHaveLength(movingSamples.length);
      expect(attached.every(sample => sample.creditBatchId === movingBatch.id)).toBe(true);
    }

    await expectCounts([1, 3], [1, 2]);
    const moved = await updateCreditBatch(ctx, movingBatch.id, {
      expectedVersion: movingBatch.version, startDate: new Date("2025-05-20T00:00:00Z"),
    });
    expect(moved).toMatchObject({ productionProcessId: earliestProcessId, sampling: "sampled" });
    await expectCounts([3, 1], [3, 1]);
    const restored = await updateCreditBatch(ctx, movingBatch.id, {
      expectedVersion: moved.version, startDate: MIDDLE_EPOCH,
    });
    expect(restored).toMatchObject({ productionProcessId: middleProcessId, sampling: "sampled" });
    await expectCounts([1, 3], [1, 2]);
  });

  it("attaches historical production to the epoch containing its start", async () => {
    const batch = await create(new Date("2025-03-01T00:00:00Z"));
    expect(batch.productionProcessId).toBe(earliestProcessId);
  });

  it("attaches production predating every epoch to the earliest process", async () => {
    const batch = await create(new Date("2024-12-01T00:00:00Z"));
    expect(batch.productionProcessId).toBe(earliestProcessId);
  });

  it.each([
    ["midnight", "2025-06-01T00:00:00Z"],
    ["same UTC day through an offset instant", "2025-05-31T23:30:00-02:00"],
  ])("keeps the previous process for a start day with a noon reset in preview, create and update (%s)", async (_label, start) => {
    await db.update(productionProcesses).set({ establishedAt: new Date("2025-06-01T12:00:00Z") }).where(and(
      eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.id, middleProcessId),
    ));
    const startDate = new Date(start);
    expect(await getMethodBEligibility(ctx, { facilityId, feedstockTypeId, batchStartDate: startDate })).toMatchObject({
      productionProcessId: earliestProcessId,
    });
    const batch = await create(startDate);
    expect(batch).toMatchObject({ startDate: "2025-06-01", productionProcessId: earliestProcessId });
    const previousDay = await updateCreditBatch(ctx, batch.id, {
      expectedVersion: batch.version, startDate: new Date("2025-05-31T00:00:00Z"),
    });
    expect(previousDay.productionProcessId).toBe(earliestProcessId);
    const updated = await updateCreditBatch(ctx, batch.id, { expectedVersion: previousDay.version, startDate });
    expect(updated.productionProcessId).toBe(earliestProcessId);
  });

  it.each([
    ["exact boundary", MIDDLE_EPOCH, "middle"],
    ["current start", new Date(), "latest"],
    ["future start", new Date("2030-01-01T00:00:00Z"), "latest"],
  ] as const)("resolves a %s to the containing epoch", async (_label, startDate, expectedEpoch) => {
    const batch = await create(startDate);
    expect(batch.productionProcessId).toBe(expectedEpoch === "middle" ? middleProcessId : latestProcessId);
  });

  it("silently creates a process only when the pair has none", async () => {
    await db.delete(productionProcesses).where(and(
      eq(productionProcesses.organizationId, ctx.organizationId),
      eq(productionProcesses.facilityId, facilityId),
    ));
    const batch = await create(new Date("2024-12-01T00:00:00Z"));
    const process = await findOrCreateProductionProcess(ctx, {
      facilityId, feedstockTypeId, startDate: new Date("2024-12-01T00:00:00Z"),
    });
    expect(process).toMatchObject({ id: batch.productionProcessId, organizationId: ctx.organizationId, facilityId, feedstockTypeId });
    expect(process.agreedBaselineSize).toBeNull();
  });

  it("moves a batch across an epoch boundary when only its start date changes", async () => {
    const batch = await createCreditBatch(ctx, {
      facilityId, feedstockTypeId, code: `CB-EPOCH-${tag}`, productionRunIds: [],
      startDate: new Date("2025-06-10T00:00:00Z"), endDate: new Date("2025-06-20T00:00:00Z"),
    });
    expect(batch.productionProcessId).toBe(middleProcessId);
    const moved = await updateCreditBatch(ctx, batch.id, {
      expectedVersion: batch.version, startDate: new Date("2025-05-20T00:00:00Z"),
    });
    expect(moved).toMatchObject({ productionProcessId: earliestProcessId, sampling: "sampled" });
    const restored = await updateCreditBatch(ctx, batch.id, {
      expectedVersion: moved.version, startDate: MIDDLE_EPOCH,
    });
    expect(restored).toMatchObject({ productionProcessId: middleProcessId, sampling: "sampled" });
  });

  it("keeps an existing unsampled batch unsampled when it moves to an ineligible epoch", async () => {
    // An existing recorded choice survives later eligibility changes (ADR 0022).
    const [batch] = await db.insert(creditBatches).values({
      organizationId: ctx.organizationId, facilityId, feedstockTypeId,
      productionProcessId: middleProcessId, code: `CB-EPOCH-${tag}`, sampling: "unsampled",
      startDate: "2025-06-10", endDate: "2025-06-20",
    }).returning();
    const moved = await updateCreditBatch(ctx, batch.id, {
      expectedVersion: batch.version, startDate: new Date("2025-05-20T00:00:00Z"),
    });
    expect(moved).toMatchObject({ productionProcessId: earliestProcessId, sampling: "unsampled" });
  });

  it.each(["facility", "feedstock type"] as const)("uses the stored start date when the %s changes", async change => {
    const startDate = new Date("2025-03-01T00:00:00Z");
    const batch = await create(startDate);
    let targetFacilityId = facilityId;
    let targetFeedstockTypeId = feedstockTypeId;
    if (change === "facility") {
      const [facility] = await db.insert(facilities).values({
        ...TEST_SITE_POSITION, organizationId: ctx.organizationId, timezone: "UTC",
        code: `FAC-EPOCH-TARGET-${tag}`, name: `Target epochs ${tag}`,
      }).returning();
      targetFacilityId = facility.id;
      facilityIds.push(facility.id);
    } else {
      const [feedstockType] = await db.insert(feedstockTypes).values({
        organizationId: ctx.organizationId, code: `FT-EPOCH-TARGET-${tag}`,
        name: `Target epochs ${tag}`, category: "forestry", usage: "pyrolysis",
      }).returning();
      targetFeedstockTypeId = feedstockType.id;
      feedstockTypeIds.push(feedstockType.id);
    }
    const [targetHistoricalProcess] = await db.insert(productionProcesses).values(
      [EARLIEST_EPOCH, LATEST_EPOCH].map(establishedAt => ({
        organizationId: ctx.organizationId, facilityId: targetFacilityId,
        feedstockTypeId: targetFeedstockTypeId, establishedAt,
      })),
    ).returning();
    const moved = await updateCreditBatch(ctx, batch.id, {
      expectedVersion: batch.version,
      ...(change === "facility" ? { facilityId: targetFacilityId } : { feedstockTypeId: targetFeedstockTypeId }),
    });
    expect(moved).toMatchObject({
      facilityId: targetFacilityId, feedstockTypeId: targetFeedstockTypeId,
      productionProcessId: targetHistoricalProcess.id, startDate: "2025-03-01", sampling: "sampled",
    });
  });

  it.each([
    ["historical", new Date("2025-03-01T00:00:00Z"), "earliest"],
    ["boundary", MIDDLE_EPOCH, "middle"],
    ["pre-epoch", new Date("2024-12-01T00:00:00Z"), "earliest"],
    ["current", undefined, "latest"],
  ] as const)("uses the same epoch rules for %s Method-B eligibility reads", async (_label, batchStartDate, expectedEpoch) => {
    const eligibility = await getMethodBEligibility(ctx, { facilityId, feedstockTypeId, batchStartDate });
    expect(eligibility.productionProcessId).toBe(expectedEpoch === "middle" ? middleProcessId : expectedEpoch === "earliest" ? earliestProcessId : latestProcessId);
  });

  it("rejects a pair outside the caller's organization", async () => {
    await expect(findOrCreateProductionProcess({ ...ctx, organizationId: "org_other_epoch" }, {
      facilityId, feedstockTypeId, startDate: MIDDLE_EPOCH,
    })).rejects.toThrow();
  });
});
