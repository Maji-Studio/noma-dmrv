/**
 * An isolated organization with credit batches ready for lab Samples, for the
 * lab sample operation suites. Each batch holds one completed run and one
 * applied slice whose Removal is unassigned, so a test can assign it (and
 * optionally submit it) to put the batch under a certification lock, before
 * or while a writer runs.
 */

import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns,
  creditBatches, deliveries, facilities, feedstocks, productionProcesses,
} from "@/db/schema";
import { createOrderInTransaction } from "@/data-access/orders";
import { cleanupCertifiedOutputLineage } from "./certified-output-lineage";
import { cleanupOutputStockFixture } from "./output-stock-cleanup";
import { seedOutputStockParents } from "./output-stock-fixture";

const DELIVERY_TIME = "2026-09-14T12:00:00.000Z";
const DELIVERED_KG = 100;
const APPLIED_TONNES = 0.1;
const FIELD = { fieldSizeHa: 1, gpsLatitude: -3.3349, gpsLongitude: 37.3404 };
/** Rows this fixture adds beyond the output-stock parents and the certified lineage. */
const SAMPLE_TABLES = ["storage_object_deletions", "documents", "transport_legs", "samples", "api_idempotency_records"];

export interface LabSampleFixtureOptions {
  timeZone?: string;
  durabilityOption?: "200_year" | "1000_year";
  /** Batch A's production window; batch B always covers August 2026. */
  window?: { startDate: string; endDate: string };
  /** Batch B holds run R2; leave it out when a test needs R2 free. */
  withSecondBatch?: boolean;
}

export interface LabSampleBatch {
  id: string;
  code: string;
  removalId: string;
  runId: string;
}

export type LabSampleFixture = Awaited<ReturnType<typeof seedOutputStockParents>> & {
  batchA: LabSampleBatch;
  batchB?: LabSampleBatch;
  feedstockTypeId: string;
};

async function addBatch(
  f: Awaited<ReturnType<typeof seedOutputStockParents>>,
  args: { label: string; runId: string; feedstockTypeId: string; processId: string; startDate: string; endDate: string },
): Promise<LabSampleBatch> {
  const organizationId = f.ctx.organizationId;
  const suffix = `${f.tag}-${args.label}`;
  const order = await db.transaction(tx => createOrderInTransaction(f.ctx, tx, { code: `E2E-LAB-O-${suffix}`, facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: f.location.id,
    formulationId: f.pure.id, orderDate: new Date(DELIVERY_TIME), quantityKg: DELIVERED_KG, packaging: "loose" }));
  const [delivery] = await db.insert(deliveries).values({ organizationId, code: `E2E-LAB-D-${suffix}`, facilityId: f.facility.id, orderId: order.id,
    storageLocationId: f.bin.id, deliveryDate: new Date(DELIVERY_TIME), status: "delivered", deliveredWetMassKg: DELIVERED_KG, massDryKg: DELIVERED_KG }).returning();
  const [application] = await db.insert(applications).values({ organizationId, code: `E2E-LAB-A-${suffix}`, deliveryId: delivery.id,
    applicationDate: new Date(DELIVERY_TIME), biocharAppliedTons: APPLIED_TONNES, biocharAppliedDryTons: APPLIED_TONNES, ...FIELD }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId, code: `E2E-LAB-CB-${suffix}`, facilityId: f.facility.id,
    feedstockTypeId: args.feedstockTypeId, productionProcessId: args.processId, status: "pending",
    startDate: args.startDate, endDate: args.endDate, certifier: "isometric" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId, facilityId: f.facility.id }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId, creditBatchId: batch.id, productionRunId: args.runId });
  // The slice exists unassigned: lineage is empty until a test assigns the Removal.
  await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: batch.id, applicationId: application.id,
    allocatedWetMassKg: DELIVERED_KG, allocatedDryMassKg: DELIVERED_KG, removalId: null });
  return { id: batch.id, code: batch.code, removalId: removal.id, runId: args.runId };
}

export async function createLabSampleFixture(options: LabSampleFixtureOptions = {}): Promise<LabSampleFixture> {
  const f = await seedOutputStockParents(db);
  const organizationId = f.ctx.organizationId;
  await db.update(facilities).set({
    timezone: options.timeZone ?? "Africa/Dar_es_Salaam",
    durabilityOption: options.durabilityOption ?? "200_year",
  }).where(and(eq(facilities.id, f.facility.id), eq(facilities.organizationId, organizationId)));
  const [intake] = await db.select({ feedstockTypeId: feedstocks.feedstockTypeId }).from(feedstocks).where(eq(feedstocks.organizationId, organizationId));
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: intake.feedstockTypeId }).returning();
  const window = options.window ?? { startDate: "2026-09-01", endDate: "2026-09-30" };
  const batchA = await addBatch(f, { label: "A", runId: f.runs[0].id, feedstockTypeId: intake.feedstockTypeId, processId: process.id, ...window });
  const batchB = options.withSecondBatch === false ? undefined : await addBatch(f, {
    label: "B", runId: f.runs[1].id, feedstockTypeId: intake.feedstockTypeId, processId: process.id, startDate: "2026-08-01", endDate: "2026-08-31",
  });
  return { ...f, batchA, batchB, feedstockTypeId: intake.feedstockTypeId };
}

/**
 * Assigns the batch's slice to its Removal; `submitted` adds the blocking
 * Isometric submission. Pass a barrier transaction to do it while a writer waits.
 */
export async function assignRemoval(
  f: LabSampleFixture,
  batch: LabSampleBatch,
  options: { submitted: boolean; executor?: DbTransaction | typeof db },
): Promise<void> {
  const executor = options.executor ?? db;
  const organizationId = f.ctx.organizationId;
  await executor.update(creditBatchApplications).set({ removalId: batch.removalId })
    .where(and(eq(creditBatchApplications.creditBatchId, batch.id), eq(creditBatchApplications.organizationId, organizationId)));
  if (!options.submitted) return;
  await executor.insert(certificationSubmissions).values({ organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal",
    localEntityId: batch.removalId, externalId: `ext_lab_${batch.code}`, version: 1, status: "submitted", payloadHash: `hash-${batch.code}`,
    payloadSnapshot: { fixture: "lab-sample" }, submittedAt: new Date(DELIVERY_TIME) });
}

export async function cleanupLabSampleFixture(f: LabSampleFixture): Promise<void> {
  const organizationId = f.ctx.organizationId;
  await db.transaction(async (tx) => {
    for (const table of SAMPLE_TABLES) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`);
    }
  });
  await cleanupCertifiedOutputLineage(organizationId);
  await cleanupOutputStockFixture(db, organizationId);
}
