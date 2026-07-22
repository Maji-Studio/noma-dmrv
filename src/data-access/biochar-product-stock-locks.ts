import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProducts,
  formulations,
  productionRuns,
  type BiocharProduct,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  assertBiocharDrawWithinStock,
  deriveBiocharProductDeliveredKg,
  deriveProductAvailableKg,
  formatKg,
  isOverdraw,
  overdrawError,
} from "./bin-stock-guards";
import {
  assertStockLockSnapshot,
  lockBinStocks,
} from "./lock-bin-stocks";

interface BiocharProductStockUpdate {
  facilityId?: string;
  formulationId?: string | null;
  linkedProductionRunId?: string | null;
  storageLocationId?: string | null;
  massKg?: number | null;
  composition?: Record<string, unknown>;
}

type LockedBiocharProduct = Pick<
  BiocharProduct,
  | "facilityId"
  | "formulationId"
  | "biocharRatio"
  | "linkedProductionRunId"
  | "storageLocationId"
  | "massKg"
  | "composition"
>;

interface SourceRunSnapshot {
  id: string;
  storageLocationId: string | null;
}

export interface BiocharProductUpdateLockPreparation {
  product: LockedBiocharProduct;
  sourceRuns: SourceRunSnapshot[];
}

export interface BiocharProductStockState {
  transactionFacilityId: string;
  transactionFormulationId: string | null;
  transactionLinkedRunId: string | null;
  transactionStorageId: string | null;
  transactionMassKg: number | null;
  transactionComposition: Record<string, unknown> | null;
  /**
   * The product's snapshotted biochar ratio for this transaction. `null` when
   * unknown (formulation being reassigned, or a legacy pre-snapshot row) — the
   * draw check then falls back to the live formulation ratio, matching the
   * roll-ups' COALESCE(product snapshot, live formulation ratio, 1).
   */
  transactionBiocharRatio: number | null;
}

/** Wet product mass scaled to the source bin's biochar-equivalent draw. */
export function biocharEquivalentKg(
  massKg: number | null,
  biocharRatio: number | null,
): number {
  return (massKg ?? 0) * (biocharRatio ?? 1);
}

function deriveBiocharProductStockState(
  product: LockedBiocharProduct,
  data: BiocharProductStockUpdate,
): BiocharProductStockState {
  return {
    transactionFacilityId: data.facilityId ?? product.facilityId,
    transactionFormulationId:
      data.formulationId !== undefined
        ? data.formulationId
        : product.formulationId,
    transactionLinkedRunId:
      data.linkedProductionRunId !== undefined
        ? data.linkedProductionRunId
        : product.linkedProductionRunId,
    transactionStorageId:
      data.storageLocationId !== undefined
        ? data.storageLocationId
        : product.storageLocationId,
    transactionMassKg:
      data.massKg !== undefined ? data.massKg : product.massKg,
    transactionComposition:
      data.composition !== undefined
        ? data.composition
        : (product.composition as Record<string, unknown> | null),
    transactionBiocharRatio:
      data.formulationId !== undefined &&
      data.formulationId !== product.formulationId
        ? null
        : product.biocharRatio,
  };
}

/**
 * Derive the stock-sensitive update state and take every advisory bin lock in
 * one sorted batch before the caller locks a destination storage row.
 */
export async function lockBiocharProductUpdateStock(
  ctx: OrgContext,
  tx: DbTransaction,
  product: LockedBiocharProduct,
  data: BiocharProductStockUpdate,
): Promise<BiocharProductUpdateLockPreparation> {
  const state = deriveBiocharProductStockState(product, data);
  const productBinStockChanged =
    (data.massKg !== undefined && data.massKg !== product.massKg) ||
    (data.storageLocationId !== undefined &&
      data.storageLocationId !== product.storageLocationId);
  // Mirror the defined-ness condition in assertBiocharProductUpdateDraw. Any
  // source-bin advisory lock that assert can take must already be in this batch.
  const biocharAllocationInputsPresent =
    data.massKg !== undefined ||
    data.formulationId !== undefined ||
    data.linkedProductionRunId !== undefined;
  const sourceRunIds = [...new Set(
    [product.linkedProductionRunId, state.transactionLinkedRunId].filter(
      (id): id is string => id != null,
    ),
  )];
  const sourceBins = biocharAllocationInputsPresent && sourceRunIds.length > 0
    ? await tx
        .select({
          id: productionRuns.id,
          storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          inArray(productionRuns.id, sourceRunIds),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
        .orderBy(productionRuns.id)
    : [];

  await lockBinStocks(ctx, tx, [
    ...(productBinStockChanged
      ? [product.storageLocationId, state.transactionStorageId]
      : []),
    ...sourceBins.map((row) => row.storageLocationId),
  ]);
  return { product, sourceRuns: sourceBins };
}

/** Lock dependency rows after the bin batch and reject a stale discovery read. */
export async function lockBiocharProductUpdateRows(
  ctx: OrgContext,
  tx: DbTransaction,
  locked: LockedBiocharProduct,
  data: BiocharProductStockUpdate,
  preparation: BiocharProductUpdateLockPreparation,
): Promise<BiocharProductStockState> {
  assertStockLockSnapshot(
    locked.storageLocationId === preparation.product.storageLocationId &&
      locked.linkedProductionRunId === preparation.product.linkedProductionRunId,
  );

  const sourceRunIds = preparation.sourceRuns.map((run) => run.id);
  const lockedSourceRuns = sourceRunIds.length > 0
    ? await tx
        .select({
          id: productionRuns.id,
          storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          inArray(productionRuns.id, sourceRunIds),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
        .orderBy(productionRuns.id)
        .for("update")
    : [];

  assertStockLockSnapshot(
    lockedSourceRuns.length === preparation.sourceRuns.length &&
      lockedSourceRuns.every((lockedRun) => {
        const snapshot = preparation.sourceRuns.find(
          (run) => run.id === lockedRun.id,
        );
        return snapshot?.storageLocationId === lockedRun.storageLocationId;
      }),
  );

  return deriveBiocharProductStockState(locked, data);
}

/** Re-check a changed product allocation while the source-bin lock is held. */
export async function assertBiocharProductUpdateDraw(
  ctx: OrgContext,
  tx: DbTransaction,
  productId: string,
  data: BiocharProductStockUpdate,
  state: BiocharProductStockState,
): Promise<void> {
  if (
    (data.massKg === undefined &&
      data.formulationId === undefined &&
      data.linkedProductionRunId === undefined) ||
    !state.transactionLinkedRunId ||
    state.transactionMassKg == null
  ) {
    return;
  }

  const [effectiveRun] = await tx
    .select({
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(and(
      eq(productionRuns.id, state.transactionLinkedRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    ));
  if (!effectiveRun?.biocharStorageLocationId) return;

  // Snapshot-first: the product's own biochar ratio governs its draw. Fall
  // back to the live formulation ratio only when the snapshot is unresolved
  // (formulation reassignment in flight, or a legacy pre-snapshot row) —
  // mirroring the stock roll-ups' COALESCE chain so overdraw checks and
  // derived stock can never disagree.
  let biocharRatio = state.transactionBiocharRatio;
  if (biocharRatio == null && state.transactionFormulationId) {
    const [ratioRow] = await tx
      .select({ biocharRatio: formulations.biocharRatio })
      .from(formulations)
      .where(and(
        eq(formulations.id, state.transactionFormulationId),
        eq(formulations.organizationId, ctx.organizationId),
      ));
    biocharRatio = ratioRow?.biocharRatio ?? null;
  }
  const requestedBiocharKg = biocharEquivalentKg(
    state.transactionMassKg,
    biocharRatio,
  );
  await assertBiocharDrawWithinStock(ctx, tx, {
    biocharStorageLocationId: effectiveRun.biocharStorageLocationId,
    requestedBiocharKg,
    excludeProductId: productId,
    binLockAlreadyHeld: true,
  });
}

/** Reject a mass correction that would overdraw the product batch or its bin. */
export async function assertBiocharProductMassReductionWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  productId: string,
  locked: Pick<BiocharProduct, "code" | "massKg" | "storageLocationId">,
  data: Pick<BiocharProductStockUpdate, "massKg">,
): Promise<void> {
  const previousMassKg = locked.massKg ?? 0;
  const transactionMassKg = data.massKg ?? 0;
  if (
    data.massKg === undefined ||
    transactionMassKg >= previousMassKg
  ) {
    return;
  }

  const deliveredKg = await deriveBiocharProductDeliveredKg(
    ctx,
    tx,
    productId,
  );
  if (isOverdraw(deliveredKg, transactionMassKg)) {
    throw new SafeError(
      `Cannot reduce product ${locked.code} to ${formatKg(
        transactionMassKg,
      )}: ${formatKg(deliveredKg)} has already been delivered. Correct the deliveries before lowering the product mass.`,
    );
  }

  if (!locked.storageLocationId) return;

  const availableKg = await deriveProductAvailableKg(
    ctx,
    tx,
    locked.storageLocationId,
  );
  const reductionKg = previousMassKg - transactionMassKg;
  if (isOverdraw(reductionKg, availableKg)) {
    throw overdrawError("product", availableKg, reductionKg);
  }
}

export async function lockDeleteBiocharProductStock(
  ctx: OrgContext,
  tx: DbTransaction,
  productId: string,
): Promise<BiocharProduct> {
  const [snapshot] = await tx
    .select()
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.id, productId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ));

  if (!snapshot) {
    throw new SafeError("Biochar product not found");
  }

  const [sourceRunSnapshot] = snapshot.linkedProductionRunId
    ? await tx
        .select({
          id: productionRuns.id,
          storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          eq(productionRuns.id, snapshot.linkedProductionRunId),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
    : [];

  if ((snapshot.massKg ?? 0) > 0) {
    await lockBinStocks(ctx, tx, [
      snapshot.storageLocationId,
      sourceRunSnapshot?.storageLocationId,
    ]);
  }

  const [locked] = await tx
    .select()
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.id, productId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .for("update");

  if (!locked) {
    throw new SafeError("Biochar product not found");
  }
  assertStockLockSnapshot(
    locked.massKg === snapshot.massKg &&
      locked.storageLocationId === snapshot.storageLocationId &&
      locked.linkedProductionRunId === snapshot.linkedProductionRunId,
  );

  const [lockedSourceRun] = locked.linkedProductionRunId
    ? await tx
        .select({
          id: productionRuns.id,
          storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          eq(productionRuns.id, locked.linkedProductionRunId),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
        .for("update")
    : [];
  assertStockLockSnapshot(
    lockedSourceRun?.id === sourceRunSnapshot?.id &&
      lockedSourceRun?.storageLocationId === sourceRunSnapshot?.storageLocationId,
  );

  return locked;
}
