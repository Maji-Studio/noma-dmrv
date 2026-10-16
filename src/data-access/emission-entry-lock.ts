import { and, eq, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, facilities, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { requireOrgScope } from "./utils";
import { nextVersion } from "./row-version";

export async function lockEmissionEntry(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const [entry] = await tx
    .select()
    .from(emissionEntries)
    .where(
      and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        eq(emissionEntries.id, id),
        isNull(emissionEntries.deletedAt),
      ),
    )
    .for("update");
  if (!entry) throw new DomainError("not_found", "Emissions entry was not found.");
  return entry;
}
export async function lockWritableEmissionEntry(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  const entry = await lockEmissionEntry(ctx, tx, id);
  if (entry.sentByRemovalId || entry.sendReservedBySubmissionId)
    throw new DomainError(
      "certification_locked",
      "This emissions entry is reserved or sent. It cannot be changed.",
    );
  return entry;
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
  const [batch] = await tx
    .select()
    .from(creditBatches)
    .where(
      and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, initial.creditBatchId)),
    )
    .for("update");
  if (!batch) throw new DomainError("not_found", "Credit batch was not found.");
  const [facility] = await tx
    .select()
    .from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, batch.facilityId)))
    .for("share");
  if (!facility) throw new DomainError("not_found", "Facility was not found.");
  const entry = await lockEmissionEntry(ctx, tx, id);
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
