import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatchProductionRuns, creditBatches, facilities, feedstocks, feedstockTypes, samples,
  productionProcesses, productionRuns, reactors,
} from "@/db/schema";
import { cleanupFeedstockFixtureParents, feedstockFixtureValues } from "./feedstock-fixture";
import { TEST_ORG_ID, TEST_SITE_POSITION } from "./test-org";

const TAG_LENGTH = 8;
const RUN_DURATION_MS = 60 * 60 * 1000;
const SAMPLE_TOTAL_CARBON_PERCENT = 80;
const SAMPLE_ORGANIC_CARBON_PERCENT = 78;

/** Minimal persisted records for calendar reads and facility edit guards. */
export function facilityCalendarFixture(prefix: string) {
  const tag = crypto.randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const facilityIds: string[] = [];
  const reactorIds: string[] = [];
  const runIds: string[] = [];
  const batchIds: string[] = [];
  const sampleIds: string[] = [];
  const feedstockIds: string[] = [];
  const processIds: string[] = [];
  const feedstockTypeIds: string[] = [];
  const organizationId = TEST_ORG_ID;

  async function facility(label: string, timezone: string) {
    const code = `${prefix}-${label}-${tag}`;
    const [row] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION, organizationId, timezone,
      code: `FAC-${code}`, name: `Calendar facility ${code}`,
    }).returning();
    facilityIds.push(row.id);
    return row;
  }

  async function run(facilityId: string, label: string, start: string) {
    const code = `${prefix}-${label}-${tag}`;
    const [reactor] = await db.insert(reactors).values({
      organizationId, facilityId, code: `RE-${code}`,
      identifier: `Calendar reactor ${code}`, reactorType: "auger",
    }).returning();
    reactorIds.push(reactor.id);
    const startTime = new Date(start);
    const [row] = await db.insert(productionRuns).values({
      organizationId, facilityId, code: `PR-${code}`, reactorId: reactor.id,
      status: "complete", startTime,
      endTime: new Date(startTime.getTime() + RUN_DURATION_MS),
    }).returning();
    runIds.push(row.id);
    return row;
  }

  async function batch(facilityId: string, runId: string | null, label: string) {
    const code = `${prefix}-${label}-${tag}`;
    const [feedstockType] = await db.insert(feedstockTypes).values({
      organizationId, code: `FT-${code}`, name: `Calendar feedstock ${code}`,
      category: "forestry", usage: "pyrolysis",
    }).returning();
    feedstockTypeIds.push(feedstockType.id);
    const [process] = await db.insert(productionProcesses).values({
      organizationId, facilityId, feedstockTypeId: feedstockType.id,
    }).returning();
    processIds.push(process.id);
    const [row] = await db.insert(creditBatches).values({
      organizationId, facilityId, code: `CB-${code}`,
      feedstockTypeId: feedstockType.id, productionProcessId: process.id,
      startDate: "2025-10-01", endDate: "2025-10-31",
    }).returning();
    batchIds.push(row.id);
    if (runId) await db.insert(creditBatchProductionRuns).values({
      organizationId, creditBatchId: row.id, productionRunId: runId,
    });
    return row;
  }

  async function sample(creditBatchId: string, label: string) {
    const [row] = await db.insert(samples).values({
      organizationId, creditBatchId, sampleCode: `S-${prefix}-${label}-${tag}`,
      samplingTime: new Date("2025-10-01T09:00:00.000Z"),
      totalCarbonPercent: SAMPLE_TOTAL_CARBON_PERCENT, organicCarbonPercent: SAMPLE_ORGANIC_CARBON_PERCENT,
    }).returning();
    sampleIds.push(row.id);
    return row;
  }

  async function feedstock(facilityId: string, label: string, deliveryDay: string, massDryKg: number) {
    const code = `${prefix}-${label}-${tag}`;
    const [type] = await db.insert(feedstockTypes).values({
      organizationId, code: `FT-${code}`, name: `Calendar feedstock ${code}`,
      category: "forestry", usage: "pyrolysis",
    }).returning();
    feedstockTypeIds.push(type.id);
    const [row] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId, facilityId, feedstockTypeId: type.id, code: `FS-${code}`,
      massDryKg, deliveryDate: new Date(deliveryDay),
    })).returning();
    feedstockIds.push(row.id);
    return row;
  }

  async function cleanup() {
    if (sampleIds.length) await db.delete(samples).where(and(
      eq(samples.organizationId, organizationId), inArray(samples.id, sampleIds),
    ));
    if (feedstockIds.length) await db.delete(feedstocks).where(and(
      eq(feedstocks.organizationId, organizationId), inArray(feedstocks.id, feedstockIds),
    ));
    await cleanupFeedstockFixtureParents(db);
    if (batchIds.length) await db.delete(creditBatchProductionRuns).where(and(
      eq(creditBatchProductionRuns.organizationId, organizationId),
      inArray(creditBatchProductionRuns.creditBatchId, batchIds),
    ));
    if (runIds.length) await db.delete(productionRuns).where(and(
      eq(productionRuns.organizationId, organizationId), inArray(productionRuns.id, runIds),
    ));
    if (batchIds.length) await db.delete(creditBatches).where(and(
      eq(creditBatches.organizationId, organizationId), inArray(creditBatches.id, batchIds),
    ));
    if (processIds.length) await db.delete(productionProcesses).where(and(
      eq(productionProcesses.organizationId, organizationId), inArray(productionProcesses.id, processIds),
    ));
    if (reactorIds.length) await db.delete(reactors).where(and(
      eq(reactors.organizationId, organizationId), inArray(reactors.id, reactorIds),
    ));
    if (facilityIds.length) await db.delete(facilities).where(and(
      eq(facilities.organizationId, organizationId), inArray(facilities.id, facilityIds),
    ));
    if (feedstockTypeIds.length) await db.delete(feedstockTypes).where(and(
      eq(feedstockTypes.organizationId, organizationId), inArray(feedstockTypes.id, feedstockTypeIds),
    ));
  }

  return { facility, run, batch, sample, feedstock, cleanup };
}
