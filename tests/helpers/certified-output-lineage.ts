import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationOutputAllocations, applications, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns,
  creditBatches, deliveries, feedstocks, productionProcesses,
} from "@/db/schema";
import { createOrder } from "@/data-access/orders";
import type { seedOutputStockParents } from "./output-stock-fixture";

type Parents = Awaited<ReturnType<typeof seedOutputStockParents>>;

const LINEAGE_TIME = "2026-09-14T12:00:00.000Z";
const DELIVERED_KG = 100;
const APPLIED_TONNES = 0.1;
const FIELD_SIZE_HA = 1;
const FIELD_LATITUDE = -3.3349;
const FIELD_LONGITUDE = 37.3404;
/** The tail every certification-lineage refusal ends with. */
export const LINEAGE_LOCKED_COPY = "is locked by a certification submission.";
/** Tables this helper writes beyond what `cleanupOutputStockFixture` removes. */
const LINEAGE_TABLES = ["certification_submissions", "credit_batch_applications", "credit_batch_production_runs", "credit_batches", "certifier_removals", "production_processes"];

export interface CertifiedOutputLineage {
  /** The run whose credit batch holds the applied slice. */
  runId: string;
  /** Adds the Isometric submission that locks the lineage. */
  submitted: boolean;
  /** A product the applied delivery drew from, which joins the same lineage. */
  productId?: string;
  /** The bin the delivery left from; the fixture's product bin by default. */
  deliveryBinId?: string;
}

/**
 * Puts a run, and optionally a product drawn from it, in a credit batch whose
 * applied slice belongs to a Removal: the lineage
 * `assertCanMutateCertifiedLineage` follows. Without `submitted` the same
 * lineage stays open.
 */
export async function certifyOutputLineage(f: Parents, lineage: CertifiedOutputLineage) {
  const organizationId = f.ctx.organizationId;
  const suffix = `${f.tag}-${lineage.runId.slice(0, 4)}`;
  const [intake] = await db.select({ feedstockTypeId: feedstocks.feedstockTypeId }).from(feedstocks).where(eq(feedstocks.organizationId, organizationId));
  const order = await createOrder(f.ctx, { code: `E2E-OSL-O-${suffix}`, facilityId: f.facility.id, customerId: f.customer.id,
    formulationId: f.pure.id, orderDate: new Date(LINEAGE_TIME), quantityKg: DELIVERED_KG, packaging: "loose" });
  const [delivery] = await db.insert(deliveries).values({ organizationId, code: `E2E-OSL-D-${suffix}`, facilityId: f.facility.id, orderId: order.id,
    storageLocationId: lineage.deliveryBinId ?? f.bin.id, deliveryDate: new Date(LINEAGE_TIME), status: "delivered", deliveredWetMassKg: DELIVERED_KG, massDryKg: DELIVERED_KG }).returning();
  const [application] = await db.insert(applications).values({ organizationId, code: `E2E-OSL-A-${suffix}`, deliveryId: delivery.id,
    applicationDate: new Date(LINEAGE_TIME), biocharAppliedTons: APPLIED_TONNES, biocharAppliedDryTons: APPLIED_TONNES,
    fieldSizeHa: FIELD_SIZE_HA, gpsLatitude: FIELD_LATITUDE, gpsLongitude: FIELD_LONGITUDE }).returning();
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: intake.feedstockTypeId }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId, code: `E2E-OSL-CB-${suffix}`, facilityId: f.facility.id, feedstockTypeId: intake.feedstockTypeId,
    productionProcessId: process.id, status: "pending", startDate: "2026-09-01", endDate: "2026-09-30", certifier: "isometric" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId, facilityId: f.facility.id }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId, creditBatchId: batch.id, productionRunId: lineage.runId });
  await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: batch.id, applicationId: application.id,
    allocatedWetMassKg: DELIVERED_KG, allocatedDryMassKg: DELIVERED_KG, removalId: removal.id });
  if (lineage.productId) {
    await db.insert(applicationOutputAllocations).values({ organizationId, applicationId: application.id, deliveryId: delivery.id,
      biocharProductId: lineage.productId, productionRunId: lineage.runId, wetMassKg: String(DELIVERED_KG), dryMassKg: String(DELIVERED_KG) });
  }
  if (lineage.submitted) {
    await db.insert(certificationSubmissions).values({ organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: removal.id, externalId: `ext_osl_${suffix}`, version: 1, status: "submitted", payloadHash: `hash-${suffix}`,
      payloadSnapshot: { fixture: "certified-output-lineage" }, submittedAt: new Date(LINEAGE_TIME) });
  }
}

/** Removes what `certifyOutputLineage` added; run before `cleanupOutputStockFixture`. */
export async function cleanupCertifiedOutputLineage(organizationId: string) {
  await db.transaction(async (tx) => {
    for (const table of LINEAGE_TABLES) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`);
    }
  });
}
