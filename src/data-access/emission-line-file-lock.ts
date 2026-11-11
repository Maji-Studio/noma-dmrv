import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certificationSubmissions, documents, emissionLineFiles } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { effectiveFilePolicy } from "@/lib/isometric/template-observations/file-policies";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { canTransferProductionReservation } from "@/lib/certification/production-reservation-policy";
import { emissionCorrectionWindow } from "./emission-entry-corrections";
import { lockEmissionEntryBatch } from "./emission-entry-lock";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

/** Artifacts, facility, batch, then anchor. Uses the entry correction fence. */
export async function lockEmissionLineFileBatch(ctx: OrgContext, tx: DbTransaction, creditBatchId: string, componentId: string) {
  requireOrgScope(ctx);
  const { batch, facility } = await lockEmissionEntryBatch(ctx, tx, creditBatchId);
  if (batch.archivedAt || facility.archivedAt) throw new DomainError("not_found", "Credit batch was not found.");
  const observation = batch.removalTemplateId
    ? await getLatestTemplateObservation(ctx, "isometric", batch.removalTemplateId, tx) : null;
  const line = observation && entryLine(observation, componentId);
  if (!line || effectiveFilePolicy(line.contract) !== "lineFile")
    throw new DomainError("validation_failed", "This component does not use a credit batch file. Review its proof setting.");
  const claimingRemovalId = batch.productionEmissionsClaimedByRemovalId;
  const correctionOpen = claimingRemovalId && emissionCorrectionWindow(ctx, tx, batch.id, claimingRemovalId);
  const reservationId = batch.productionEmissionsClaimReservedBySubmissionId;
  const [reservation] = reservationId ? await tx.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.id, reservationId),
  )) : [];
  const reserved = reservationId && !canTransferProductionReservation(reservation, Date.now());
  if ((claimingRemovalId || reserved) && !correctionOpen)
    throw new DomainError("certification_locked", "This credit batch's production emissions are reserved or sent. Its component file cannot be changed.");
  return batch;
}

export async function lockEmissionLineDocumentOwner(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  const [initial] = await tx.select().from(emissionLineFiles).where(and(
    eq(emissionLineFiles.organizationId, ctx.organizationId), eq(emissionLineFiles.id, id),
  ));
  if (!initial) throw new DomainError("not_found", "Component file was not found.");
  const { batch, facility } = await lockEmissionEntryBatch(ctx, tx, initial.creditBatchId);
  const [anchor] = await tx.select().from(emissionLineFiles).where(and(
    eq(emissionLineFiles.organizationId, ctx.organizationId), eq(emissionLineFiles.id, id),
  )).for("update");
  if (!anchor) throw new DomainError("not_found", "Component file was not found.");
  return { anchor, archived: !!batch.archivedAt || !!facility.archivedAt };
}

export async function assertEmissionLineDocumentWritable(ctx: OrgContext, id: string, tx?: DbTransaction): Promise<typeof emissionLineFiles.$inferSelect> {
  requireOrgScope(ctx);
  if (!tx) return db.transaction(transaction => assertEmissionLineDocumentWritable(ctx, id, transaction));
  const { anchor } = await lockEmissionLineDocumentOwner(ctx, tx, id);
  await lockEmissionLineFileBatch(ctx, tx, anchor.creditBatchId, anchor.componentId);
  return anchor;
}

/** Called under the owner lock, including generic document-upload requests. */
export async function assertEmissionLineFileSlotEmpty(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string) {
  requireOrgScope(ctx);
  if (entityType !== "emission_line") return;
  const [existing] = await tx.select({ id: documents.id }).from(documents).where(and(
    eq(documents.organizationId, ctx.organizationId), eq(documents.entityType, entityType), eq(documents.entityId, entityId),
    inArray(documents.uploadStatus, ["pending", "uploaded"]),
  )).limit(1);
  if (existing) throw new DomainError("conflict", "This component already has a file. Remove it before attaching another file.");
}

export async function bumpEmissionLineFileEvidence(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string) {
  requireOrgScope(ctx);
  if (entityType !== "emission_line") return;
  await tx.update(emissionLineFiles).set({ version: nextVersion(emissionLineFiles.version), updatedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(emissionLineFiles.organizationId, ctx.organizationId), eq(emissionLineFiles.id, entityId)));
}
