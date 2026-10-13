import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  apiAuditEvents, creditBatches, facilities, feedstocks, members, productionProcesses, productionRunFeedstockDraws,
  productionRuns, samples, users,
} from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { addDaysIso, formatFacilityDate } from "@/lib/date-utils";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { recordLabSampleInput } from "@/schemas/lab-sample-input";
import { createIntakeFixture, type IntakeFixture } from "../../tests/helpers/operation-fixture";
import { FACILITY_TIME_ZONE, LAB_BATCH_CODE, LAB_BATCH_WINDOW_DAYS, LAB_DURABILITY_OPTION } from "./config";
import { cleanupFixture } from "./fixture";
import { assertOrganicCarbonRequired, type LabBatchRow, type LabDatabaseSnapshot, type LabFacilityRow, type LabTarget } from "./score-lab";

const LAB_SCOPES = ["lab-samples:read", "lab-samples:write", "credit-batches:read", "facilities:read"];

export interface LabEvalFixture extends IntakeFixture {
  key: string;
  batch: LabBatchRow;
  facility: LabFacilityRow;
}

const batchColumns = {
  id: creditBatches.id, code: creditBatches.code, facilityId: creditBatches.facilityId, status: creditBatches.status,
  startDate: creditBatches.startDate, endDate: creditBatches.endDate, archivedAt: creditBatches.archivedAt,
};

async function readBatches(org: string): Promise<LabBatchRow[]> {
  const rows = await db.select(batchColumns).from(creditBatches).where(eq(creditBatches.organizationId, org));
  return rows.map((row) => ({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null }));
}

async function readFacilities(org: string): Promise<LabFacilityRow[]> {
  return db.select({ id: facilities.id, timeZone: facilities.timezone, durabilityOption: facilities.durabilityOption })
    .from(facilities).where(eq(facilities.organizationId, org));
}

/**
 * One 200-year facility in a non-UTC zone with one credit batch, CB-X, whose
 * production window ends today (facility date), so "yesterday" is inside it.
 * Test-only provisioning, like the feedstock fixture: it reuses the operation fixture.
 */
export async function seedLabFixture(caseId: string, now = new Date()): Promise<LabEvalFixture> {
  const fixture = await db.transaction((tx) => createIntakeFixture(`eval-${caseId}-${randomUUID()}`, tx));
  const org = fixture.ctx.organizationId;
  try {
    await db.insert(users).values({ id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`, name: "MCP evaluation", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: org, userId: fixture.ctx.userId, role: "owner" });
    await db.update(facilities).set({ timezone: FACILITY_TIME_ZONE, durabilityOption: LAB_DURABILITY_OPTION, archivedAt: null })
      .where(and(eq(facilities.organizationId, org), eq(facilities.id, fixture.facilityId)));
    const [process] = await db.insert(productionProcesses)
      .values({ organizationId: org, facilityId: fixture.facilityId, feedstockTypeId: fixture.feedstockTypeId }).returning({ id: productionProcesses.id });
    const today = formatFacilityDate(now, FACILITY_TIME_ZONE);
    await db.insert(creditBatches).values({
      organizationId: org, code: LAB_BATCH_CODE, facilityId: fixture.facilityId, feedstockTypeId: fixture.feedstockTypeId,
      productionProcessId: process.id, status: "pending", startDate: addDaysIso(today, -LAB_BATCH_WINDOW_DAYS), endDate: today, certifier: "isometric",
    });
    const credential = await createApiKey(fixture.ctx, { name: "MCP evaluation", scopes: LAB_SCOPES, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const [batch] = await readBatches(org);
    const [facility] = await readFacilities(org);
    return { ...fixture, key: credential.key, batch, facility };
  } catch {
    await cleanupLabFixture(fixture);
    throw new Error(`Could not seed lab evaluation organization ${org}. Check the test database schema and auth configuration.`);
  }
}

export function checkLabContract(): void {
  assertOrganicCarbonRequired(toOperationJsonSchema(recordLabSampleInput));
}

export function labTarget(fixture: LabEvalFixture, sampleDays: string[]): LabTarget {
  return { batch: fixture.batch, facility: fixture.facility, sampleDays };
}

/** The oracle reads every lab sample, the batch, the facility and the other workflows' rows in the fixture organization. */
export async function readLabSnapshot(fixture: LabEvalFixture): Promise<LabDatabaseSnapshot> {
  const org = fixture.ctx.organizationId;
  const rows = await db.select({
    creditBatchId: samples.creditBatchId, samplingTime: samples.samplingTime, totalCarbonPercent: samples.totalCarbonPercent,
    organicCarbonPercent: samples.organicCarbonPercent, totalHydrogenPercent: samples.totalHydrogenPercent,
    totalOxygenPercent: samples.totalOxygenPercent, ashContentPercent: samples.ashContentPercent,
    moistureContentPercent: samples.moistureContentPercent, hToCOrgRatio: samples.hToCOrgRatio,
  }).from(samples).where(eq(samples.organizationId, org));
  const count = async (table: typeof feedstocks | typeof productionRuns | typeof productionRunFeedstockDraws) =>
    (await db.select({ id: table.id }).from(table).where(eq(table.organizationId, org))).length;
  return {
    samples: rows.map((row) => ({ ...row, samplingTime: row.samplingTime.toISOString() })),
    batches: await readBatches(org),
    facilities: await readFacilities(org),
    unrelated: { feedstocks: await count(feedstocks), productionRuns: await count(productionRuns), draws: await count(productionRunFeedstockDraws) },
    audits: await db.select({ transport: apiAuditEvents.transport, operationId: apiAuditEvents.operationId })
      .from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, org)),
  };
}

export async function cleanupLabFixture(fixture: IntakeFixture): Promise<void> {
  const org = fixture.ctx.organizationId;
  // Samples reference the batch, and the batch references the process and feedstock type the shared cleanup removes.
  await db.delete(samples).where(eq(samples.organizationId, org));
  await db.delete(creditBatches).where(eq(creditBatches.organizationId, org));
  await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, org));
  await cleanupFixture(fixture);
}
