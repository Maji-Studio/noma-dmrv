import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import {
  creditBatchApplications,
  creditBatches,
  creditBatchProductionRuns,
  type CreditBatch,
} from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { samples } from "@/db/schema/production";
import { feedstockTypes } from "@/db/schema/feedstock";
import { certifierRemovals } from "@/db/schema/certification";
import {
  DURABILITY_TIER_FALLBACK,
  type CreateCreditBatchData,
  type CreditBatchSampling,
  type DurabilityOption,
  type UpdateCreditBatchData,
} from "@/schemas/credit-batches";

import { requireOrgScope } from "./utils";
import {
  findOrCreateProductionProcess,
  getMethodBEligibilityForProcess,
} from "./production-processes";
import { hasCertifierCredentials } from "./certifier-credentials";
import {
  assertDeclaredFeedstockType,
  assertNoOverlappingCreditBatchCohort,
  lockCreditBatchDeclarationRuns,
  lockCreditBatchForUpdate,
  validateProductionRunIds,
} from "./credit-batch-membership";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";
import {
  getFacilityCertifierWithExecutor,
  loadCreditBatchAccounting,
  loadCreditBatchAccountingSafely,
  loadCreditBatchRollups,
  type CreditBatchAccounting,
  type CreditBatchCo2eStoredPreview,
  type CreditBatchRollup,
} from "./credit-batch-accounting";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { assertUnsampledBatchEligibility } from "@/lib/certification/credit-batch-sampling";
import { retireDocumentsForEntities } from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import {
  assertCreditBatchSlicesAreUnassigned,
  assertRemovalAllowsCreditBatchMutation,
} from "./credit-batch-certification-lock";
import { reconcileUnassignedCreditBatchApplicationSlices } from "./credit-batch-application-slices";
import { deleteCreditBatchApplicationSlices } from "./credit-batch-delete-slices";

export {
  getCo2eStoredPreviews,
} from "./credit-batch-accounting";
export type {
  ApplicationCo2eStoredPreview,
  CreditBatchCo2eStoredPreview,
} from "./credit-batch-accounting";
export {
  getCreditBatchProductionRunOptions,
} from "./credit-batch-production-run-options";
export type { CreditBatchProductionRunOption } from "./credit-batch-production-run-options";

// ============================================
// Credit Batch Data Access Layer
// ============================================

function includesCo2ePreview(
  accounting: CreditBatchRollup,
): accounting is CreditBatchAccounting {
  return "co2ePreview" in accounting;
}

export interface CreditBatchWithRelations extends CreditBatch {
  facility: { name: string } | null;
  /**
   * The batch's durability tier — join-derived from its facility (ADR 0021).
   * The tier is no longer a `credit_batches` column; every batch-loading query
   * re-attaches it from `facilities.durabilityOption` so the ~28 downstream
   * `batch.durabilityOption` read sites keep working unchanged.
   */
  durabilityOption: DurabilityOption;
  feedstockTypeName: string | null;
  applicationCount: number;
  applicationIds: string[];
  productionRunCount: number;
  productionRunIds: string[];
  /** Derived Σ member applications' biocharAppliedTons (issue #285). */
  appliedWeightTons: number;
  co2eStoredPreview: CreditBatchCo2eStoredPreview | null;
  previewAvailable: boolean;
}

type CreditBatchWithOptionalPreview = Omit<
  CreditBatchWithRelations,
  "co2eStoredPreview"
> & {
  co2eStoredPreview?: CreditBatchCo2eStoredPreview;
};

/**
 * A credit batch as it comes back from its own create or update. The write
 * committed, but the accounting roll-up opens its own transaction after that
 * commit and can fail on its own, so its fields are nullable here: `null`
 * means the roll-up did not load, never that nothing is applied. A row
 * answering `0 t` would describe a batch nobody read (issues #769, #797).
 * Readers render the shared missing-value token for a null, never a zero.
 */
export type SavedCreditBatch = Omit<
  CreditBatchWithRelations,
  "appliedWeightTons" | "applicationIds" | "applicationCount"
> & {
  appliedWeightTons: number | null;
  applicationIds: string[] | null;
  applicationCount: number | null;
};


async function resolveCreditBatchCertifier(
  ctx: OrgContext,
  executor: DbTransaction,
  facilityId: string
): Promise<"isometric" | null> {
  const provider = await getFacilityCertifierWithExecutor(ctx, executor, facilityId);
  if (provider && provider !== "isometric") {
    throw new SafeError(
      "Credit batches currently support only Isometric certifier mappings."
    );
  }
  return provider === "isometric" ? "isometric" : null;
}

/**
 * Get credit batches for a single facility, with facility info and application
 * count. Facility-scoped: credit batches belong to exactly one facility and
 * must never leak across the facility boundary.
 */
export async function getCreditBatches(
  ctx: OrgContext,
  facilityId: string
): Promise<CreditBatchWithRelations[]> {
  requireOrgScope(ctx);
  const batches = await db
    .select({
      creditBatch: creditBatches,
      facilityName: facilities.name,
      facilityDurabilityOption: facilities.durabilityOption,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(creditBatches.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)))
    .orderBy(desc(creditBatches.createdAt));

  const batchIds = batches.map((b) => b.creditBatch.id);

  if (batchIds.length === 0) {
    return [];
  }

  const accountingByBatch = await loadCreditBatchRollups(ctx, batchIds);

  return batches.map((b) => {
    const accounting = accountingByBatch[b.creditBatch.id];
    const productionRunIds =
      accounting?.lineageFacts.productionRunIds ?? [];
    const applicationIds = accounting?.lineageFacts.applicationIds ?? [];
    return {
      ...b.creditBatch,
      facility: b.facilityName ? { name: b.facilityName } : null,
      durabilityOption: b.facilityDurabilityOption ?? DURABILITY_TIER_FALLBACK,
      feedstockTypeName: b.feedstockTypeName,
      applicationCount: applicationIds.length,
      applicationIds,
      productionRunCount: productionRunIds.length,
      productionRunIds,
      appliedWeightTons: accounting?.appliedWeightTons ?? 0,
      co2eStoredPreview: null,
      previewAvailable: false,
    };
  });
}

/**
 * Resolve the active certification scope for a credit batch. Newly applied,
 * unassigned mass takes precedence and returns null; otherwise the newest
 * owning Removal is selected deterministically.
 */
export async function getCreditBatchActiveScopeRemovalId(
  ctx: OrgContext,
  id: string,
): Promise<string | null> {
  requireOrgScope(ctx);
  const [batch] = await db
    .select({ id: creditBatches.id })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.id, id),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!batch) {
    throw new SafeError("Credit batch not found");
  }
  const slices = await db
    .select({ removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications)
    .leftJoin(
      certifierRemovals,
      and(
        eq(certifierRemovals.id, creditBatchApplications.removalId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, id),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(
      sql`${certifierRemovals.createdAt} desc nulls last`,
      desc(certifierRemovals.id),
    );
  if (slices.some((slice) => slice.removalId == null)) return null;
  return slices[0]?.removalId ?? null;
}

/**
 * Get credit batch by ID with full details
 */
export async function getCreditBatchById(
  ctx: OrgContext,
  id: string,
  options?: { skipPreview?: false }
): Promise<CreditBatchWithRelations | null>;
export async function getCreditBatchById(
  ctx: OrgContext,
  id: string,
  options: { skipPreview: true }
): Promise<CreditBatchWithOptionalPreview | null>;
export async function getCreditBatchById(
  ctx: OrgContext,
  id: string,
  options?: { skipPreview?: boolean }
): Promise<CreditBatchWithRelations | CreditBatchWithOptionalPreview | null> {
  requireOrgScope(ctx);
  const [batch] = await db
    .select({
      creditBatch: creditBatches,
      facilityName: facilities.name,
      facilityDurabilityOption: facilities.durabilityOption,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(creditBatches.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId)));

  if (!batch) {
    return null;
  }

  const durabilityOption =
    batch.facilityDurabilityOption ?? DURABILITY_TIER_FALLBACK;

  const accounting = options?.skipPreview
    ? (await loadCreditBatchRollups(ctx, [id]))[id]
    : (await loadCreditBatchAccounting(ctx, [id]))[id];
  if (!accounting) {
    throw new SafeError("Credit batch accounting could not be loaded");
  }
  const productionRunIds = accounting.lineageFacts.productionRunIds;
  const applicationIds = accounting.lineageFacts.applicationIds;

  const result = {
    ...batch.creditBatch,
    facility: batch.facilityName ? { name: batch.facilityName } : null,
    durabilityOption,
    feedstockTypeName: batch.feedstockTypeName,
    applicationCount: applicationIds.length,
    applicationIds,
    productionRunCount: productionRunIds.length,
    productionRunIds,
    appliedWeightTons: accounting.appliedWeightTons,
    co2eStoredPreview: null,
    previewAvailable: false,
  };

  if (options?.skipPreview) {
    return result;
  }
  if (!includesCo2ePreview(accounting)) {
    throw new SafeError("Credit batch preview could not be loaded");
  }

  return {
    ...result,
    co2eStoredPreview: accounting.co2ePreview,
    previewAvailable: true,
  };
}

/**
 * Get credit batch by code
 */
export async function getCreditBatchByCode(
  ctx: OrgContext,
  code: string
): Promise<CreditBatch | null> {
  requireOrgScope(ctx);
  const [creditBatch] = await db
    .select()
    .from(creditBatches)
    .where(and(eq(creditBatches.code, code), eq(creditBatches.organizationId, ctx.organizationId)));
  return creditBatch ?? null;
}

/**
 * Create a new credit batch with production-run membership.
 */
export async function createCreditBatch(
  ctx: OrgContext,
  data: Omit<CreateCreditBatchData, "sampling"> & {
    code: string;
    sampling?: CreditBatchSampling;
  }
): Promise<SavedCreditBatch> {
  requireOrgScope(ctx);
  const { productionRunIds, ...batchData } = data;
  let resolvedProductionRunIds = productionRunIds ?? [];
  const sampling = data.sampling ?? "sampled";
  const hasIsometricCredentials =
    sampling === "unsampled"
      ? await hasCertifierCredentials(ctx, "isometric")
      : false;

  const created = await db.transaction(async (tx) => {
    assertCreditBatchProductionWindow(batchData.startDate, batchData.endDate);

    // ADR 0016 (amended 2026-07-04): the credit batch is the protocol production
    // batch (one feedstock), and the feedstock type is now DECLARED on the form,
    // not derived from the runs. Validate the member runs FIRST (existence,
    // facility, window, prior assignment), then GUARD that they all match the
    // declared feedstock type, then find-or-create the (facility, feedstock)
    // production process this batch is a <=1-month slice of.
    const { runIds, lockedRuns } = await lockCreditBatchDeclarationRuns(
      ctx,
      tx,
      {
        facilityId: batchData.facilityId,
        feedstockTypeId: batchData.feedstockTypeId,
        startDate: batchData.startDate,
        endDate: batchData.endDate,
        requestedProductionRunIds: resolvedProductionRunIds,
      },
    );
    await assertNoOverlappingCreditBatchCohort(ctx, tx, {
      facilityId: batchData.facilityId,
      feedstockTypeId: batchData.feedstockTypeId,
      startDate: batchData.startDate,
      endDate: batchData.endDate,
    });
    const certifier = await resolveCreditBatchCertifier(ctx, tx, batchData.facilityId);
    const feedstockTypeId = batchData.feedstockTypeId;
    const process = await findOrCreateProductionProcess(
      ctx,
      { facilityId: batchData.facilityId, feedstockTypeId },
      tx,
    );
    resolvedProductionRunIds = runIds;
    await validateProductionRunIds(
      ctx,
      tx,
      runIds,
      batchData.facilityId,
      batchData.startDate,
      batchData.endDate,
      undefined,
      lockedRuns,
    );
    await assertDeclaredFeedstockType(ctx, tx, runIds, feedstockTypeId);
    if (sampling === "unsampled") {
      if (certifier !== "isometric" || !hasIsometricCredentials) {
        throw new SafeError(
          "Unsampled credit batches require an Isometric connection for the organization and facility.",
        );
      }
      const eligibility = await getMethodBEligibilityForProcess(
        ctx,
        process,
        tx,
        new Date(),
      );
      assertUnsampledBatchEligibility(eligibility);
    }

    // Insert the credit batch
    const [batch] = await tx
      .insert(creditBatches)
      .values({
        organizationId: ctx.organizationId,
        code: batchData.code,
        facilityId: batchData.facilityId,
        feedstockTypeId,
        productionProcessId: process.id,
        startDate: formatUtcDate(batchData.startDate),
        endDate: formatUtcDate(batchData.endDate),
        certifier,
        sampling,
        // durabilityOption is no longer a batch column — inherited from the
        // facility (ADR 0021).
        hToCorgRatio: batchData.hToCorgRatio ?? null,
        meanRandomReflectancePercent:
          batchData.meanRandomReflectancePercent ?? null,
        stdRandomReflectance: batchData.stdRandomReflectance ?? null,
        meanNonReactiveCarbonPercent:
          batchData.meanNonReactiveCarbonPercent ?? null,
        stdNonReactiveCarbonPercent:
          batchData.stdNonReactiveCarbonPercent ?? null,
        fDurableCalculated: batchData.fDurableCalculated ?? null,
        bufferPoolPercent: batchData.bufferPoolPercent ?? null,
        registry: batchData.registry || null,
        value: batchData.value ?? null,
        currency: batchData.currency,
        siteManagementNotes: batchData.siteManagementNotes || null,
      })
      .returning();

    if (runIds.length > 0) {
      await tx.insert(creditBatchProductionRuns).values(
        runIds.map((productionRunId) => ({
          organizationId: ctx.organizationId,
          creditBatchId: batch.id,
          productionRunId,
        }))
      );
      // Back-fill the member runs' existing lab samples onto this batch so they
      // characterise it (ADR 0016 — both links stay populated). The per-run
      // unique constraint means these samples can't already belong elsewhere.
      await tx
        .update(samples)
        .set({ creditBatchId: batch.id, updatedAt: new Date() })
        .where(and(inArray(samples.productionRunId, runIds), eq(samples.organizationId, ctx.organizationId)));
    }

    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
      creditBatchIds: [batch.id],
    });

    return readCommittedCreditBatch(ctx, tx, batch);
  });

  return describeSavedCreditBatch(ctx, {
    ...created,
    memberProductionRunIds: resolvedProductionRunIds,
  });
}

/** What a create or update knows about its batch from the write itself. */
interface CommittedCreditBatch {
  batch: CreditBatch;
  facility: { name: string; durabilityOption: DurabilityOption } | undefined;
  feedstockType: { name: string } | undefined;
  memberProductionRunIds: string[];
}

/**
 * Read a committed batch's relations inside the writing transaction so the
 * commit and the description of it cannot come apart (issue #769).
 */
async function readCommittedCreditBatch(
  ctx: OrgContext,
  tx: DbTransaction,
  batch: CreditBatch,
): Promise<Omit<CommittedCreditBatch, "memberProductionRunIds">> {
  const [facility] = await tx
    .select({ name: facilities.name, durabilityOption: facilities.durabilityOption })
    .from(facilities)
    .where(and(eq(facilities.id, batch.facilityId), eq(facilities.organizationId, ctx.organizationId)));
  const [feedstockType] = await tx
    .select({ name: feedstockTypes.name })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.id, batch.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));
  return { batch, facility, feedstockType };
}

/**
 * Describe a batch whose write has committed. The accounting roll-up opens its
 * own transaction, so it cannot join the write and necessarily runs after the
 * commit. The batch exists either way: when the roll-up does not load, the
 * batch comes back with `previewAvailable: false` (as list reads already do)
 * instead of failing a save that landed. The caller turns that into a warning
 * (issues #769, #797).
 */
async function describeSavedCreditBatch(
  ctx: OrgContext,
  committed: CommittedCreditBatch,
): Promise<SavedCreditBatch> {
  const { batch, facility, feedstockType } = committed;
  const durabilityOption = facility?.durabilityOption ?? DURABILITY_TIER_FALLBACK;
  const accounting = await loadCreditBatchAccountingSafely(ctx, batch.id);
  // The member runs are known from the write itself, so they stay populated
  // either way. The application slices and the applied tonnage are only known
  // from the roll-up: without it they are unknown, not zero.
  const memberProductionRunIds =
    accounting?.lineageFacts.productionRunIds ?? committed.memberProductionRunIds;
  const applicationIds = accounting?.lineageFacts.applicationIds ?? null;

  return {
    ...batch,
    facility: facility ? { name: facility.name } : null,
    durabilityOption,
    feedstockTypeName: feedstockType?.name ?? null,
    applicationCount: applicationIds?.length ?? null,
    applicationIds,
    productionRunCount: memberProductionRunIds.length,
    productionRunIds: memberProductionRunIds,
    appliedWeightTons: accounting?.appliedWeightTons ?? null,
    co2eStoredPreview: accounting?.co2ePreview ?? null,
    previewAvailable: accounting !== undefined,
  };
}

/** The batch's member production-run ids, read under the given transaction. */
async function readMemberProductionRunIds(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<string[]> {
  const links = await tx
    .select({ productionRunId: creditBatchProductionRuns.productionRunId })
    .from(creditBatchProductionRuns)
    .where(and(
      eq(creditBatchProductionRuns.creditBatchId, creditBatchId),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ));
  return links.map((link) => link.productionRunId);
}

/**
 * Update a credit batch
 */
export async function updateCreditBatch(
  ctx: OrgContext,
  id: string,
  data: Omit<UpdateCreditBatchData, "creditBatchId">
): Promise<SavedCreditBatch> {
  requireOrgScope(ctx);
  const { productionRunIds, ...updateFields } = data;
  const cohortDefinitionUpdated =
    updateFields.facilityId !== undefined ||
    updateFields.feedstockTypeId !== undefined ||
    updateFields.startDate !== undefined ||
    updateFields.endDate !== undefined;
  const shouldRefreshMembership =
    productionRunIds !== undefined || cohortDefinitionUpdated;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  // Only include fields that are explicitly provided
  if (updateFields.code !== undefined) updateData.code = updateFields.code;
  if (updateFields.facilityId !== undefined)
    updateData.facilityId = updateFields.facilityId;
  if (updateFields.startDate !== undefined)
    updateData.startDate = formatUtcDate(updateFields.startDate);
  if (updateFields.endDate !== undefined)
    updateData.endDate = formatUtcDate(updateFields.endDate);
  // durabilityOption is inherited from the facility (ADR 0021) — no batch write.
  if (updateFields.hToCorgRatio !== undefined)
    updateData.hToCorgRatio = updateFields.hToCorgRatio;
  if (updateFields.meanRandomReflectancePercent !== undefined)
    updateData.meanRandomReflectancePercent =
      updateFields.meanRandomReflectancePercent;
  if (updateFields.stdRandomReflectance !== undefined)
    updateData.stdRandomReflectance = updateFields.stdRandomReflectance;
  if (updateFields.meanNonReactiveCarbonPercent !== undefined)
    updateData.meanNonReactiveCarbonPercent =
      updateFields.meanNonReactiveCarbonPercent;
  if (updateFields.stdNonReactiveCarbonPercent !== undefined)
    updateData.stdNonReactiveCarbonPercent =
      updateFields.stdNonReactiveCarbonPercent;
  if (updateFields.fDurableCalculated !== undefined)
    updateData.fDurableCalculated = updateFields.fDurableCalculated;
  if (updateFields.bufferPoolPercent !== undefined)
    updateData.bufferPoolPercent = updateFields.bufferPoolPercent;
  if (updateFields.registry !== undefined)
    updateData.registry = updateFields.registry || null;
  if (updateFields.value !== undefined) updateData.value = updateFields.value;
  if (updateFields.currency !== undefined)
    updateData.currency = updateFields.currency;
  if (updateFields.siteManagementNotes !== undefined)
    updateData.siteManagementNotes = updateFields.siteManagementNotes || null;

  const committed = await db.transaction(async (tx) => {
    // Discover the current membership without taking a batch/removal lock, then
    // lock old + prospective + auto-discovered members in one sorted run-row
    // batch. Every writer follows run -> process scope -> batch ->
    // removal/certification order; production-run reopen also locks the run
    // before checking membership.
    const currentProductionRunIds = shouldRefreshMembership
      ? await readMemberProductionRunIds(ctx, tx, id)
      : [];
    const [declarationSnapshot] = shouldRefreshMembership
      ? await tx
          .select({
            facilityId: creditBatches.facilityId,
            feedstockTypeId: creditBatches.feedstockTypeId,
            startDate: creditBatches.startDate,
            endDate: creditBatches.endDate,
          })
          .from(creditBatches)
          .where(and(
            eq(creditBatches.id, id),
            eq(creditBatches.organizationId, ctx.organizationId),
          ))
          .limit(1)
      : [undefined];
    if (shouldRefreshMembership && !declarationSnapshot) {
      throw new SafeError("Credit batch not found");
    }

    let resolvedProductionRunIds = productionRunIds;
    let lockedMembershipRuns = [] as Awaited<
      ReturnType<typeof lockCreditBatchDeclarationRuns>
    >["lockedRuns"];
    if (shouldRefreshMembership && declarationSnapshot) {
      const declaration = await lockCreditBatchDeclarationRuns(ctx, tx, {
        facilityId:
          updateFields.facilityId ?? declarationSnapshot.facilityId,
        feedstockTypeId:
          updateFields.feedstockTypeId ??
          declarationSnapshot.feedstockTypeId,
        startDate:
          updateFields.startDate ?? declarationSnapshot.startDate,
        endDate: updateFields.endDate ?? declarationSnapshot.endDate,
        requestedProductionRunIds:
          productionRunIds ?? currentProductionRunIds,
        currentProductionRunIds,
      });
      resolvedProductionRunIds = declaration.runIds;
      lockedMembershipRuns = declaration.lockedRuns;
    }

    const existingBatch = await lockCreditBatchForUpdate(ctx, tx, id, {
      facilityId: updateFields.facilityId,
      feedstockTypeId: updateFields.feedstockTypeId,
    });

    if (shouldRefreshMembership) {
      if (
        !declarationSnapshot ||
        existingBatch.facilityId !== declarationSnapshot.facilityId ||
        existingBatch.feedstockTypeId !==
          declarationSnapshot.feedstockTypeId ||
        existingBatch.startDate !== declarationSnapshot.startDate ||
        existingBatch.endDate !== declarationSnapshot.endDate
      ) {
        throw new SafeError(
          "The credit batch cohort changed while this update was being prepared. Refresh and retry.",
        );
      }
      const lockedCurrentMembership = await tx
        .select({ productionRunId: creditBatchProductionRuns.productionRunId })
        .from(creditBatchProductionRuns)
        .where(and(
          eq(creditBatchProductionRuns.creditBatchId, id),
          eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
        ));
      const discoveredIds = [...currentProductionRunIds].sort();
      const lockedIds = lockedCurrentMembership
        .map((link) => link.productionRunId)
        .sort();
      if (
        discoveredIds.length !== lockedIds.length ||
        discoveredIds.some((runId, index) => runId !== lockedIds[index])
      ) {
        throw new SafeError(
          "Credit batch membership changed while this update was being prepared. Refresh and retry.",
        );
      }
    }

    await assertRemovalAllowsCreditBatchMutation(ctx, tx, id, "update");
    if (shouldRefreshMembership) {
      await assertCreditBatchSlicesAreUnassigned(ctx, tx, id);
    }

    const targetFacilityId = updateFields.facilityId ?? existingBatch.facilityId;
    // Resolve the effective date window after update
    const effectiveStartDate = updateFields.startDate
      ? formatUtcDate(updateFields.startDate)
      : existingBatch.startDate;
    const effectiveEndDate = updateFields.endDate
      ? formatUtcDate(updateFields.endDate)
      : existingBatch.endDate;

    assertCreditBatchProductionWindow(effectiveStartDate, effectiveEndDate);

    const effectiveFeedstockTypeId =
      updateFields.feedstockTypeId ?? existingBatch.feedstockTypeId;
    await assertNoOverlappingCreditBatchCohort(ctx, tx, {
      facilityId: targetFacilityId,
      feedstockTypeId: effectiveFeedstockTypeId,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      excludeCreditBatchId: id,
    });

    updateData.certifier = await resolveCreditBatchCertifier(ctx, tx, targetFacilityId);

    if (resolvedProductionRunIds !== undefined) {
      await validateProductionRunIds(
        ctx,
        tx,
        resolvedProductionRunIds,
        targetFacilityId,
        effectiveStartDate,
        effectiveEndDate,
        id,
        lockedMembershipRuns.filter((run) =>
          resolvedProductionRunIds.includes(run.id),
        ),
      );
    }

    // ADR 0016 (amended 2026-07-04): feedstock type is DECLARED, not derived.
    // Re-guard the membership against the effective declared type + refresh the
    // (facility, feedstock) production process whenever the runs, the facility,
    // or the declared type changes — any of the three can shift which process
    // this batch belongs to, or make the member runs mismatch the declaration.
    const feedstockRunIds = resolvedProductionRunIds;
    if (feedstockRunIds !== undefined) {
      await assertDeclaredFeedstockType(ctx, tx, feedstockRunIds, effectiveFeedstockTypeId);
      const process = await findOrCreateProductionProcess(
        ctx,
        { facilityId: targetFacilityId, feedstockTypeId: effectiveFeedstockTypeId },
        tx,
      );
      updateData.feedstockTypeId = effectiveFeedstockTypeId;
      updateData.productionProcessId = process.id;
    }

    const [updatedBatch] = await tx
      .update(creditBatches)
      .set(updateData)
      .where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId)))
      .returning();
    if (!updatedBatch) {
      throw new SafeError("Credit batch not found");
    }

    if (shouldRefreshMembership) {
      await tx
        .delete(creditBatchProductionRuns)
        .where(and(eq(creditBatchProductionRuns.creditBatchId, id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)));

      if (
        resolvedProductionRunIds &&
        resolvedProductionRunIds.length > 0
      ) {
        await tx.insert(creditBatchProductionRuns).values(
          resolvedProductionRunIds.map((productionRunId) => ({
            organizationId: ctx.organizationId,
            creditBatchId: id,
            productionRunId,
          }))
        );
      }

      // Re-point this batch's sample links to match the new member-run set
      // (ADR 0016): unlink samples whose run left the batch, then link the
      // current member runs' samples. The per-run unique constraint guarantees a
      // member run's samples can't already belong to another batch.
      // Scope the unlink to RUN-BACKED samples — a commingled/batch-level sample
      // linked directly with a null productionRunId has no run to leave, so it
      // must survive a membership edit (it'd otherwise vanish from durability
      // readiness, aggregation, and the source candidate walk).
      await tx
        .update(samples)
        .set({ creditBatchId: null, updatedAt: new Date() })
        .where(
          and(
            eq(samples.creditBatchId, id),
            isNotNull(samples.productionRunId),
            eq(samples.organizationId, ctx.organizationId),
          ),
        );
      if (
        resolvedProductionRunIds &&
        resolvedProductionRunIds.length > 0
      ) {
        await tx
          .update(samples)
          .set({ creditBatchId: id, updatedAt: new Date() })
          .where(and(inArray(samples.productionRunId, resolvedProductionRunIds), eq(samples.organizationId, ctx.organizationId)));
      }

      await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
        creditBatchIds: [id],
      });
    }

    // The member set after this write: the refreshed one when membership was
    // touched, otherwise the untouched links read under the same transaction.
    const memberProductionRunIds = shouldRefreshMembership
      ? (resolvedProductionRunIds ?? [])
      : await readMemberProductionRunIds(ctx, tx, id);

    return {
      ...(await readCommittedCreditBatch(ctx, tx, updatedBatch)),
      memberProductionRunIds,
    };
  });

  return describeSavedCreditBatch(ctx, committed);
}

/**
 * Delete a credit batch and its production-run membership links.
 */
export async function deleteCreditBatch(ctx: OrgContext, id: string): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async (tx) => {
    // Lock the batch so a concurrent regroup/submit can't move it mid-delete.
    const [batch] = await tx
      .select({ id: creditBatches.id })
      .from(creditBatches)
      .where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);

    if (!batch) {
      throw new SafeError("Credit batch not found");
    }

    await assertRemovalAllowsCreditBatchMutation(ctx, tx, id, "delete");

    // Clear app-layer sample links, then delete membership links and the batch.
    await tx
      .update(samples)
      .set({ creditBatchId: null, updatedAt: new Date() })
      .where(and(eq(samples.creditBatchId, id), eq(samples.organizationId, ctx.organizationId)));
    await tx
      .delete(creditBatchProductionRuns)
      .where(and(eq(creditBatchProductionRuns.creditBatchId, id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)));
    await deleteCreditBatchApplicationSlices(ctx, tx, id);
    await tx.delete(creditBatches).where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId)));

    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "credit_batch", entityId: id },
    ]);
  });
  await processPendingStorageObjectDeletions(ctx);
}

/**
 * Check if credit batch code exists
 */
export async function creditBatchCodeExists(
  ctx: OrgContext,
  code: string,
  excludeId?: string
): Promise<boolean> {
  // Defense-in-depth: getCreditBatchByCode below also enforces auth, but this
  // guard is kept intentionally so the check holds even if that call changes.
  requireOrgScope(ctx);
  const existing = await getCreditBatchByCode(ctx, code);
  if (!existing) return false;
  if (excludeId && existing.id === excludeId) return false;
  return true;
}
