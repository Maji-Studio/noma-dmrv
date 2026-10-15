import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { db } from "@/db";
import { apiAuditEvents, deliveries, documents, storageObjectDeletions } from "@/db/schema";
import { recordDeliveryForUi } from "@/lib/operations/deliveries";
import { runOperationInProcess } from "@/lib/operations/runner";
import { DOCUMENT_DELIVERY_CODE, DELIVERY_MOISTURE_PERCENT, DELIVERY_WET_MASS_KG } from "./config";
import { cleanupDeliveryFixture, seedDeliveryFixture, type DeliveryEvalFixture } from "./fixture-delivery";
import { writeBillOfLading } from "./fixture-document-file";
import type { DocumentDatabaseSnapshot, DocumentTarget } from "./score-documents";

export interface DocumentEvalFixture extends DeliveryEvalFixture {
  documentTarget: DocumentTarget;
  fileDirectory: string;
  seededAuditIds: string[];
  deliveryBaseline: string;
}

/** No Removal or submission is provisioned, so this delivery's lineage is writable. */
export async function seedDocumentFixture(fileDirectory: string): Promise<DocumentEvalFixture> {
  const fixture = await seedDeliveryFixture("delivery-complete");
  try {
    const { delivery } = await runOperationInProcess(recordDeliveryForUi, fixture.ctx, {
      code: DOCUMENT_DELIVERY_CODE, orderId: fixture.target.orderId, storageLocationId: fixture.target.binId,
      deliveredAt: new Date().toISOString(), deliveredWetMassKg: DELIVERY_WET_MASS_KG, moisturePercent: DELIVERY_MOISTURE_PERCENT,
    });
    const file = await writeBillOfLading(fileDirectory);
    const [audits, deliveryRows] = await Promise.all([
      db.select({ id: apiAuditEvents.id }).from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, fixture.ctx.organizationId)),
      db.select().from(deliveries).where(eq(deliveries.organizationId, fixture.ctx.organizationId)),
    ]);
    return { ...fixture, fileDirectory, documentTarget: { ...file, deliveryId: delivery.id, deliveryCode: delivery.code },
      seededAuditIds: audits.map(({ id }) => id), deliveryBaseline: JSON.stringify(deliveryRows[0]) };
  } catch (error) {
    await rm(fileDirectory, { recursive: true, force: true });
    await cleanupDeliveryFixture(fixture);
    throw error;
  }
}

/** Include all document states and owners, plus all post-seed committed API writes. */
export async function readDocumentSnapshot(fixture: DocumentEvalFixture): Promise<DocumentDatabaseSnapshot> {
  const org = fixture.ctx.organizationId;
  const [rows, audits, deliveryRows] = await Promise.all([
    db.select({ id: documents.id, entityType: documents.entityType, entityId: documents.entityId,
      documentType: documents.documentType, uploadStatus: documents.uploadStatus, checksumSha256: documents.checksumSha256 })
      .from(documents).where(eq(documents.organizationId, org)),
    db.select({ id: apiAuditEvents.id, operationId: apiAuditEvents.operationId, transport: apiAuditEvents.transport,
      entityType: apiAuditEvents.entityType, entityIds: apiAuditEvents.entityIds })
      .from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, org)),
    db.select().from(deliveries).where(eq(deliveries.organizationId, org)),
  ]);
  return { documents: rows, audits: audits.filter(({ id }) => !fixture.seededAuditIds.includes(id)),
    deliveryUnchanged: deliveryRows.length === 1 && JSON.stringify(deliveryRows[0]) === fixture.deliveryBaseline };
}

export async function cleanupDocumentFixture(fixture: DocumentEvalFixture): Promise<void> {
  const org = fixture.ctx.organizationId;
  await db.delete(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, org));
  await db.delete(documents).where(eq(documents.organizationId, org));
  await cleanupDeliveryFixture(fixture);
  await rm(fixture.fileDirectory, { recursive: true, force: true });
}
