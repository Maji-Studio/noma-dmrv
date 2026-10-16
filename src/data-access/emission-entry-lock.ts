import { and, eq, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { requireOrgScope } from "./utils";
import { nextVersion } from "./row-version";

export async function lockEmissionEntry(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const [entry] = await tx.select().from(emissionEntries).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, id), isNull(emissionEntries.deletedAt))).for("update");
  if (!entry) throw new DomainError("not_found", "Emissions entry was not found.");
  return entry;
}
export async function lockWritableEmissionEntry(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  const entry = await lockEmissionEntry(ctx, tx, id);
  if (entry.sentByRemovalId || entry.sendReservedBySubmissionId) throw new DomainError("certification_locked", "This emissions entry is reserved or sent. It cannot be changed.");
  return entry;
}
export async function assertEmissionEntryDocumentWritable(ctx: OrgContext, id: string, tx?: DbTransaction) {
  requireOrgScope(ctx);
  if (!tx) return db.transaction(transaction => lockWritableEmissionEntry(ctx, transaction, id));
  return lockWritableEmissionEntry(ctx, tx, id);
}
export async function bumpEmissionEntryEvidence(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string) {
  requireOrgScope(ctx);
  if (entityType !== "emission_entry") return;
  await lockWritableEmissionEntry(ctx, tx, entityId);
  await tx.update(emissionEntries).set({ version: nextVersion(emissionEntries.version), contentRevision: nextVersion(emissionEntries.contentRevision), updatedAt: new Date() })
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, entityId)));
}
