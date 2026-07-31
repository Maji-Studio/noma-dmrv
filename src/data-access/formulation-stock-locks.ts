import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { biocharProducts, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  deriveBiocharAvailableKg,
  isOverdraw,
  overdrawError,
} from "./bin-stock-guards";
import {
  assertStockLockSnapshot,
  lockBinStocks,
} from "./lock-bin-stocks";

interface BiocharBinStockState {
  storageLocationId: string;
  availableKg: number;
}

interface ProductSnapshot {
  id: string;
  linkedProductionRunId: string | null;
}

interface RunSnapshot {
  id: string;
  storageLocationId: string | null;
}

export interface FormulationRatioLockPreparation {
  products: ProductSnapshot[];
  runs: RunSnapshot[];
}

/** Lock and snapshot every source bin affected by a formulation ratio edit. */
export async function lockFormulationRatioStock(
  ctx: OrgContext,
  tx: DbTransaction,
  formulationId: string,
): Promise<FormulationRatioLockPreparation> {
  const affectedProducts = await tx
    .select({
      id: biocharProducts.id,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
    })
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.formulationId, formulationId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .orderBy(biocharProducts.id);
  const runIds = [...new Set(
    affectedProducts
      .map((product) => product.linkedProductionRunId)
      .filter((id): id is string => id != null),
  )];
  const sourceBins = runIds.length > 0
      ? await tx
            .select({
              id: productionRuns.id,
              storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          inArray(productionRuns.id, runIds),
          eq(productionRuns.organizationId, ctx.organizationId),
            ))
            .orderBy(productionRuns.id)
        : [];
  const storageLocationIds = [...new Set(
    sourceBins
      .map((run) => run.storageLocationId)
      .filter((id): id is string => id != null),
  )];
  await lockBinStocks(ctx, tx, storageLocationIds);

  return { products: affectedProducts, runs: sourceBins };
}

/** Lock the discovered rows after the bin batch and snapshot affected lanes. */
export async function lockFormulationRatioRows(
  ctx: OrgContext,
  tx: DbTransaction,
  formulationId: string,
  preparation: FormulationRatioLockPreparation,
): Promise<BiocharBinStockState[]> {
  const lockedProducts = await tx
    .select({
      id: biocharProducts.id,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
    })
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.formulationId, formulationId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .orderBy(biocharProducts.id)
    .for("update");
  assertStockLockSnapshot(
    lockedProducts.length === preparation.products.length &&
      lockedProducts.every((lockedProduct) => {
        const snapshot = preparation.products.find(
          (product) => product.id === lockedProduct.id,
        );
        return snapshot?.linkedProductionRunId ===
          lockedProduct.linkedProductionRunId;
      }),
  );

  const runIds = preparation.runs.map((run) => run.id);
  const lockedRuns = runIds.length > 0
    ? await tx
        .select({
          id: productionRuns.id,
          storageLocationId: productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(and(
          inArray(productionRuns.id, runIds),
          eq(productionRuns.organizationId, ctx.organizationId),
        ))
        .orderBy(productionRuns.id)
        .for("update")
    : [];
  assertStockLockSnapshot(
    lockedRuns.length === preparation.runs.length &&
      lockedRuns.every((lockedRun) => {
        const snapshot = preparation.runs.find(
          (run) => run.id === lockedRun.id,
        );
        return snapshot?.storageLocationId === lockedRun.storageLocationId;
      }),
  );

  const storageLocationIds = [...new Set(
    lockedRuns
      .map((run) => run.storageLocationId)
      .filter((id): id is string => id != null),
  )];

  const stockState: BiocharBinStockState[] = [];
  for (const storageLocationId of storageLocationIds) {
    stockState.push({
      storageLocationId,
      availableKg: await deriveBiocharAvailableKg(
        ctx,
        tx,
        storageLocationId,
      ),
    });
  }
  return stockState;
}

/** Re-derive affected bins after the new ratio is visible in the transaction. */
export async function assertFormulationRatioWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  stockState: ReadonlyArray<BiocharBinStockState>,
): Promise<void> {
  for (const previous of stockState) {
    const transactionAvailableKg = await deriveBiocharAvailableKg(
      ctx,
      tx,
      previous.storageLocationId,
    );
    const additionalDrawKg = previous.availableKg - transactionAvailableKg;
    if (
      additionalDrawKg > 0 &&
      isOverdraw(additionalDrawKg, previous.availableKg)
    ) {
      throw overdrawError("biochar");
    }
  }
}
