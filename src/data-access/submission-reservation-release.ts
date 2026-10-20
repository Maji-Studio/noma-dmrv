import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { toActivityEntityType } from "@/lib/activity-entity-type";
import { recordActivityChange } from "./activity-events";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

/** Caller holds the submission lock. Release both claims, preserving draft-owned zeros. */
export async function releaseSubmissionReservations(ctx: OrgContext, tx: DbTransaction, submissionId: string, removalId: string) {
  requireOrgScope(ctx);
  const members = await tx.select({ creditBatchId: creditBatchApplications.creditBatchId }).from(creditBatchApplications)
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.removalId, removalId)));
  const reservedEntries = await tx.select({ creditBatchId: emissionEntries.creditBatchId }).from(emissionEntries)
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.sendReservedBySubmissionId, submissionId)));
  const batchIds = [...new Set([...members, ...reservedEntries].map(row => row.creditBatchId))];
  await tx.select({ id: creditBatches.id }).from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), or(
      eq(creditBatches.productionEmissionsClaimReservedBySubmissionId, submissionId),
      batchIds.length ? inArray(creditBatches.id, batchIds) : undefined,
    ),
  )).orderBy(creditBatches.id).for("update");
  await tx.select({ id: emissionEntries.id }).from(emissionEntries).where(and(
    eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.sendReservedBySubmissionId, submissionId),
  )).orderBy(emissionEntries.id).for("update");
  const released = await tx
    .update(creditBatches)
    .set({ version: nextVersion(creditBatches.version),
      productionEmissionsClaimReservedBySubmissionId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(
          creditBatches.productionEmissionsClaimReservedBySubmissionId,
          submissionId,
        ),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  // Not flag-gated: a reservation made while the flag was on must still be released.
  const releasedEntries = await tx.update(emissionEntries).set({
    sendReservedBySubmissionId: null, version: nextVersion(emissionEntries.version), updatedAt: sql`now()`,
  }).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.sendReservedBySubmissionId, submissionId))).returning();
  for (const entry of releasedEntries) await recordActivityChange(ctx, tx, {
    entityType: "emission_entry", entityId: entry.id, creditBatchId: entry.creditBatchId, action: "updated", source: "form",
  }, { ...entry, sendReservedBySubmissionId: submissionId }, entry, { skipEmpty: true });
  for (const batch of released) await recordActivityChange(ctx, tx, {
    entityType: toActivityEntityType("credit_batch"), entityId: batch.id, creditBatchId: batch.id,
    action: "updated", source: "form",
  }, { ...batch, productionEmissionsClaimReservedBySubmissionId: submissionId }, batch, { skipEmpty: true });
}
