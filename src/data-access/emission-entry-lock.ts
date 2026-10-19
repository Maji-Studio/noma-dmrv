import { and, eq, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, facilities, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { requireOrgScope } from "./utils";
import { nextVersion } from "./row-version";

export async function lockEmissionEntry(ctx: OrgContext, tx: DbTransaction, id: string, options: { includeDeleted?: boolean } = {}) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const [entry] = await tx
    .select()
    .from(emissionEntries)
    .where(
      and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        eq(emissionEntries.id, id),
        options.includeDeleted ? undefined : isNull(emissionEntries.deletedAt),
      ),
    )
    .for("update");
  if (!entry) throw new DomainError("not_found", "Emissions entry was not found.");
  return entry;
}
export async function lockWritableEmissionEntry(ctx: OrgContext, tx: DbTransaction, id: string, options: { includeDeleted?: boolean } = {}) {
  requireOrgScope(ctx);
  const entry = await lockEmissionEntry(ctx, tx, id, options);
  if (entry.sentByRemovalId || entry.sendReservedBySubmissionId)
    throw new DomainError(
      "certification_locked",
      "This emissions entry is reserved or sent. It cannot be changed.",
    );
  return entry;
}
/** Discover unlocked, then lock facility before batch, matching facility archive. */
export async function lockEmissionEntryBatch(ctx: OrgContext, tx: DbTransaction, creditBatchId: string) {
  requireOrgScope(ctx);
  const [initial] = await tx.select().from(creditBatches)
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, creditBatchId)));
  if (!initial) throw new DomainError("not_found", "Credit batch was not found.");
  const [facility] = await tx.select().from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, initial.facilityId)))
    .for("share");
  if (!facility) throw new DomainError("not_found", "Facility was not found.");
  const [batch] = await tx.select().from(creditBatches)
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, creditBatchId)))
    .for("update");
  if (!batch) throw new DomainError("not_found", "Credit batch was not found.");
  if (batch.facilityId !== initial.facilityId) throw emissionEntryParentChanged();
  return { batch, facility };
}
export function emissionEntryParentChanged() {
  return new DomainError("conflict", "Certification lineage changed while it was being locked. Refresh and retry.", { retryable: true });
}
/** Lock ancestors before the entry, without applying the batch lineage guard. */
export async function lockEmissionEntryDocumentOwner(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  const [initial] = await tx
    .select()
    .from(emissionEntries)
    .where(
      and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        eq(emissionEntries.id, id),
        isNull(emissionEntries.deletedAt),
      ),
    );
  if (!initial) throw new DomainError("not_found", "Emissions entry was not found.");
  const { batch, facility } = await lockEmissionEntryBatch(ctx, tx, initial.creditBatchId);
  const entry = await lockEmissionEntry(ctx, tx, id);
  if (entry.creditBatchId !== initial.creditBatchId) throw emissionEntryParentChanged();
  return { entry, archived: batch.archivedAt !== null || facility.archivedAt !== null };
}
export async function assertEmissionEntryDocumentWritable(
  ctx: OrgContext,
  id: string,
  tx?: DbTransaction,
): Promise<typeof emissionEntries.$inferSelect> {
  requireOrgScope(ctx);
  if (!tx) return db.transaction((transaction) => assertEmissionEntryDocumentWritable(ctx, id, transaction));
  const owner = await lockEmissionEntryDocumentOwner(ctx, tx, id);
  if (owner.archived) throw new DomainError("not_found", "Credit batch was not found.");
  return lockWritableEmissionEntry(ctx, tx, id);
}
export async function bumpEmissionEntryEvidence(
  ctx: OrgContext,
  tx: DbTransaction,
  entityType: string,
  entityId: string,
) {
  requireOrgScope(ctx);
  if (entityType !== "emission_entry") return;
  await lockWritableEmissionEntry(ctx, tx, entityId);
  await tx
    .update(emissionEntries)
    .set({
      version: nextVersion(emissionEntries.version),
      contentRevision: nextVersion(emissionEntries.contentRevision),
      updatedAt: new Date(),
    })
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, entityId)));
}
