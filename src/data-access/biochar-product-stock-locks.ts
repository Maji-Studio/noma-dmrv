import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  formulations,
  productionRuns,
  type BiocharProduct,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { assertBiocharDrawWithinStock } from "./bin-stock-guards";
import { lockBinStocks } from "./lock-bin-stocks";

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
  | "linkedProductionRunId"
  | "storageLocationId"
  | "massKg"
  | "composition"
>;

export interface BiocharProductStockState {
  transactionFacilityId: string;
  transactionFormulationId: string | null;
  transactionLinkedRunId: string | null;
  transactionStorageId: string | null;
  transactionMassKg: number | null;
  transactionComposition: Record<string, unknown> | null;
}

/** Wet product mass scaled to the source bin's biochar-equivalent draw. */
export function biocharEquivalentKg(
  massKg: number | null,
  biocharRatio: number | null,
): number {
  return (massKg ?? 0) * (biocharRatio ?? 1);
}

/**
 * Derive the stock-sensitive update state and take every advisory bin lock in
 * one sorted batch before the caller locks a destination storage row.
 */
export async function lockBiocharProductUpdateStock(
  ctx: OrgContext,
  tx: DbTransaction,
  locked: LockedBiocharProduct,
  data: BiocharProductStockUpdate,
): Promise<BiocharProductStockState> {
  const state: BiocharProductStockState = {
    transactionFacilityId: data.facilityId ?? locked.facilityId,
    transactionFormulationId:
      data.formulationId !== undefined
        ? data.formulationId
        : locked.formulationId,
    transactionLinkedRunId:
      data.linkedProductionRunId !== undefined
        ? data.linkedProductionRunId
        : locked.linkedProductionRunId,
    transactionStorageId:
      data.storageLocationId !== undefined
        ? data.storageLocationId
        : locked.storageLocationId,
    transactionMassKg:
      data.massKg !== undefined ? data.massKg : locked.massKg,
    transactionComposition:
      data.composition !== undefined
        ? data.composition
        : (locked.composition as Record<string, unknown> | null),
  };
  const productBinStockChanged =
    (data.massKg !== undefined && data.massKg !== locked.massKg) ||
    (data.storageLocationId !== undefined &&
      data.storageLocationId !== locked.storageLocationId);
  // Mirror the defined-ness condition in assertBiocharProductUpdateDraw. Any
  // source-bin advisory lock that assert can take must already be in this batch.
  const biocharAllocationInputsPresent =
    data.massKg !== undefined ||
    data.formulationId !== undefined ||
    data.linkedProductionRunId !== undefined;
  const sourceRunIds = [...new Set(
    [locked.linkedProductionRunId, state.transactionLinkedRunId].filter(
      (id): id is string => id != null,
    ),
  )];
  const sourceBins = biocharAllocationInputsPresent && sourceRunIds.length > 0
    ? await tx
        .select({ storageLocationId: productionRuns.biocharStorageLocationId })
        .from(productionRuns)
        .where(and(
          inArray(productionRuns.id, sourceRunIds),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
        .orderBy(productionRuns.id)
        .for("update")
    : [];

  await lockBinStocks(ctx, tx, [
    ...(productBinStockChanged
      ? [locked.storageLocationId, state.transactionStorageId]
      : []),
    ...sourceBins.map((row) => row.storageLocationId),
  ]);
  return state;
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

  const [ratioRow] = state.transactionFormulationId
    ? await tx
        .select({ biocharRatio: formulations.biocharRatio })
        .from(formulations)
        .where(and(
          eq(formulations.id, state.transactionFormulationId),
          eq(formulations.organizationId, ctx.organizationId),
        ))
    : [];
  const requestedBiocharKg = biocharEquivalentKg(
    state.transactionMassKg,
    ratioRow?.biocharRatio ?? null,
  );
  await assertBiocharDrawWithinStock(ctx, tx, {
    biocharStorageLocationId: effectiveRun.biocharStorageLocationId,
    requestedBiocharKg,
    excludeProductId: productId,
  });
}

export async function lockDeleteBiocharProductStock(
  ctx: OrgContext,
  tx: DbTransaction,
  locked: Pick<
    BiocharProduct,
    "massKg" | "linkedProductionRunId" | "storageLocationId"
  >,
): Promise<void> {
  if ((locked.massKg ?? 0) <= 0) return;

  const [sourceRun] = locked.linkedProductionRunId
    ? await tx
        .select({
          storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          eq(productionRuns.id, locked.linkedProductionRunId),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
        .for("update")
    : [];
  await lockBinStocks(ctx, tx, [
    locked.storageLocationId,
    sourceRun?.storageLocationId,
  ]);
}
