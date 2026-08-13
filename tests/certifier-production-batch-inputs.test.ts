import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierProjects,
  creditBatches,
  creditBatchProductionRuns,
  facilities,
  feedstockTypes,
  productionProcesses,
  productionRuns,
  reactors,
} from "@/db/schema";
import { getProductionBatchRegistryInputs } from "@/data-access/certifier-production-batches";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-certifier-production-batch-inputs";

describe("getProductionBatchRegistryInputs", () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const ctx = makeTestOrgContext(TEST_USER_ID);
  let facilityId = "";
  let reactorId = "";
  let feedstockTypeId = "";
  let productionProcessId = "";
  const creditBatchIds: string[] = [];
  const productionRunIds: string[] = [];

  beforeAll(async () => {
    await ensureTestOrg();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-PTB-${tag}`,
        name: `Production Batch Input Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    facilityId = facility.id;
    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId,
        code: `RE-PTB-${tag}`,
        identifier: `Production Batch Input Reactor ${tag}`,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-PTB-${tag}`,
        name: `Production Batch Input Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
        isometricFeedstockTypeId: `ftt_${tag}`,
      })
      .returning({ id: feedstockTypes.id });
    feedstockTypeId = feedstockType.id;
    const [process] = await db
      .insert(productionProcesses)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId,
        feedstockTypeId,
      })
      .returning({ id: productionProcesses.id });
    productionProcessId = process.id;
    await db.insert(certifierProjects).values({
      organizationId: TEST_ORG_ID,
      facilityId,
      provider: "isometric",
      externalProjectId: `prj_${tag}`,
      externalFacilityId: `fcl_${tag}`,
    });
  });

  afterAll(async () => {
    if (productionRunIds.length > 0) {
      await db
        .delete(creditBatchProductionRuns)
        .where(inArray(creditBatchProductionRuns.productionRunId, productionRunIds));
      await db
        .delete(productionRuns)
        .where(inArray(productionRuns.id, productionRunIds));
    }
    if (creditBatchIds.length > 0) {
      await db.delete(creditBatches).where(inArray(creditBatches.id, creditBatchIds));
    }
    await db.delete(certifierProjects).where(eq(certifierProjects.facilityId, facilityId));
    await db
      .delete(productionProcesses)
      .where(eq(productionProcesses.id, productionProcessId));
    await db.delete(reactors).where(eq(reactors.id, reactorId));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  });

  it("keeps per-batch min/max windows and counts open member runs", async () => {
    const insertedBatches = await db
      .insert(creditBatches)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `CB-PTB-A-${tag}`,
          facilityId,
          feedstockTypeId,
          productionProcessId,
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
        {
          organizationId: TEST_ORG_ID,
          code: `CB-PTB-B-${tag}`,
          facilityId,
          feedstockTypeId,
          productionProcessId,
          startDate: "2026-02-01",
          endDate: "2026-02-28",
        },
      ])
      .returning({ id: creditBatches.id, code: creditBatches.code });
    creditBatchIds.push(...insertedBatches.map((batch) => batch.id));
    const batchIdByCode = new Map(
      insertedBatches.map((batch) => [batch.code, batch.id]),
    );
    const insertedRuns = await db
      .insert(productionRuns)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `PR-PTB-A1-${tag}`,
          facilityId,
          reactorId,
          status: "complete",
          startTime: new Date("2026-01-03T08:00:00.000Z"),
          endTime: new Date("2026-01-03T12:00:00.000Z"),
          biocharDryMassKg: 10,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-PTB-A2-${tag}`,
          facilityId,
          reactorId,
          status: "complete",
          startTime: new Date("2026-01-02T07:00:00.000Z"),
          endTime: new Date("2026-01-31T23:00:00.000Z"),
          biocharDryMassKg: 20,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-PTB-B1-${tag}`,
          facilityId,
          reactorId,
          status: "complete",
          startTime: new Date("2026-02-05T09:00:00.000Z"),
          endTime: new Date("2026-02-05T11:00:00.000Z"),
          biocharDryMassKg: 30,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-PTB-B2-${tag}`,
          facilityId,
          reactorId,
          status: "running",
          startTime: new Date("2026-02-06T10:00:00.000Z"),
          endTime: null,
          biocharDryMassKg: 40,
        },
      ])
      .returning({ id: productionRuns.id, code: productionRuns.code });
    productionRunIds.push(...insertedRuns.map((run) => run.id));
    const runIdByCode = new Map(insertedRuns.map((run) => [run.code, run.id]));
    await db.insert(creditBatchProductionRuns).values([
      {
        organizationId: TEST_ORG_ID,
        creditBatchId: batchIdByCode.get(`CB-PTB-A-${tag}`)!,
        productionRunId: runIdByCode.get(`PR-PTB-A1-${tag}`)!,
      },
      {
        organizationId: TEST_ORG_ID,
        creditBatchId: batchIdByCode.get(`CB-PTB-A-${tag}`)!,
        productionRunId: runIdByCode.get(`PR-PTB-A2-${tag}`)!,
      },
      {
        organizationId: TEST_ORG_ID,
        creditBatchId: batchIdByCode.get(`CB-PTB-B-${tag}`)!,
        productionRunId: runIdByCode.get(`PR-PTB-B1-${tag}`)!,
      },
      {
        organizationId: TEST_ORG_ID,
        creditBatchId: batchIdByCode.get(`CB-PTB-B-${tag}`)!,
        productionRunId: runIdByCode.get(`PR-PTB-B2-${tag}`)!,
      },
    ]);

    const inputs = await getProductionBatchRegistryInputs(ctx, creditBatchIds);
    const inputByCode = new Map(inputs.map((input) => [input.creditBatchCode, input]));

    expect(inputByCode.get(`CB-PTB-A-${tag}`)).toMatchObject({
      startedAt: "2026-01-02T07:00:00.000Z",
      endedAt: "2026-01-31T23:00:00.000Z",
      totalDryMassKg: 30,
      runsMissingEndTime: 0,
    });
    expect(inputByCode.get(`CB-PTB-B-${tag}`)).toMatchObject({
      startedAt: "2026-02-05T09:00:00.000Z",
      endedAt: "2026-02-05T11:00:00.000Z",
      totalDryMassKg: 70,
      runsMissingEndTime: 1,
    });
  });
});
