import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatches, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { toActivityEntityType } from "@/lib/activity-entity-type";
import { recordActivityChange } from "./activity-events";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";
import { lockBatchesThenEntries } from "./emission-entry-release-locks";

/** Caller holds the submission lock. Release both claims, preserving draft-owned zeros. */
export async function releaseSubmissionReservations(ctx: OrgContext, tx: DbTransaction, submissionId: string, removalId: string) {
  requireOrgScope(ctx);
  await lockBatchesThenEntries(ctx, tx, {
    removalId,
    entryFilter: eq(emissionEntries.sendReservedBySubmissionId, submissionId),
    extraBatchFilter: eq(creditBatches.productionEmissionsClaimReservedBySubmissionId, submissionId),
  });
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
