import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProducts,
  productionRuns,
  type BiocharProduct,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  SOURCE_BIOCHAR_MASS_ERROR,
  ZERO_SOURCE_BIOCHAR_ERROR,
} from "@/lib/biochar-composition";
import { SafeError } from "@/lib/errors";
import { productStockOverdrawMessage } from "@/lib/stock-overdraw";
import {
  assertBiocharDrawWithinStock,
  deriveBiocharProductAllocatedKg,
  deriveProductAvailableKg,
  isOverdraw,
  overdrawError,
} from "./bin-stock-guards";
import {
  assertStockLockSnapshot,
  lockBinStocks,
} from "./lock-bin-stocks";
import {
  compositionAllocationChanged,
  deriveCompositionSourceBiocharMassKg,
  getCompositionIngredientDraws,
} from "./biochar-product-composition";

interface BiocharProductStockUpdate {
  facilityId?: string;
  formulationId?: string | null;
  linkedProductionRunId?: string | null;
  storageLocationId?: string | null;
  massKg?: number | null;
  waterAddedKg?: number | null;
  composition?: Record<string, unknown>;
}

type LockedBiocharProduct = Pick<
  BiocharProduct,
  | "facilityId"
  | "formulationId"
  | "sourceBiocharStorageLocationId"
  | "linkedProductionRunId"
  | "storageLocationId"
  | "massKg"
  | "waterAddedKg"
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
}

export function biocharProductBinStockChanged(
  product: Pick<
    BiocharProduct,
    "massKg" | "waterAddedKg" | "storageLocationId"
  >,
  data: Pick<
    BiocharProductStockUpdate,
    "massKg" | "waterAddedKg" | "storageLocationId"
  >,
): boolean {
  return (
    (data.massKg !== undefined && data.massKg !== product.massKg) ||
    (data.waterAddedKg !== undefined &&
      data.waterAddedKg !== product.waterAddedKg) ||
    (data.storageLocationId !== undefined &&
      data.storageLocationId !== product.storageLocationId)
  );
}

export function deriveBiocharProductTotalMassChange(
  locked: Pick<BiocharProduct, "massKg" | "waterAddedKg">,
  data: Pick<BiocharProductStockUpdate, "massKg" | "waterAddedKg">,
): {
  previousTotalMassKg: number;
  transactionTotalMassKg: number;
  massFieldsChanged: boolean;
  isReduction: boolean;
} {
  const previousTotalMassKg =
    (locked.massKg ?? 0) + (locked.waterAddedKg ?? 0);
  // `undefined` means the field is untouched, so the locked value carries
  // forward. An explicitly cleared field is a reduction to zero, not a reason
  // to fall back to the old value and skip the guard.
  const transactionTotalMassKg =
    (data.massKg !== undefined ? (data.massKg ?? 0) : (locked.massKg ?? 0)) +
    (data.waterAddedKg !== undefined
      ? (data.waterAddedKg ?? 0)
      : (locked.waterAddedKg ?? 0));
  const massFieldsChanged =
    data.massKg !== undefined || data.waterAddedKg !== undefined;
  return {
    previousTotalMassKg,
    transactionTotalMassKg,
    massFieldsChanged,
    isReduction: transactionTotalMassKg < previousTotalMassKg,
  };
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
  const existingIngredientDraws = data.composition !== undefined
    ? getCompositionIngredientDraws(
        product.composition as Record<string, unknown> | null,
      )
    : [];
  const transactionIngredientDraws = data.composition !== undefined
    ? getCompositionIngredientDraws(state.transactionComposition)
    : [];
  const productBinStockChanged =
    biocharProductBinStockChanged(product, data);
  // Mirror the defined-ness condition in assertBiocharProductUpdateDraw. Any
  // source-bin advisory lock that assert can take must already be in this batch.
  const biocharAllocationInputsPresent =
    data.massKg !== undefined ||
    data.formulationId !== undefined ||
    data.linkedProductionRunId !== undefined ||
    data.composition !== undefined;
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
    ...existingIngredientDraws.map((draw) => draw.storageLocationId),
    ...transactionIngredientDraws.map((draw) => draw.storageLocationId),
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
      locked.linkedProductionRunId === preparation.product.linkedProductionRunId &&
      (data.composition === undefined ||
        !compositionAllocationChanged(
          locked.composition as Record<string, unknown> | null,
          preparation.product.composition as Record<string, unknown> | null,
        )),
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
      data.linkedProductionRunId === undefined &&
      data.composition === undefined) ||
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

  const requestedBiocharKg = deriveCompositionSourceBiocharMassKg(
    state.transactionMassKg,
    state.transactionComposition,
  );
  if (requestedBiocharKg === null || requestedBiocharKg < 0) {
    throw new SafeError(SOURCE_BIOCHAR_MASS_ERROR);
  }
  if (requestedBiocharKg === 0) {
    throw new SafeError(ZERO_SOURCE_BIOCHAR_ERROR);
  }
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
  locked: Pick<
    BiocharProduct,
    "code" | "massKg" | "waterAddedKg" | "storageLocationId"
  >,
  data: Pick<
    BiocharProductStockUpdate,
    "massKg" | "waterAddedKg"
  >,
): Promise<void> {
  const {
    previousTotalMassKg,
    transactionTotalMassKg,
    massFieldsChanged,
    isReduction,
  } = deriveBiocharProductTotalMassChange(locked, data);
  if (!massFieldsChanged || !isReduction) {
    return;
  }

  const allocatedKg = await deriveBiocharProductAllocatedKg(
    ctx,
    tx,
    productId,
  );
  if (isOverdraw(allocatedKg, transactionTotalMassKg)) {
    throw new SafeError(productStockOverdrawMessage());
  }

  if (!locked.storageLocationId) return;

  const availableKg = await deriveProductAvailableKg(
    ctx,
    tx,
    locked.storageLocationId,
  );
  const reductionKg =
    previousTotalMassKg - transactionTotalMassKg;
  if (isOverdraw(reductionKg, availableKg)) {
    throw overdrawError("product");
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

  const ingredientDraws = getCompositionIngredientDraws(
    snapshot.composition as Record<string, unknown> | null,
  );
  await lockBinStocks(ctx, tx, [
    ...ingredientDraws.map((draw) => draw.storageLocationId),
    ...((snapshot.massKg ?? 0) > 0 ? [
      snapshot.storageLocationId,
      snapshot.sourceBiocharStorageLocationId,
      sourceRunSnapshot?.storageLocationId,
    ] : []),
  ]);

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
      locked.sourceBiocharStorageLocationId ===
        snapshot.sourceBiocharStorageLocationId &&
      locked.linkedProductionRunId === snapshot.linkedProductionRunId &&
      JSON.stringify(locked.composition) === JSON.stringify(snapshot.composition),
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
