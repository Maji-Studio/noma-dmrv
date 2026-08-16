import { and, asc, desc, eq, exists, gte, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import {
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import {
  creditBatchApplications,
  creditBatches,
} from "@/db/schema/credits";
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
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { requireOrgScope } from "./utils";
import { reconcileUnassignedCreditBatchApplicationSlices } from "./credit-batch-application-slices";

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

export interface ProductionClaimDraftContender {
  creditBatchId: string;
  removalId: string;
  submissionId: string;
  createdAt: Date;
}

export async function listProductionClaimDraftContenders(
  ctx: OrgContext,
  creditBatchIds: string[],
): Promise<ProductionClaimDraftContender[]> {
  requireOrgScope(ctx);
  if (creditBatchIds.length === 0) return [];
  const removalSlices = alias(
    creditBatchApplications,
    "production_claim_removal_slices",
  );
  const removalApplications = alias(
    applications,
    "production_claim_removal_applications",
  );
  return db
    .select({
      creditBatchId: creditBatchApplications.creditBatchId,
      removalId: certificationSubmissions.localEntityId,
      submissionId: certificationSubmissions.id,
      createdAt: certificationSubmissions.createdAt,
    })
    .from(creditBatchApplications)
    .innerJoin(
      certificationSubmissions,
      and(
        eq(
          certificationSubmissions.localEntityId,
          creditBatchApplications.removalId,
        ),
        eq(
          certificationSubmissions.organizationId,
          creditBatchApplications.organizationId,
        ),
      ),
    )
    .innerJoin(
      removalSlices,
      and(
        eq(
          removalSlices.removalId,
          certificationSubmissions.localEntityId,
        ),
        eq(
          removalSlices.organizationId,
          certificationSubmissions.organizationId,
        ),
      ),
    )
    .innerJoin(
      removalApplications,
      and(
        eq(removalApplications.id, removalSlices.applicationId),
        eq(
          removalApplications.organizationId,
          certificationSubmissions.organizationId,
        ),
      ),
    )
    .where(
      and(
        inArray(creditBatchApplications.creditBatchId, creditBatchIds),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(certificationSubmissions.submissionType, "removal"),
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.status, "draft"),
        gte(
          certificationSubmissions.lockedAt,
          new Date(Date.now() - LOCK_TTL_MS),
        ),
      ),
    )
    .groupBy(
      creditBatchApplications.creditBatchId,
      certificationSubmissions.localEntityId,
      certificationSubmissions.id,
      certificationSubmissions.createdAt,
    )
    .orderBy(
      asc(creditBatchApplications.creditBatchId),
      // §8.6.2 assigns the production bucket to the earliest reporting
      // quarter, not whichever operator happened to click Submit first. A
      // Removal completes on its latest member Application, so derive the
      // quarter from every frozen slice owned by the contender.
      asc(sql`date_trunc('quarter', max(${removalApplications.applicationDate}))`),
      asc(certificationSubmissions.createdAt),
      asc(certificationSubmissions.id),
    );
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
    .select({ id: creditBatchApplications.applicationId })
    .from(creditBatchApplications)
    .where(and(eq(creditBatchApplications.removalId, removalId), eq(creditBatchApplications.organizationId, ctx.organizationId)))
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
    .selectDistinct({
      creditBatch: creditBatches,
      facilityDurabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .innerJoin(
      creditBatchApplications,
      and(
        eq(creditBatchApplications.creditBatchId, creditBatches.id),
        eq(creditBatchApplications.removalId, removalId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(eq(creditBatches.organizationId, ctx.organizationId));
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
    .selectDistinct({
      removalId: creditBatchApplications.removalId,
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
    })
    .from(creditBatches)
    .innerJoin(
      creditBatchApplications,
      and(
        eq(creditBatchApplications.creditBatchId, creditBatches.id),
        inArray(creditBatchApplications.removalId, removalIds),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .where(eq(creditBatches.organizationId, ctx.organizationId))
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

// Credit batches with newly applied mass not yet assigned to any Removal.
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
        exists(
          db
            .select({ value: sql`1` })
            .from(creditBatchApplications)
            .where(
              and(
                eq(creditBatchApplications.creditBatchId, creditBatches.id),
                isNull(creditBatchApplications.removalId),
                eq(creditBatchApplications.organizationId, ctx.organizationId),
              ),
            ),
        ),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(creditBatches.createdAt));
  return rows.map((row) => ({
    ...row,
    durabilityOption: row.durabilityOption ?? DURABILITY_TIER_FALLBACK,
  }));
}

// Creates a Removal and atomically assigns each selected Application's complete
// unassigned slice set. An Application with any previously frozen sibling
// slice is rejected; a later Application can still place newly applied mass
// from the same physical production batch into a follow-up Removal.
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
    }

    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
      creditBatchIds: uniqueIds,
    });
    const slices = await tx
      .select({
        creditBatchId: creditBatchApplications.creditBatchId,
        applicationId: creditBatchApplications.applicationId,
      })
      .from(creditBatchApplications)
      .where(
        and(
          inArray(creditBatchApplications.creditBatchId, uniqueIds),
          isNull(creditBatchApplications.removalId),
          eq(creditBatchApplications.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(
        creditBatchApplications.creditBatchId,
        creditBatchApplications.applicationId,
      )
      .for("update");
    const batchesWithSlices = new Set(slices.map((slice) => slice.creditBatchId));
    if (uniqueIds.some((id) => !batchesWithSlices.has(id))) {
      throw new SafeError(
        "A selected credit batch has no new unassigned applied mass. Refresh and select it again after another Application is recorded.",
      );
    }

    const selectedApplicationIds = [
      ...new Set(slices.map((slice) => slice.applicationId)),
    ];
    // Reconcile by Application as well as by the selected batches so legacy
    // or concurrently-created sibling slices cannot stay invisible. A single
    // physical Application must be captured completely by one Removal.
    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
      applicationIds: selectedApplicationIds,
    });
    const siblingSlices = await tx
      .select({
        creditBatchId: creditBatchApplications.creditBatchId,
        applicationId: creditBatchApplications.applicationId,
        removalId: creditBatchApplications.removalId,
      })
      .from(creditBatchApplications)
      .where(
        and(
          inArray(
            creditBatchApplications.applicationId,
            selectedApplicationIds,
          ),
          eq(creditBatchApplications.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(
        creditBatchApplications.applicationId,
        creditBatchApplications.creditBatchId,
      )
      .for("update");
    if (siblingSlices.some((slice) => slice.removalId != null)) {
      throw new SafeError(
        "A selected Application is already partly assigned to another Removal. Keep all of that Application's credit-batch slices with its existing Removal.",
      );
    }
    const unassignedSiblingSlices = siblingSlices.filter(
      (slice) => slice.removalId == null,
    );
    const selectedIdSet = new Set(uniqueIds);
    const omittedSiblingBatchIds = [
      ...new Set(
        unassignedSiblingSlices
          .filter((slice) => !selectedIdSet.has(slice.creditBatchId))
          .map((slice) => slice.creditBatchId),
      ),
    ];
    if (omittedSiblingBatchIds.length > 0) {
      throw new SafeError(
        "A selected Application also has unassigned mass in another credit batch. Select every related credit batch so the Application is assigned to one Removal in full.",
      );
    }

    const [removal] = await tx
      .insert(certifierRemovals)
      .values({ facilityId, organizationId: ctx.organizationId })
      .returning({ id: certifierRemovals.id });

    const assigned = await tx
      .update(creditBatchApplications)
      .set({ removalId: removal.id })
      .where(
        and(
          inArray(creditBatchApplications.creditBatchId, uniqueIds),
          isNull(creditBatchApplications.removalId),
          eq(creditBatchApplications.organizationId, ctx.organizationId),
        ),
      )
      .returning({ applicationId: creditBatchApplications.applicationId });
    if (assigned.length !== unassignedSiblingSlices.length) {
      throw new SafeError(
        "Application allocation changed while creating the Removal. Refresh and retry.",
      );
    }

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
