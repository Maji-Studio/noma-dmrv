import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, creditBatches, facilities, feedstockTypes, productionProcesses } from "@/db/schema";
import { createCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { findOrCreateProductionProcess, getMethodBEligibility } from "@/data-access/production-processes";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const EARLIEST_EPOCH = new Date("2025-01-01T00:00:00Z");
const MIDDLE_EPOCH = new Date("2025-06-01T00:00:00Z");
const LATEST_EPOCH = new Date("2025-09-01T00:00:00Z");

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
    await ensureTestOrg();
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
    if (facilityIds.length) {
      await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), inArray(activityEvents.facilityId, facilityIds)));
      await db.delete(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.facilityId, facilityIds)));
      await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, ctx.organizationId), inArray(productionProcesses.facilityId, facilityIds)));
      await db.delete(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), inArray(facilities.id, facilityIds)));
      facilityIds.length = 0;
    }
    if (feedstockTypeIds.length) {
      await db.delete(feedstockTypes).where(and(eq(feedstockTypes.organizationId, ctx.organizationId), inArray(feedstockTypes.id, feedstockTypeIds)));
      feedstockTypeIds.length = 0;
    }
  });

  function create(startDate: Date) {
    return createCreditBatch(ctx, {
      facilityId, feedstockTypeId, code: `CB-EPOCH-${tag}`, productionRunIds: [],
      startDate, endDate: startDate,
    });
  }

  it("attaches historical production to the epoch containing its start", async () => {
    const batch = await create(new Date("2025-03-01T00:00:00Z"));
    expect(batch.productionProcessId).toBe(earliestProcessId);
  });

  it("attaches production predating every epoch to the earliest process", async () => {
    const batch = await create(new Date("2024-12-01T00:00:00Z"));
    expect(batch.productionProcessId).toBe(earliestProcessId);
  });

  it("resolves the persisted batch day consistently on create and update", async () => {
    await db.update(productionProcesses).set({ establishedAt: new Date("2025-06-01T12:00:00Z") }).where(and(
      eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.id, middleProcessId),
    ));
    const startDate = new Date("2025-06-01T18:00:00Z");
    const batch = await create(startDate);
    expect(batch).toMatchObject({ startDate: "2025-06-01", productionProcessId: earliestProcessId });
    const updated = await updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, startDate });
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
  ] as const)("uses the same epoch rules for %s Method-B eligibility reads", async (_label, asOfDate, expectedEpoch) => {
    const eligibility = await getMethodBEligibility(ctx, { facilityId, feedstockTypeId, asOfDate });
    expect(eligibility.productionProcessId).toBe(expectedEpoch === "middle" ? middleProcessId : expectedEpoch === "earliest" ? earliestProcessId : latestProcessId);
  });

  it("rejects a pair outside the caller's organization", async () => {
    await expect(findOrCreateProductionProcess({ ...ctx, organizationId: "org_other_epoch" }, {
      facilityId, feedstockTypeId, startDate: MIDDLE_EPOCH,
    })).rejects.toThrow();
  });
});
