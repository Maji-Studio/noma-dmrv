import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";
import { requireAuth } from "./utils";

export type CertifierRemovalRow = typeof certifierRemovals.$inferSelect;
type CreditBatchRow = typeof creditBatches.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ISOMETRIC = "isometric" as const;

// A removal ledger row is keyed (provider, 'removal', 'removal', removalId).
export async function removalHasBlockingSubmission(
  executor: Tx | typeof db,
  removalId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(certificationSubmissions.submissionType, "removal"),
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.localEntityId, removalId),
        inArray(certificationSubmissions.status, BLOCKING_SUBMISSION_STATUSES),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// Deletes a removal that has become an empty shell — no member credit
// batches and no submission history. Locks the removal row FOR UPDATE first
// so a concurrent regroup or submit cannot race the emptiness check. A
// removal with ledger history is kept: its row anchors a live Isometric
// Removal even after its last credit batch leaves.
export async function gcRemovalIfOrphaned(
  tx: Tx,
  removalId: string,
): Promise<void> {
  const [removal] = await tx
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(eq(certifierRemovals.id, removalId))
    .for("update")
    .limit(1);
  if (!removal) return;

  const [remaining] = await tx
    .select({ id: creditBatches.id })
    .from(creditBatches)
    .where(eq(creditBatches.removalId, removalId))
    .limit(1);
  if (remaining) return;

  const [anySubmission] = await tx
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.localEntityId, removalId),
      ),
    )
    .limit(1);
  if (anySubmission) return;

  await tx.delete(certifierRemovals).where(eq(certifierRemovals.id, removalId));
}

export async function getCertifierRemovalById(
  userId: string,
  id: string,
): Promise<CertifierRemovalRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certifierRemovals)
    .where(eq(certifierRemovals.id, id))
    .limit(1);
  return row ?? null;
}

export async function listRemovalsForFacility(
  userId: string,
  facilityId: string,
): Promise<CertifierRemovalRow[]> {
  requireAuth(userId);
  return db
    .select()
    .from(certifierRemovals)
    .where(eq(certifierRemovals.facilityId, facilityId))
    .orderBy(desc(certifierRemovals.createdAt));
}

export async function getCreditBatchesByRemovalId(
  userId: string,
  removalId: string,
): Promise<CreditBatchRow[]> {
  requireAuth(userId);
  return db
    .select()
    .from(creditBatches)
    .where(eq(creditBatches.removalId, removalId));
}

// Credit batches in a facility not yet assigned to any removal — the pool
// the Removals hub offers when grouping batches into a removal.
export async function listUngroupedCreditBatches(
  userId: string,
  facilityId: string,
): Promise<{ id: string; code: string }[]> {
  requireAuth(userId);
  return db
    .select({ id: creditBatches.id, code: creditBatches.code })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.removalId),
      ),
    )
    .orderBy(desc(creditBatches.createdAt));
}

// Lazy 1:1: a credit batch with no removal gets its own on first certify.
// Locks the batch row FOR UPDATE so two concurrent submits can't each create
// a removal for the same batch.
export async function ensureRemovalForCreditBatch(
  userId: string,
  creditBatchId: string,
): Promise<string> {
  requireAuth(userId);
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select({
        id: creditBatches.id,
        facilityId: creditBatches.facilityId,
        removalId: creditBatches.removalId,
      })
      .from(creditBatches)
      .where(eq(creditBatches.id, creditBatchId))
      .for("update")
      .limit(1);
    if (!batch) throw new SafeError("Credit batch not found.");
    if (batch.removalId) return batch.removalId;

    const [removal] = await tx
      .insert(certifierRemovals)
      .values({ facilityId: batch.facilityId })
      .returning({ id: certifierRemovals.id });
    await tx
      .update(creditBatches)
      .set({ removalId: removal.id, updatedAt: sql`now()` })
      .where(eq(creditBatches.id, creditBatchId));
    return removal.id;
  });
}

// N:1 grouping. Moves a credit batch onto `targetRemovalId` (same facility),
// or detaches it when `targetRemovalId` is null. Blocked when either the
// source or the target removal already has a non-terminal ledger row —
// re-grouping a mid-flight removal would change what a live Isometric Removal
// represents. A source removal left empty with no ledger history is GC'd.
export async function assignCreditBatchToRemoval(
  userId: string,
  creditBatchId: string,
  targetRemovalId: string | null,
): Promise<void> {
  requireAuth(userId);
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select({
        id: creditBatches.id,
        facilityId: creditBatches.facilityId,
        removalId: creditBatches.removalId,
      })
      .from(creditBatches)
      .where(eq(creditBatches.id, creditBatchId))
      .for("update")
      .limit(1);
    if (!batch) throw new SafeError("Credit batch not found.");

    const sourceRemovalId = batch.removalId;
    if (sourceRemovalId === targetRemovalId) return;

    if (targetRemovalId !== null) {
      const [target] = await tx
        .select({
          id: certifierRemovals.id,
          facilityId: certifierRemovals.facilityId,
        })
        .from(certifierRemovals)
        .where(eq(certifierRemovals.id, targetRemovalId))
        .for("update")
        .limit(1);
      if (!target) throw new SafeError("Target removal not found.");
      if (target.facilityId !== batch.facilityId) {
        throw new SafeError(
          "A credit batch can only join a removal in the same facility.",
        );
      }
      if (await removalHasBlockingSubmission(tx, targetRemovalId)) {
        throw new SafeError(
          "That removal has already been submitted. Supersede it before adding credit batches.",
        );
      }
    }

    if (
      sourceRemovalId !== null &&
      (await removalHasBlockingSubmission(tx, sourceRemovalId))
    ) {
      throw new SafeError(
        "This credit batch's current removal has been submitted. Supersede it before regrouping.",
      );
    }

    await tx
      .update(creditBatches)
      .set({ removalId: targetRemovalId, updatedAt: sql`now()` })
      .where(eq(creditBatches.id, creditBatchId));

    // GC an orphaned source removal — no member batches and no ledger history.
    if (sourceRemovalId !== null) {
      await gcRemovalIfOrphaned(tx, sourceRemovalId);
    }
  });
}

// Persists the derived reporting window after a successful submission.
export async function updateRemovalDates(
  userId: string,
  removalId: string,
  args: { startedOn: string; completedOn: string },
): Promise<void> {
  requireAuth(userId);
  await db
    .update(certifierRemovals)
    .set({
      startedOn: args.startedOn,
      completedOn: args.completedOn,
      updatedAt: sql`now()`,
    })
    .where(eq(certifierRemovals.id, removalId));
}
