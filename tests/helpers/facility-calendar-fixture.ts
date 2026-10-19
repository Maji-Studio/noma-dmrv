import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatchProductionRuns, creditBatches, facilities, feedstockTypes,
  productionProcesses, productionRuns, reactors,
} from "@/db/schema";
import { TEST_ORG_ID, TEST_SITE_POSITION } from "./test-org";

const TAG_LENGTH = 8;
const RUN_DURATION_MS = 60 * 60 * 1000;

/** Minimal persisted records for calendar reads and facility edit guards. */
export function facilityCalendarFixture(prefix: string) {
  const tag = crypto.randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const facilityIds: string[] = [];
  const reactorIds: string[] = [];
  const runIds: string[] = [];
  const batchIds: string[] = [];
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

  async function batch(facilityId: string, runId: string, label: string) {
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
    await db.insert(creditBatchProductionRuns).values({
      organizationId, creditBatchId: row.id, productionRunId: runId,
    });
    return row;
  }

  async function cleanup() {
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

  return { facility, run, batch, cleanup };
}
