/**
 * Production-run create / update / delete operations, including bin-based
 * feedstock allocation and storage-location validation.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { isPgCheckViolation } from "@/db/errors";
import {
  productionRuns,
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRunReadings,
  incidentReports,
  facilities,
  reactors,
  storageLocations,
  operators,
  creditBatches,
  creditBatchProductionRuns,
} from "@/db/schema";
import {
  computeClampedDryMass,
  deriveMassDryKg,
} from "@/lib/calculations/mass-dry";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "../utils";
import { SafeError } from "@/lib/errors";
import {
  CODE_CONFLICT_MESSAGES,
  withUniqueCodeGuard,
} from "../code-generator";
import { getProductionRunById } from "./queries";
import type { ProductionRunWithRelations } from "./types";
import { assertCanMutateCertifiedLineage } from "../certification-lineage-guards";
import { lockActiveFacilityReference } from "../facility-reference-guards";
import { lockBinStocks } from "../lock-bin-stocks";
import {
  assertProductionRunStockSnapshot,
  assertProductionRunBiocharStockNotOverdrawn,
  deriveProductionRunUpdateBiocharStockState,
  lockProductionRunUpdateStock,
} from "../production-run-stock-locks";
import {
  assertNoReactorRunOverlap,
  isReactorStartUniqueViolation,
} from "./overlap";
import {
  assertProductionRunOutcome,
  assertProductionRunTransition,
  statusOccupiesReactor,
  type ProductionRunStatus,
} from "@/lib/production-runs/lifecycle";
import { retireDocumentsForEntities } from "../documents";
import { processPendingStorageObjectDeletions } from "../storage-object-deletions";
import { attachProductionRunToMatchingCreditBatch } from "../credit-batch-membership";
import {
  assertProductionRunTimesNotFuture,
  type ProductionRunMutationOptions,
} from "./future-time";
import { getProductionRunDependentProduct } from "./product-dependencies";
import {
  getProductionRunFeedstockDrawStorageIds,
  getProductionRunFeedstockDrawTotal,
  normalizeProductionRunFeedstockDraws,
  replaceProductionRunFeedstockDraws,
  sumProductionRunFeedstockDraws,
  validateProductionRunFeedstockDrawSources,
  type ProductionRunFeedstockDrawInput,
} from "./feedstock-draws";

const END_AFTER_START_CONSTRAINT = "production_runs_end_after_start";
const END_AFTER_START_MESSAGE = "End time must be after the start time";
const PREFLIGHT_OUTCOME_VIOLATIONS = [
  "end-not-after-start",
  "dry-mass-balance-exceeded",
] as const;

export class ProductionRunDependencyError extends SafeError {
  readonly conflict: { entity: string; id: string; code: string };

  constructor(
    message: string,
    conflict: { entity: string; id: string; code: string },
  ) {
    super(message);
    this.name = "ProductionRunDependencyError";
    this.conflict = conflict;
  }
}

/**
 * Validate that an output storage location exists, belongs to the facility, and is a biochar bin.
 */
async function validateBiocharStorageLocation(
  ctx: OrgContext,
  tx: DbTransaction,
  locationId: string,
  facilityId: string,
  label: string,
) {
  const [loc] = await tx
    .select({ id: storageLocations.id, facilityId: storageLocations.facilityId, type: storageLocations.type })
    .from(storageLocations)
    .where(
      and(
        eq(storageLocations.id, locationId),
        eq(storageLocations.organizationId, ctx.organizationId),
        isNull(storageLocations.archivedAt),
      ),
    );

  if (!loc) throw new SafeError(`${label} storage bin not found`);
  if (loc.facilityId !== facilityId) throw new SafeError(`${label} bin does not belong to the selected facility`);
  if (loc.type !== "biochar_bin") throw new SafeError("Selected storage bin is not a biochar bin");
}

/**
 * Create a new production run with bin-based feedstock allocation
 */
export async function createProductionRun(
  ctx: OrgContext,
  data: {
    code: string;
    facilityId: string;
    reactorId: string;
    status?: ProductionRunStatus;
    cancellationReason?: string | null;
    startTime: Date;
    endTime: Date | null;
    operatorId?: string | null;
    feedstockDraws?: ProductionRunFeedstockDrawInput[];
    /** @deprecated Compatibility input; converted immediately to one draw. */
    feedstockWetMassKg?: number | null;
    /** @deprecated Compatibility input; converted immediately to one draw. */
    feedstockStorageLocationId?: string | null;
    feedstockMoisturePercent?: number | null;
    feedingRateKgHr?: number | null;
    residenceTimeMinutes?: number | null;
    dieselOperationLiters?: number | null;
    dieselGensetLiters?: number | null;
    preprocessingFuelLiters?: number | null;
    electricityKwh?: number | null;
    biocharOutputKg?: number | null;
    biocharMoisturePercent?: number | null;
    biocharStorageLocationId?: string | null;
  },
  options: ProductionRunMutationOptions = {},
): Promise<ProductionRunWithRelations> {
  requireOrgScope(ctx);
  const now = options.now ?? new Date();
  assertProductionRunTimesNotFuture(data, now);
  if (data.operatorId) await assertSameOrg(ctx, operators, data.operatorId);

  // Verify facility exists and is active (no new children under an archived parent)
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }

  // Verify reactor exists and belongs to facility
  const [reactor] = await db
    .select({ id: reactors.id, facilityId: reactors.facilityId })
    .from(reactors)
    .where(and(eq(reactors.id, data.reactorId), eq(reactors.organizationId, ctx.organizationId)));

  if (!reactor) {
    throw new SafeError("Reactor not found");
  }

  if (reactor.facilityId !== data.facilityId) {
    throw new SafeError("Reactor does not belong to the selected facility");
  }

  const status = data.status ?? "draft";
  const feedstockDraws = normalizeProductionRunFeedstockDraws(
    data.feedstockDraws ??
      (data.feedstockStorageLocationId && data.feedstockWetMassKg
        ? [{
            storageLocationId: data.feedstockStorageLocationId,
            wetMassKg: data.feedstockWetMassKg,
          }]
        : []),
  );
  const feedstockWetMassKg = sumProductionRunFeedstockDraws(feedstockDraws);
  assertProductionRunTransition("draft", status);
  assertProductionRunOutcome(
    {
      status,
      startTime: data.startTime,
      endTime: data.endTime,
      endTimePresent: data.endTime !== null,
      cancellationReason: data.cancellationReason,
      biocharOutputKg: data.biocharOutputKg,
      biocharMoisturePercent: data.biocharMoisturePercent,
      feedstockWetMassKg,
      feedstockMoisturePercent: data.feedstockMoisturePercent,
      feedstock: {
        basis: "form-inputs",
        drawCount: feedstockDraws.length,
      },
    },
    { only: PREFLIGHT_OUTCOME_VIOLATIONS },
  );

  // Compute dry mass from wet mass + moisture
  const computedDryMass =
    feedstockDraws.length > 0 && data.feedstockMoisturePercent != null
      ? deriveMassDryKg(feedstockWetMassKg, data.feedstockMoisturePercent)
      : null;

  // Compute biochar dry mass from wet output + moisture, clamped to wet mass
  const biocharDryMass = computeClampedDryMass(data.biocharOutputKg, data.biocharMoisturePercent);

  // Create production run + M:M allocation in a transaction
  let run: typeof productionRuns.$inferSelect;
  try {
    run = await db.transaction(async (tx) => {
    await lockActiveFacilityReference(ctx, tx, data.facilityId);

    await lockBinStocks(ctx, tx, [
      ...feedstockDraws.map((draw) => draw.storageLocationId),
      data.feedstockStorageLocationId,
      data.biocharStorageLocationId,
    ]);

    // Reject an overlapping window before writing (serialized per-reactor).
    if (statusOccupiesReactor(status)) {
      await assertNoReactorRunOverlap(ctx, tx, {
        reactorId: data.reactorId,
        startTime: data.startTime,
        endTime: data.endTime,
      });
    }

    // Validate long-tail storage references before writing the run.
    if (data.biocharStorageLocationId) {
      await validateBiocharStorageLocation(ctx, tx, data.biocharStorageLocationId, data.facilityId, "Biochar");
    }
    if (data.feedstockStorageLocationId && feedstockDraws.length === 0) {
      await validateProductionRunFeedstockDrawSources(
        ctx,
        tx,
        [{ storageLocationId: data.feedstockStorageLocationId }],
        data.facilityId,
      );
    }

    const [created] = await tx
      .insert(productionRuns)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        facilityId: data.facilityId,
        status,
        cancellationReason: data.cancellationReason?.trim() || null,
        startTime: data.startTime,
        endTime: data.endTime,
        reactorId: data.reactorId,
        operatorId: data.operatorId ?? null,
        feedstockWetMassKg: feedstockDraws.length > 0 ? feedstockWetMassKg : null,
        feedstockMoisturePercent: data.feedstockMoisturePercent ?? null,
        feedstockMassDryKg: computedDryMass,
        feedingRateKgHr: data.feedingRateKgHr ?? null,
        residenceTimeMinutes: data.residenceTimeMinutes ?? null,
        dieselOperationLiters: data.dieselOperationLiters ?? null,
        dieselGensetLiters: data.dieselGensetLiters ?? null,
        preprocessingFuelLiters: data.preprocessingFuelLiters ?? null,
        electricityKwh: data.electricityKwh ?? null,
        biocharOutputKg: data.biocharOutputKg ?? null,
        biocharMoisturePercent: data.biocharMoisturePercent ?? null,
        biocharDryMassKg: biocharDryMass,
        biocharStorageLocationId: data.biocharStorageLocationId ?? null,
        feedstockStorageLocationId: null,
      })
      .returning();

    // Auto-populate M:M feedstock relationships from bin contents
    const consumedFeedstockWetKg = await replaceProductionRunFeedstockDraws(
      ctx,
      tx,
      {
        productionRunId: created.id,
        facilityId: data.facilityId,
        draws: feedstockDraws,
      },
    );

    // Unfiltered: window + dry-mass are eligible here but always pre-caught by
    // the PREFLIGHT_OUTCOME_VIOLATIONS check above over the same inputs — keep
    // that preflight scope or cancelled/draft runs start failing dry-mass here.
    assertProductionRunOutcome({
      status,
      startTime: data.startTime,
      endTime: data.endTime,
      endTimePresent: data.endTime !== null,
      biocharOutputKg: data.biocharOutputKg ?? null,
      biocharMoisturePercent: data.biocharMoisturePercent,
      feedstockWetMassKg,
      feedstockMoisturePercent: data.feedstockMoisturePercent,
      feedstock: { basis: "consumed-mass", consumedFeedstockWetKg },
      cancellationReason: data.cancellationReason ?? null,
    });

    await attachProductionRunToMatchingCreditBatch(ctx, tx, created.id);

    return created;
    });
  } catch (error) {
    if (isPgCheckViolation(error, END_AFTER_START_CONSTRAINT)) {
      throw new SafeError(END_AFTER_START_MESSAGE);
    }
    // Race backstop: map a raw (reactor, start_time) unique violation that
    // slipped past the advisory lock to the friendly overlap message.
    if (isReactorStartUniqueViolation(error)) {
      throw new SafeError(
        "Another production run on this reactor starts at that time. Choose a different start time.",
      );
    }
    throw error;
  }

  return getProductionRunById(ctx, run.id);
}

/**
 * Update an existing production run
 */
export async function updateProductionRun(
  ctx: OrgContext,
  productionRunId: string,
  data: {
    code?: string;
    facilityId?: string;
    reactorId?: string;
    status?: ProductionRunStatus;
    expectedUpdatedAt?: Date;
    cancellationReason?: string | null;
    startTime?: Date;
    endTime?: Date | null;
    operatorId?: string | null;
    feedstockDraws?: ProductionRunFeedstockDrawInput[];
    /** @deprecated Compatibility input; converted immediately to draw rows. */
    feedstockWetMassKg?: number | null;
    /** @deprecated Compatibility input; converted immediately to draw rows. */
    feedstockStorageLocationId?: string | null;
    feedstockMoisturePercent?: number | null;
    feedingRateKgHr?: number | null;
    residenceTimeMinutes?: number | null;
    dieselOperationLiters?: number | null;
    dieselGensetLiters?: number | null;
    preprocessingFuelLiters?: number | null;
    electricityKwh?: number | null;
    biocharOutputKg?: number | null;
    biocharMoisturePercent?: number | null;
    biocharStorageLocationId?: string | null;
  },
  options: ProductionRunMutationOptions = {},
): Promise<ProductionRunWithRelations> {
  requireOrgScope(ctx);
  const now = options.now ?? new Date();
  // Reject submitted future instants before any read or write. The merged
  // effective window is checked again after loading the existing record.
  assertProductionRunTimesNotFuture(
    {
      startTime: data.startTime,
      endTime: data.endTime,
    },
    now,
  );
  if (data.operatorId) await assertSameOrg(ctx, operators, data.operatorId);

  // Verify run exists
  const [existing] = await db
    .select()
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Production run not found");
  }
  const existingFeedstockStorageLocationIds =
    await getProductionRunFeedstockDrawStorageIds(ctx, db, productionRunId);
  let inputFeedstockDraws = data.feedstockDraws;
  if (
    inputFeedstockDraws === undefined &&
    (data.feedstockStorageLocationId !== undefined ||
      data.feedstockWetMassKg !== undefined)
  ) {
    const storageLocationId =
      data.feedstockStorageLocationId !== undefined
        ? data.feedstockStorageLocationId
        : existingFeedstockStorageLocationIds.length === 1
          ? existingFeedstockStorageLocationIds[0]
          : null;
    if (
      storageLocationId === null &&
      data.feedstockStorageLocationId === undefined &&
      existingFeedstockStorageLocationIds.length > 1
    ) {
      throw new SafeError(
        "This run draws from several bins. Send feedstockDraws to change its feedstock.",
      );
    }
    const wetMassKg =
      data.feedstockWetMassKg !== undefined
        ? data.feedstockWetMassKg
        : existing.feedstockWetMassKg;
    inputFeedstockDraws =
      storageLocationId && wetMassKg && wetMassKg > 0
        ? [{ storageLocationId, wetMassKg: Number(wetMassKg) }]
        : [];
  }
  const normalizedFeedstockDraws =
    inputFeedstockDraws === undefined
      ? undefined
      : normalizeProductionRunFeedstockDraws(inputFeedstockDraws);

  // Moving the run to another facility requires that facility to be active
  // (no children move under an archived parent — mirrors createProductionRun).
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  // Compute effective facility once — used for reactor + storage bin validation
  const targetFacilityId = data.facilityId ?? existing.facilityId;

  // Verify reactor belongs to the facility when reactor or facility changes
  const effectiveReactorId = data.reactorId !== undefined ? data.reactorId : existing.reactorId;
  if (effectiveReactorId && (data.reactorId !== undefined || data.facilityId !== undefined)) {
    const [reactor] = await db
      .select({ facilityId: reactors.facilityId })
      .from(reactors)
      .where(and(eq(reactors.id, effectiveReactorId), eq(reactors.organizationId, ctx.organizationId)));

    if (!reactor) {
      throw new SafeError("Reactor not found");
    }

    if (reactor.facilityId !== targetFacilityId) {
      throw new SafeError("Reactor does not belong to the selected facility");
    }
  }

  // Preserve the original pre-transaction ordering for window and dry-mass
  // errors while routing both rules through the lifecycle decision function.
  const effectiveStartTime = data.startTime ?? existing.startTime;
  const effectiveEndTime =
    data.endTime !== undefined ? data.endTime : existing.endTime;
  assertProductionRunTimesNotFuture(
    {
      startTime: effectiveStartTime,
      endTime: effectiveEndTime,
    },
    now,
  );
  const effectiveStatus = data.status ?? existing.status;
  const effectiveFeedstockWetMassKg =
    normalizedFeedstockDraws !== undefined
      ? sumProductionRunFeedstockDraws(normalizedFeedstockDraws)
      : Number(existing.feedstockWetMassKg ?? 0);
  const effectiveFeedstockDrawCount =
    normalizedFeedstockDraws?.length ??
    existingFeedstockStorageLocationIds.length;

  // Update production run + M:M re-allocation in a transaction
  const updateData: Record<string, unknown> = {
    updatedAt: now,
  };

  if (data.code !== undefined) updateData.code = data.code;
  if (data.facilityId !== undefined) updateData.facilityId = data.facilityId;
  if (data.reactorId !== undefined) updateData.reactorId = data.reactorId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.cancellationReason !== undefined) {
    updateData.cancellationReason = data.cancellationReason?.trim() || null;
  }
  if (data.startTime !== undefined) updateData.startTime = data.startTime;
  if (data.endTime !== undefined) updateData.endTime = data.endTime;
  if (data.operatorId !== undefined) updateData.operatorId = data.operatorId;
  if (normalizedFeedstockDraws !== undefined) {
    updateData.feedstockWetMassKg =
      normalizedFeedstockDraws.length > 0 ? effectiveFeedstockWetMassKg : null;
    updateData.feedstockStorageLocationId = null;
  }
  if (data.feedstockMoisturePercent !== undefined) updateData.feedstockMoisturePercent = data.feedstockMoisturePercent;

  // Recompute dry mass when either wet mass or moisture changes
  const effectiveWetMass =
    effectiveFeedstockDrawCount > 0 ? effectiveFeedstockWetMassKg : null;
  const effectiveMoisture = data.feedstockMoisturePercent !== undefined ? data.feedstockMoisturePercent : existing.feedstockMoisturePercent;
  const effectiveBiocharWet = data.biocharOutputKg !== undefined ? data.biocharOutputKg : existing.biocharOutputKg;
  const effectiveBiocharMoisture = data.biocharMoisturePercent !== undefined ? data.biocharMoisturePercent : existing.biocharMoisturePercent;
  assertProductionRunOutcome(
    {
      status: effectiveStatus,
      startTime: effectiveStartTime,
      endTime: effectiveEndTime,
      endTimePresent: effectiveEndTime !== null,
      cancellationReason:
        data.cancellationReason !== undefined
          ? data.cancellationReason
          : existing.cancellationReason,
      biocharOutputKg: effectiveBiocharWet,
      biocharMoisturePercent: effectiveBiocharMoisture,
      feedstockWetMassKg: effectiveWetMass,
      feedstockMoisturePercent: effectiveMoisture,
      feedstock: {
        basis: "form-inputs",
        drawCount: effectiveFeedstockDrawCount,
      },
    },
    { only: PREFLIGHT_OUTCOME_VIOLATIONS },
  );
  if (normalizedFeedstockDraws !== undefined || data.feedstockMoisturePercent !== undefined) {
    updateData.feedstockMassDryKg =
      effectiveWetMass != null && effectiveMoisture != null
        ? deriveMassDryKg(effectiveWetMass, effectiveMoisture)
        : null;
  }

  if (data.feedingRateKgHr !== undefined) updateData.feedingRateKgHr = data.feedingRateKgHr;
  if (data.residenceTimeMinutes !== undefined) updateData.residenceTimeMinutes = data.residenceTimeMinutes;
  if (data.dieselOperationLiters !== undefined) updateData.dieselOperationLiters = data.dieselOperationLiters;
  if (data.dieselGensetLiters !== undefined) updateData.dieselGensetLiters = data.dieselGensetLiters;
  if (data.preprocessingFuelLiters !== undefined) updateData.preprocessingFuelLiters = data.preprocessingFuelLiters;
  if (data.electricityKwh !== undefined) updateData.electricityKwh = data.electricityKwh;
  if (data.biocharOutputKg !== undefined) updateData.biocharOutputKg = data.biocharOutputKg;
  if (data.biocharMoisturePercent !== undefined) updateData.biocharMoisturePercent = data.biocharMoisturePercent;

  // Recompute biochar dry mass when either output or moisture changes
  if (data.biocharOutputKg !== undefined || data.biocharMoisturePercent !== undefined) {
    updateData.biocharDryMassKg = computeClampedDryMass(effectiveBiocharWet, effectiveBiocharMoisture);
  }

  if (data.biocharStorageLocationId !== undefined) updateData.biocharStorageLocationId = data.biocharStorageLocationId;
  const feedstockDrawsChanged = normalizedFeedstockDraws !== undefined;
  try {
    await withUniqueCodeGuard(
      ctx,
      productionRuns,
      productionRuns.code,
      CODE_CONFLICT_MESSAGES.productionRun,
      () => db.transaction(async (tx) => {
    if (data.facilityId !== undefined) {
      await lockActiveFacilityReference(ctx, tx, data.facilityId);
    }

    await lockProductionRunUpdateStock(
      ctx,
      tx,
      {
        feedstockStorageLocationIds: existingFeedstockStorageLocationIds,
        biocharStorageLocationId: existing.biocharStorageLocationId,
      },
      { ...data, feedstockDraws: normalizedFeedstockDraws },
    );

    const [locked] = await tx
      .select()
      .from(productionRuns)
      .where(and(
        eq(productionRuns.id, productionRunId),
        eq(productionRuns.organizationId, ctx.organizationId),
        isNull(productionRuns.archivedAt),
      ))
      .for("update");

    if (!locked) {
      throw new SafeError("Production run not found");
    }
    const lockedFeedstockStorageLocationIds =
      await getProductionRunFeedstockDrawStorageIds(ctx, tx, productionRunId);
    if (
      data.expectedUpdatedAt &&
      data.expectedUpdatedAt.getTime() !== locked.updatedAt.getTime()
    ) {
      throw new SafeError(
        "This production run changed since you opened it. Reload it before saving.",
      );
    }
    assertProductionRunStockSnapshot(
      {
        feedstockStorageLocationIds: existingFeedstockStorageLocationIds,
        biocharStorageLocationId: existing.biocharStorageLocationId,
      },
      {
        feedstockStorageLocationIds: lockedFeedstockStorageLocationIds,
        biocharStorageLocationId: locked.biocharStorageLocationId,
      },
      { ...data, feedstockDraws: normalizedFeedstockDraws },
    );

    const lockedTargetStatus = data.status ?? locked.status;
    const lockedTargetStartTime = data.startTime ?? locked.startTime;
    const lockedTargetEndTime = data.endTime !== undefined ? data.endTime : locked.endTime;
    const lockedTargetReactorId = data.reactorId ?? locked.reactorId;
    const lockedTargetFacilityId = data.facilityId ?? locked.facilityId;
    const lockedTargetBiocharOutput =
      data.biocharOutputKg !== undefined
        ? data.biocharOutputKg
        : locked.biocharOutputKg;
    const lockedTargetCancellationReason =
      data.cancellationReason !== undefined
        ? data.cancellationReason
        : locked.cancellationReason;

    assertProductionRunTransition(locked.status, lockedTargetStatus);
    assertProductionRunOutcome(
      {
        status: lockedTargetStatus,
        startTime: lockedTargetStartTime,
        endTime: lockedTargetEndTime,
        endTimePresent: lockedTargetEndTime !== null,
        cancellationReason: lockedTargetCancellationReason,
        biocharOutputKg: lockedTargetBiocharOutput,
        biocharMoisturePercent:
          data.biocharMoisturePercent !== undefined
            ? data.biocharMoisturePercent
            : locked.biocharMoisturePercent,
        feedstockWetMassKg:
          normalizedFeedstockDraws !== undefined
            ? normalizedFeedstockDraws.length > 0
              ? sumProductionRunFeedstockDraws(normalizedFeedstockDraws)
              : null
            : locked.feedstockWetMassKg,
        feedstockMoisturePercent:
          data.feedstockMoisturePercent !== undefined
            ? data.feedstockMoisturePercent
            : locked.feedstockMoisturePercent,
        feedstock: {
          basis: "form-inputs",
          drawCount:
            normalizedFeedstockDraws?.length ??
            lockedFeedstockStorageLocationIds.length,
        },
      },
      { only: PREFLIGHT_OUTCOME_VIOLATIONS },
    );

    if (lockedTargetStatus !== locked.status && lockedTargetStatus !== "complete") {
      const linkedProduct = await getProductionRunDependentProduct(
        ctx,
        tx,
        productionRunId,
      );
      if (linkedProduct) {
        throw new SafeError(
          "Remove linked Biochar products before changing this run's outcome.",
        );
      }
    }

    if (
      (locked.status === "complete" || locked.status === "failed") &&
      lockedTargetStatus === "running"
    ) {
      const [membership] = await tx
        .select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
        .from(creditBatchProductionRuns)
        .where(and(
          eq(creditBatchProductionRuns.productionRunId, productionRunId),
          eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
        ))
        .limit(1);
      if (membership) {
        throw new SafeError(
          "Remove this run from its credit batch before reopening it.",
        );
      }
    }

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "productionRun", entityId: productionRunId },
      "update",
    );

    // A cancelled run frees its slot, so only an occupying run needs this guard.
    if (statusOccupiesReactor(lockedTargetStatus)) {
      await assertNoReactorRunOverlap(ctx, tx, {
        reactorId: lockedTargetReactorId,
        startTime: lockedTargetStartTime,
        endTime: lockedTargetEndTime,
        selfId: productionRunId,
      });
    }

    const effectiveBiocharStorageId =
      data.biocharStorageLocationId !== undefined
        ? data.biocharStorageLocationId
        : locked.biocharStorageLocationId;
    const biocharStockState =
      await deriveProductionRunUpdateBiocharStockState(
        ctx,
        tx,
        locked,
        data,
      );

    if (data.facilityId !== undefined && normalizedFeedstockDraws === undefined) {
      await validateProductionRunFeedstockDrawSources(
        ctx,
        tx,
        lockedFeedstockStorageLocationIds.map((storageLocationId) => ({
          storageLocationId,
        })),
        lockedTargetFacilityId,
      );
    }

    if (
      effectiveBiocharStorageId &&
      (data.biocharStorageLocationId !== undefined || data.facilityId !== undefined)
    ) {
      await validateBiocharStorageLocation(ctx, tx, effectiveBiocharStorageId, lockedTargetFacilityId, "Biochar");
    }

    const transactionUpdateData = { ...updateData };
    if (
      normalizedFeedstockDraws !== undefined ||
      data.feedstockMoisturePercent !== undefined
    ) {
      const wetMass = normalizedFeedstockDraws !== undefined
        ? normalizedFeedstockDraws.length > 0
          ? sumProductionRunFeedstockDraws(normalizedFeedstockDraws)
          : null
        : locked.feedstockWetMassKg;
      const moisture = data.feedstockMoisturePercent !== undefined
        ? data.feedstockMoisturePercent
        : locked.feedstockMoisturePercent;
      transactionUpdateData.feedstockMassDryKg =
        wetMass != null && moisture != null
          ? deriveMassDryKg(wetMass, moisture)
          : null;
    }
    if (
      data.biocharOutputKg !== undefined ||
      data.biocharMoisturePercent !== undefined
    ) {
      const wetMass = data.biocharOutputKg !== undefined
        ? data.biocharOutputKg
        : locked.biocharOutputKg;
      const moisture = data.biocharMoisturePercent !== undefined
        ? data.biocharMoisturePercent
        : locked.biocharMoisturePercent;
      transactionUpdateData.biocharDryMassKg = computeClampedDryMass(
        wetMass,
        moisture,
      );
    }

    await tx
      .update(productionRuns)
      .set(transactionUpdateData)
      .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

    await assertProductionRunBiocharStockNotOverdrawn(
      ctx,
      tx,
      biocharStockState,
    );

    if (feedstockDrawsChanged) {
      await replaceProductionRunFeedstockDraws(ctx, tx, {
        productionRunId,
        facilityId: lockedTargetFacilityId,
        draws: normalizedFeedstockDraws,
      });
    }

    const consumedFeedstockWetKg =
      await getProductionRunFeedstockDrawTotal(ctx, tx, productionRunId);

    // Unfiltered: window + dry-mass are eligible here but always pre-caught by
    // the locked PREFLIGHT_OUTCOME_VIOLATIONS re-check above over the same
    // merged inputs — keep that preflight scope or cancelled/draft runs start
    // failing dry-mass here.
    assertProductionRunOutcome({
      status: lockedTargetStatus,
      startTime: lockedTargetStartTime,
      endTime: lockedTargetEndTime,
      endTimePresent: lockedTargetEndTime !== null,
      biocharOutputKg: lockedTargetBiocharOutput,
      biocharMoisturePercent:
        data.biocharMoisturePercent !== undefined
          ? data.biocharMoisturePercent
          : locked.biocharMoisturePercent,
      feedstockWetMassKg:
        normalizedFeedstockDraws !== undefined
          ? normalizedFeedstockDraws.length > 0
            ? sumProductionRunFeedstockDraws(normalizedFeedstockDraws)
            : null
          : locked.feedstockWetMassKg,
      feedstockMoisturePercent:
        data.feedstockMoisturePercent !== undefined
          ? data.feedstockMoisturePercent
          : locked.feedstockMoisturePercent,
      feedstock: {
        basis: "consumed-mass",
        consumedFeedstockWetKg,
      },
      cancellationReason: lockedTargetCancellationReason,
    });
    await attachProductionRunToMatchingCreditBatch(
      ctx,
      tx,
      productionRunId,
    );
      }),
    );
  } catch (error) {
    if (isPgCheckViolation(error, END_AFTER_START_CONSTRAINT)) {
      throw new SafeError(END_AFTER_START_MESSAGE);
    }
    // Race backstop (see createProductionRun): map a raw (reactor, start_time)
    // unique violation to the friendly overlap message.
    if (isReactorStartUniqueViolation(error)) {
      throw new SafeError(
        "Another production run on this reactor starts at that time. Choose a different start time.",
      );
    }
    throw error;
  }

  return getProductionRunById(ctx, productionRunId);
}

/**
 * Delete a production run
 * Will fail if the run has dependent biochar products or credit batches.
 */
export async function deleteProductionRun(
  ctx: OrgContext,
  productionRunId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify run exists
  const [existing] = await db
    .select({
      id: productionRuns.id,
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Production run not found");
  }
  const existingFeedstockStorageLocationIds =
    await getProductionRunFeedstockDrawStorageIds(ctx, db, productionRunId);

  // Run all four deletes in one transaction so the child-row deletes roll back
  // if the final productionRuns delete fails. Foreign-key constraints remain
  // the race-safe backstop for dependent records; without the transaction the
  // removable children would already be gone, leaving a half-deleted run.
  await db.transaction(async (tx) => {
    await lockBinStocks(ctx, tx, [
      ...existingFeedstockStorageLocationIds,
      existing.biocharStorageLocationId,
    ]);

    const [locked] = await tx
      .select({
        id: productionRuns.id,
        biocharOutputKg: productionRuns.biocharOutputKg,
        biocharStorageLocationId: productionRuns.biocharStorageLocationId,
      })
      .from(productionRuns)
      .where(and(
        eq(productionRuns.id, productionRunId),
        eq(productionRuns.organizationId, ctx.organizationId),
      ))
      .for("update");

    if (!locked) {
      throw new SafeError("Production run not found");
    }
    const lockedFeedstockStorageLocationIds =
      await getProductionRunFeedstockDrawStorageIds(ctx, tx, productionRunId);
    assertProductionRunStockSnapshot(
      {
        feedstockStorageLocationIds: existingFeedstockStorageLocationIds,
        biocharStorageLocationId: existing.biocharStorageLocationId,
      },
      {
        feedstockStorageLocationIds: lockedFeedstockStorageLocationIds,
        biocharStorageLocationId: locked.biocharStorageLocationId,
      },
      {
        feedstockDraws: existingFeedstockStorageLocationIds.map(
          (storageLocationId) => ({ storageLocationId }),
        ),
        biocharOutputKg: locked.biocharOutputKg,
      },
    );

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "productionRun", entityId: productionRunId },
      "delete",
    );

    const dependentProduct = await getProductionRunDependentProduct(
      ctx,
      tx,
      productionRunId,
    );
    const [dependentCreditBatch] = await tx
      .select({ id: creditBatches.id, code: creditBatches.code })
      .from(creditBatchProductionRuns)
      .innerJoin(
        creditBatches,
        and(
          eq(creditBatchProductionRuns.creditBatchId, creditBatches.id),
          eq(creditBatches.organizationId, ctx.organizationId),
        ),
      )
      .where(and(
        eq(creditBatchProductionRuns.productionRunId, productionRunId),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ))
      .limit(1);

    if (dependentProduct || dependentCreditBatch) {
      const dependentKinds = [
        dependentProduct ? "biochar products" : null,
        dependentCreditBatch ? "credit batches" : null,
      ].filter((kind): kind is string => kind != null);
      const conflict = dependentProduct
        ? { entity: "biocharProduct", ...dependentProduct }
        : { entity: "creditBatch", ...dependentCreditBatch! };
      throw new ProductionRunDependencyError(
        `This production run cannot be deleted because dependent ${dependentKinds.join(" and ")} exist. Remove those records first.`,
        conflict,
      );
    }

    const productionIncidents = await tx
      .select({ id: incidentReports.id })
      .from(incidentReports)
      .where(
        and(
          eq(incidentReports.productionRunId, productionRunId),
          eq(incidentReports.organizationId, ctx.organizationId),
        ),
      );
    await tx
      .delete(productionRunFeedstocks)
      .where(and(eq(productionRunFeedstocks.productionRunId, productionRunId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

    await tx
      .delete(productionRunFeedstockDraws)
      .where(and(eq(productionRunFeedstockDraws.productionRunId, productionRunId), eq(productionRunFeedstockDraws.organizationId, ctx.organizationId)));

    await tx
      .delete(productionRunReadings)
      .where(and(eq(productionRunReadings.productionRunId, productionRunId), eq(productionRunReadings.organizationId, ctx.organizationId)));

    await tx
      .delete(incidentReports)
      .where(and(eq(incidentReports.productionRunId, productionRunId), eq(incidentReports.organizationId, ctx.organizationId)));

    await tx
      .delete(productionRuns)
      .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "production_run", entityId: productionRunId },
      ...productionIncidents.map((incident) => ({
        entityType: "production_incident" as const,
        entityId: incident.id,
      })),
    ]);
  });
  await processPendingStorageObjectDeletions(ctx);
}
