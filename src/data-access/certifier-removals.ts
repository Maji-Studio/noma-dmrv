import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
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
  logger.info({ removalId }, "orphan certifier removal deleted");
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

// A credit batch summarised for the GHG-statement cross-link accordion — the
// few fields an operator needs to recognise a batch (code, status, crediting
// window, stored CO₂e) without opening it.
export interface RemovalCreditBatchSummary {
  id: string;
  code: string;
  status: CreditBatchRow["status"];
  startDate: string;
  endDate: string;
  totalCo2eStoredTons: number | null;
}

// Batched credit-batch summaries for a set of removals — one grouped query
// instead of one getCreditBatchesByRemovalId per removal (the GHG-statement
// preview and detail views render many removals at once). Returns a
// removalId → summaries map ordered by batch code; removals with no batches
// are simply absent.
export async function getCreditBatchSummariesByRemovalIds(
  userId: string,
  removalIds: string[],
): Promise<Map<string, RemovalCreditBatchSummary[]>> {
  requireAuth(userId);
  const result = new Map<string, RemovalCreditBatchSummary[]>();
  if (removalIds.length === 0) return result;

  const rows = await db
    .select({
      removalId: creditBatches.removalId,
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      totalCo2eStoredTons: creditBatches.totalCo2eStoredTons,
    })
    .from(creditBatches)
    .where(inArray(creditBatches.removalId, removalIds))
    .orderBy(creditBatches.code);

  for (const row of rows) {
    if (!row.removalId) continue;
    const summary: RemovalCreditBatchSummary = {
      id: row.id,
      code: row.code,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      totalCo2eStoredTons: row.totalCo2eStoredTons,
    };
    const existing = result.get(row.removalId);
    if (existing) existing.push(summary);
    else result.set(row.removalId, [summary]);
  }
  return result;
}

// A credit batch not yet grouped into a removal, with the display fields the
// New-Removal wizard's selection cards render (code, crediting window, weight,
// stored CO₂e, durability). The wizard pairs each row with a per-batch health
// verdict it derives separately; this query is the cheap list half.
export interface UngroupedCreditBatchRow {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  weightTons: number | null;
  totalCo2eStoredTons: number | null;
  durabilityOption: CreditBatchRow["durabilityOption"];
}

// Credit batches in a facility not yet assigned to any removal — the pool the
// Removals hub / New-Removal wizard offers when grouping batches into a removal.
export async function listUngroupedCreditBatches(
  userId: string,
  facilityId: string,
): Promise<UngroupedCreditBatchRow[]> {
  requireAuth(userId);
  return db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      weightTons: creditBatches.weightTons,
      totalCo2eStoredTons: creditBatches.totalCo2eStoredTons,
      durabilityOption: creditBatches.durabilityOption,
    })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.removalId),
      ),
    )
    .orderBy(desc(creditBatches.createdAt));
}

// Deferred-create: spins up a fresh removal in `facilityId` and assigns every
// credit batch in `creditBatchIds` to it in one transaction — the write behind
// the New-Removal wizard's "Confirm" step. Each selected batch row is locked
// FOR UPDATE (ordered by id for deterministic lock acquisition) and re-checked
// under the lock: it must still exist, belong to `facilityId`, and be ungrouped.
// The action layer has already re-derived batch health; this layer owns the
// integrity guarantee that a concurrent group/submit cannot split the selection
// across two removals or pull a batch into a foreign facility. Returns the new
// removal id.
export async function createRemovalWithCreditBatches(
  userId: string,
  facilityId: string,
  creditBatchIds: string[],
): Promise<string> {
  requireAuth(userId);
  const uniqueIds = Array.from(new Set(creditBatchIds));
  if (uniqueIds.length === 0) {
    throw new SafeError("Select at least one credit batch.");
  }

  return db.transaction(async (tx) => {
    const batches = await tx
      .select({
        id: creditBatches.id,
        facilityId: creditBatches.facilityId,
        removalId: creditBatches.removalId,
      })
      .from(creditBatches)
      .where(inArray(creditBatches.id, uniqueIds))
      .orderBy(creditBatches.id)
      .for("update");

    if (batches.length !== uniqueIds.length) {
      throw new SafeError("One or more selected credit batches no longer exist.");
    }
    for (const batch of batches) {
      if (batch.facilityId !== facilityId) {
        throw new SafeError(
          "A credit batch can only join a removal in the same facility.",
        );
      }
      if (batch.removalId) {
        throw new SafeError(
          "A selected credit batch is already grouped into a removal.",
        );
      }
    }

    const [removal] = await tx
      .insert(certifierRemovals)
      .values({ facilityId })
      .returning({ id: certifierRemovals.id });

    await tx
      .update(creditBatches)
      .set({ removalId: removal.id, updatedAt: sql`now()` })
      .where(inArray(creditBatches.id, uniqueIds));

    return removal.id;
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
