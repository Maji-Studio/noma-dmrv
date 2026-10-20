import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";
import { nextVersion } from "./row-version";
import { recordEmissionEntryActivity } from "./emission-entry-activity";

/** Only after registry cleanup and the finalizer's ledger/batch locks. */
export async function releaseDeletedRemovalEntries(ctx: OrgContext, tx: DbTransaction, removalId: string, submissionIds: string[]) {
  requireOrgScope(ctx);
  const rows = await tx.select().from(emissionEntries).where(and(eq(emissionEntries.organizationId, ctx.organizationId), or(
    eq(emissionEntries.confirmedForRemovalId, removalId), eq(emissionEntries.sentByRemovalId, removalId),
    submissionIds.length ? inArray(emissionEntries.sendReservedBySubmissionId, submissionIds) : undefined,
  ))).orderBy(emissionEntries.id).for("update");
  // Finalized Removals cannot reach this finalizer. Preserve sent zero history even if that invariant is violated.
  if (rows.some((row) => row.kind === "zero" && row.sentByRemovalId)) throw new SafeError("A Removal with sent recorded zeros cannot be deleted.");
  for (const row of rows) {
    const zeroOwned = row.kind === "zero" && row.confirmedForRemovalId === removalId;
    if (zeroOwned && row.deletedAt) {
      await tx.delete(emissionEntries).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, row.id)));
      continue;
    }
    const [saved] = await tx.update(emissionEntries).set({
      ...(row.sentByRemovalId === removalId ? { sentByRemovalId: null } : {}),
      ...(row.sendReservedBySubmissionId && submissionIds.includes(row.sendReservedBySubmissionId) ? { sendReservedBySubmissionId: null } : {}),
      ...(zeroOwned ? { deletedAt: sql`now()`, contentRevision: nextVersion(emissionEntries.contentRevision) } : {}),
      version: nextVersion(emissionEntries.version), updatedAt: sql`now()`,
    }).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, row.id))).returning();
    if (zeroOwned) {
      await recordEmissionEntryActivity(ctx, tx, "deleted", { ...row, values: [] }, { ...saved, values: [] });
      // The owner is hard-deleted. Keep the persisted tombstone in activity, then remove the never-sent zero
      // so the non-null owner CHECK and composite NO ACTION FK remain intact.
      await tx.delete(emissionEntries).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, row.id)));
    }
  }
}
