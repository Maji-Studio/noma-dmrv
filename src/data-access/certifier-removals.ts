import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import {
  DURABILITY_TIER_FALLBACK,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import type { StoredSourceBindingVerification } from "@/lib/certification/removal-evidence-health";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export type CertifierRemovalRow = typeof certifierRemovals.$inferSelect;
type CreditBatchRow = typeof creditBatches.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ISOMETRIC = "isometric" as const;

// A removal ledger row is keyed (provider, 'removal', 'removal', removalId).
export async function removalHasBlockingSubmission(
  ctx: OrgContext,
  executor: Tx | typeof db,
  removalId: string,
): Promise<boolean> {
  requireOrgScope(ctx);
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
        eq(certificationSubmissions.organizationId, ctx.organizationId),
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
  ctx: OrgContext,
  tx: Tx,
  removalId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const [removal] = await tx
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(and(eq(certifierRemovals.id, removalId), eq(certifierRemovals.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!removal) return;

  const [remaining] = await tx
    .select({ id: creditBatches.id })
    .from(creditBatches)
    .where(and(eq(creditBatches.removalId, removalId), eq(creditBatches.organizationId, ctx.organizationId)))
    .limit(1);
  if (remaining) return;

  const [anySubmission] = await tx
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.localEntityId, removalId),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (anySubmission) return;

  await tx.delete(certifierRemovals).where(and(eq(certifierRemovals.id, removalId), eq(certifierRemovals.organizationId, ctx.organizationId)));
  logger.info({ removalId }, "orphan certifier removal deleted");
}

export async function getCertifierRemovalById(
  ctx: OrgContext,
  id: string,
): Promise<CertifierRemovalRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierRemovals)
    .where(and(eq(certifierRemovals.id, id), eq(certifierRemovals.organizationId, ctx.organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listRemovalsForFacility(
  ctx: OrgContext,
  facilityId: string,
): Promise<CertifierRemovalRow[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(certifierRemovals)
    .where(and(eq(certifierRemovals.facilityId, facilityId), eq(certifierRemovals.organizationId, ctx.organizationId)))
    .orderBy(desc(certifierRemovals.createdAt));
}

// A credit batch row with its durability tier join-derived from the facility
// (ADR 0021) — the tier is no longer a batch column, so it is re-attached here
// for the ~few callers (removal breakdown, certify context) that branch on it.
export type CreditBatchRowWithTier = CreditBatchRow & {
  durabilityOption: DurabilityOption;
};

export async function getCreditBatchesByRemovalId(
  ctx: OrgContext,
  removalId: string,
): Promise<CreditBatchRowWithTier[]> {
  requireOrgScope(ctx);
  const rows = await db
    .select({
      creditBatch: creditBatches,
      facilityDurabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatches.removalId, removalId), eq(creditBatches.organizationId, ctx.organizationId)));
  return rows.map((row) => ({
    ...row.creditBatch,
    durabilityOption: row.facilityDurabilityOption ?? DURABILITY_TIER_FALLBACK,
  }));
}

// A credit batch summarised for the GHG-statement cross-link accordion — the
// few fields an operator needs to recognise a batch (code, status, crediting
// window) without opening it.
export interface RemovalCreditBatchSummary {
  id: string;
  code: string;
  status: CreditBatchRow["status"];
  startDate: string;
  endDate: string;
}

// Batched credit-batch summaries for a set of removals — one grouped query
// instead of one getCreditBatchesByRemovalId per removal (the GHG-statement
// preview and detail views render many removals at once). Returns a
// removalId → summaries map ordered by batch code; removals with no batches
// are simply absent.
export async function getCreditBatchSummariesByRemovalIds(
  ctx: OrgContext,
  removalIds: string[],
): Promise<Map<string, RemovalCreditBatchSummary[]>> {
  requireOrgScope(ctx);
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
    })
    .from(creditBatches)
    .where(and(inArray(creditBatches.removalId, removalIds), eq(creditBatches.organizationId, ctx.organizationId)))
    .orderBy(creditBatches.code);

  for (const row of rows) {
    if (!row.removalId) continue;
    const summary: RemovalCreditBatchSummary = {
      id: row.id,
      code: row.code,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
    };
    const existing = result.get(row.removalId);
    if (existing) existing.push(summary);
    else result.set(row.removalId, [summary]);
  }
  return result;
}

// A credit batch not yet grouped into a removal, with the display fields the
// New-Removal wizard's selection cards render (code, crediting window,
// durability). Applied weight is derived per batch by the wizard (issue #285);
// carbon is intentionally absent because Isometric is the Removal authority.
export interface UngroupedCreditBatchRow {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  /** Join-derived from the batch's facility (ADR 0021), not a batch column. */
  durabilityOption: DurabilityOption;
}

// Credit batches in a facility not yet assigned to any removal — the pool the
// Removals hub / New-Removal wizard offers when grouping batches into a removal.
export async function listUngroupedCreditBatches(
  ctx: OrgContext,
  facilityId: string,
): Promise<UngroupedCreditBatchRow[]> {
  requireOrgScope(ctx);
  const rows = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      // Tier inherited from the facility (ADR 0021); this list is facility-scoped.
      durabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(
      and(
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.removalId),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(creditBatches.createdAt));
  return rows.map((row) => ({
    ...row,
    durabilityOption: row.durabilityOption ?? DURABILITY_TIER_FALLBACK,
  }));
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
  ctx: OrgContext,
  facilityId: string,
  creditBatchIds: string[],
): Promise<string> {
  requireOrgScope(ctx);
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
      .where(and(inArray(creditBatches.id, uniqueIds), eq(creditBatches.organizationId, ctx.organizationId)))
      .orderBy(creditBatches.id)
      .for("update");

    if (batches.length !== uniqueIds.length) {
      throw new SafeError("One or more selected credit batches no longer exist.");
    }
    for (const batch of batches) {
      if (batch.facilityId !== facilityId) {
        throw new SafeError(
          "A credit batch can only join a Removal in the same facility.",
        );
      }
      if (batch.removalId) {
        throw new SafeError(
          "A selected credit batch is already grouped into a Removal.",
        );
      }
    }

    const [removal] = await tx
      .insert(certifierRemovals)
      .values({ facilityId, organizationId: ctx.organizationId })
      .returning({ id: certifierRemovals.id });

    await tx
      .update(creditBatches)
      .set({ removalId: removal.id, updatedAt: sql`now()` })
      .where(and(inArray(creditBatches.id, uniqueIds), eq(creditBatches.organizationId, ctx.organizationId)));

    return removal.id;
  });
}

// Persists the derived reporting window after a successful submission.
export async function updateRemovalDates(
  ctx: OrgContext,
  removalId: string,
  args: { startedOn: string; completedOn: string },
): Promise<void> {
  requireOrgScope(ctx);
  await db
    .update(certifierRemovals)
    .set({
      startedOn: args.startedOn,
      completedOn: args.completedOn,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certifierRemovals.id, removalId), eq(certifierRemovals.organizationId, ctx.organizationId)));
}

export async function updateRemovalSourceBindingVerification(
  ctx: OrgContext,
  removalId: string,
  verification: StoredSourceBindingVerification,
): Promise<void> {
  requireOrgScope(ctx);
  const [updated] = await db
    .update(certifierRemovals)
    .set({
      metadata: sql`jsonb_set(
        coalesce(${certifierRemovals.metadata}, '{}'::jsonb),
        '{sourceBindingVerification}',
        ${JSON.stringify(verification)}::jsonb,
        true
      )`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierRemovals.id, removalId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: certifierRemovals.id });
  if (!updated) throw new SafeError("Removal not found.");
}
