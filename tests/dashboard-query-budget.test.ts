import { countQueries } from "./helpers/query-counter";
/**
 * Round-trip budget for the dashboard's startup reads. Each number below is
 * a ceiling, not a target: the assertion fails when a change adds a query,
 * and it is lowered when a change removes one. The fixture holds three credit
 * batches so the CO₂e preview walk runs on the set-based path and the count
 * cannot scale with batch count (loading speed plan, Phase 3).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatchProductionRuns,
  creditBatches,
  facilities,
  feedstockTypes,
  feedstocks,
  productionProcesses,
  productionRuns,
  reactors,
} from "@/db/schema";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { getOnboardingStatus } from "@/data-access/onboarding";
import { deleteOutputFacilityFixtures } from "./helpers/output-contract-fixtures";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

/** Statements one dashboard overview read may send, with any number of batches. */
const OVERVIEW_QUERY_BUDGET = 41;
/** Statements one onboarding status read may send for a selected facility. */
const ONBOARDING_QUERY_BUDGET = 8;
const BATCH_COUNT = 3;

interface Fixture {
  facilityId: string;
  batchIds: string[];
  runIds: string[];
  feedstockIds: string[];
  processId: string;
  reactorId: string;
  feedstockTypeId: string;
}

let dbReachable = true;
let fixture: Fixture | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbReachable = false;
    return;
  }
  await ensureTestOrg();
  const tag = crypto.randomUUID().slice(0, 8);
  const [facility] = await db
    .insert(facilities)
    .values({ organizationId: TEST_ORG_ID, code: `QB-F-${tag}`, name: `Query budget ${tag}` })
    .returning({ id: facilities.id });
  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({ organizationId: TEST_ORG_ID, code: `QB-FT-${tag}`, name: `Query budget ${tag}`, category: "forestry" })
    .returning({ id: feedstockTypes.id });
  const [process] = await db
    .insert(productionProcesses)
    .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id })
    .returning({ id: productionProcesses.id });
  const [reactor] = await db
    .insert(reactors)
    .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `QB-R-${tag}`, identifier: `Query budget ${tag}`, reactorType: "fixed-bed" })
    .returning({ id: reactors.id });
  const runs = await db
    .insert(productionRuns)
    .values(
      Array.from({ length: BATCH_COUNT }, (_, n) => ({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        reactorId: reactor.id,
        code: `QB-PR${n}-${tag}`,
        status: "complete" as const,
        startTime: new Date(`2026-07-0${n + 1}T08:00:00Z`),
        endTime: new Date(`2026-07-0${n + 1}T16:00:00Z`),
        feedstockMassDryKg: 1_000 * (n + 1),
        biocharDryMassKg: 200 * (n + 1),
      })),
    )
    .returning({ id: productionRuns.id });
  const stocks = await db
    .insert(feedstocks)
    .values(
      runs.map((_, n) => ({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `QB-FS${n}-${tag}`,
        status: n === 0 ? ("missing_data" as const) : ("complete" as const),
        massDryKg: 500,
        eligibilityStatus: "eligible" as const,
        deliveryDate: new Date(`2026-06-2${n}T00:00:00Z`),
      })),
    )
    .returning({ id: feedstocks.id });
  const batches = await db
    .insert(creditBatches)
    .values(
      runs.map((_, n) => ({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        productionProcessId: process.id,
        code: `QB-CB${n}-${tag}`,
        status: n === 0 ? ("pending" as const) : ("draft" as const),
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      })),
    )
    .returning({ id: creditBatches.id });
  await db.insert(creditBatchProductionRuns).values(
    batches.map((batch, n) => ({
      organizationId: TEST_ORG_ID,
      creditBatchId: batch.id,
      productionRunId: runs[n].id,
    })),
  );
  fixture = {
    facilityId: facility.id,
    batchIds: batches.map((row) => row.id),
    runIds: runs.map((row) => row.id),
    feedstockIds: stocks.map((row) => row.id),
    processId: process.id,
    reactorId: reactor.id,
    feedstockTypeId: feedstockType.id,
  };
});

afterAll(async () => {
  if (!fixture) return;
  await db.delete(creditBatchProductionRuns).where(inArray(creditBatchProductionRuns.creditBatchId, fixture.batchIds));
  await db.delete(creditBatches).where(inArray(creditBatches.id, fixture.batchIds));
  await db.delete(feedstocks).where(inArray(feedstocks.id, fixture.feedstockIds));
  await db.delete(productionRuns).where(inArray(productionRuns.id, fixture.runIds));
  await db.delete(productionProcesses).where(eq(productionProcesses.id, fixture.processId));
  await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
  await db.delete(feedstockTypes).where(eq(feedstockTypes.id, fixture.feedstockTypeId));
  await deleteOutputFacilityFixtures(db, eq(facilities.id, fixture.facilityId));
});

describe("dashboard query budget", () => {
  it("reads the overview within budget and independent of batch count", async () => {
    if (!dbReachable || !fixture) return;
    const ctx = makeTestOrgContext();
    const facilityId = fixture.facilityId;

    const { result, queries } = await countQueries(() =>
      getDashboardOverview(ctx, facilityId, "all"),
    );
    expect(result.certification.totalBatches).toBe(BATCH_COUNT);
    expect(result.kpis.find((kpi) => kpi.key === "feedstockProcessed")?.value).toBe(6);
    expect(result.stations.find((s) => s.key === "feedstock")?.attention).toBe(1);
    expect(queries).toBeLessThanOrEqual(OVERVIEW_QUERY_BUDGET);

    // One more batch must not add a round trip.
    const [extra] = await db
      .insert(creditBatches)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId,
        feedstockTypeId: fixture.feedstockTypeId,
        productionProcessId: fixture.processId,
        code: `QB-CBX-${facilityId.slice(0, 8)}`,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      })
      .returning({ id: creditBatches.id });
    try {
      const again = await countQueries(() => getDashboardOverview(ctx, facilityId, "all"));
      expect(again.result.certification.totalBatches).toBe(BATCH_COUNT + 1);
      expect(again.queries).toBe(queries);
    } finally {
      await db.delete(creditBatches).where(eq(creditBatches.id, extra.id));
    }
  });

  it("reads the onboarding status within budget", async () => {
    if (!dbReachable || !fixture) return;
    const ctx = makeTestOrgContext();
    const { result, queries } = await countQueries(() =>
      getOnboardingStatus(ctx, fixture!.facilityId),
    );
    expect(result.facility?.creditBatchCount).toBe(BATCH_COUNT);
    expect(result.facility?.completeProductionRunCount).toBe(BATCH_COUNT);
    expect(queries).toBeLessThanOrEqual(ONBOARDING_QUERY_BUDGET);
  });
});
