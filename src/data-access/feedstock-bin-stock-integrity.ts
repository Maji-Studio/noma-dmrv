/**
 * Post-write feedstock lane integrity (issue #767).
 *
 * A feedstock bin's stock is derived (`deriveLaneStock`) and deliberately
 * unclamped, so a write that shrinks or moves an intake after withdrawals were
 * recorded can leave the lane below zero. Validating the bin reference is not
 * enough: the mass itself has to be re-derived once the new row is visible.
 *
 * Every feedstock write that can shrink a lane calls this after its own UPDATE
 * or DELETE, inside the same transaction, while it still holds each affected
 * bin's stock lock (`lockBinStocks`). A negative lane rolls the whole
 * transaction back.
 *
 * The refusal names the one sanctioned repair, a stock reconciliation on the
 * bin, carries the bin as its `conflict` so the form can open the reconcile
 * sheet, and lists the withdrawals still drawing on the bin as `blockers`
 * (decision 2026-09-17).
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProducts,
  productionRunFeedstockDraws,
  productionRuns,
  storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode, type ConflictRef } from "@/lib/conflict-ref";
import { ActionConflictError } from "@/lib/errors";
import { formatMassKg } from "@/lib/format-utils";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { isStockOverdraw } from "@/lib/stock-overdraw";
import { deriveFeedstockWetStockKg } from "./feedstock-wet-stock";
import { requireOrgScope } from "./utils";

/** Which write is being refused, so the message names the right action. */
export type FeedstockStockWrite = "save" | "delete";

const WRITE_OUTCOME: Record<FeedstockStockWrite, string> = {
  save: "Feedstock was not saved.",
  delete: "Feedstock was not deleted.",
};

/** Button label in the reconcile sheet; the message names it exactly. */
const RECONCILE_ACTION_LABEL = "Reconcile stock";

const CONFLICT_ENTITY = "storageLocation";
const RUN_BLOCKER_ENTITY = "productionRun";
const PRODUCT_BLOCKER_ENTITY = "biocharProduct";

/** Bound the payload: the form lists the first few, the bin page has the rest. */
const MAX_BLOCKERS = 10;

/** True when a derived lane sits materially below zero. */
function isNegativeStock(availableKg: number): boolean {
  return isStockOverdraw(0, availableKg);
}

/**
 * Copy for the refusal: the record and the problem first, then the one action
 * that clears it (docs/ux-writing.md).
 */
export function negativeLaneMessage(
  write: FeedstockStockWrite,
  binCode: string,
  shortfallWetKg: number,
): string {
  return (
    `${WRITE_OUTCOME[write]} Bin ${binCode} would go ${formatMassKg(shortfallWetKg)} below zero. ` +
    `Open bin ${binCode}, choose ${RECONCILE_ACTION_LABEL} and record a count first, then try again.`
  );
}

/**
 * The withdrawals still drawing on the bin: every non-cancelled production run
 * with a draw from it, then every product that mixed it in as an ingredient.
 * These are the records a reconciliation has to account for.
 */
async function listLaneWithdrawals(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationId: string,
): Promise<ConflictRef[]> {
  const runs = await tx
    .selectDistinct({ id: productionRuns.id, code: productionRuns.code })
    .from(productionRunFeedstockDraws)
    .innerJoin(
      productionRuns,
      and(
        eq(productionRunFeedstockDraws.productionRunId, productionRuns.id),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(productionRunFeedstockDraws.storageLocationId, storageLocationId),
        eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
        ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
      ),
    )
    .orderBy(productionRuns.code)
    .limit(MAX_BLOCKERS);

  const remaining = MAX_BLOCKERS - runs.length;
  const products =
    remaining > 0
      ? await tx
          .select({ id: biocharProducts.id, code: biocharProducts.code })
          .from(biocharProducts)
          .where(
            and(
              eq(biocharProducts.organizationId, ctx.organizationId),
              sql`${biocharProducts.composition} -> 'ingredients' @> ${JSON.stringify([
                { storageLocationId },
              ])}::jsonb`,
            ),
          )
          .orderBy(biocharProducts.code)
          .limit(remaining)
      : [];

  return [
    ...runs.map((run) => ({
      entity: RUN_BLOCKER_ENTITY,
      id: run.id,
      code: conflictCode(run.code),
    })),
    ...products.map((product) => ({
      entity: PRODUCT_BLOCKER_ENTITY,
      id: product.id,
      code: conflictCode(product.code),
    })),
  ];
}

/**
 * Refuse the transaction when any of these bins now derives a negative wet
 * feedstock lane. The conflict carries the offending bin so the UI can open
 * its reconcile sheet, and the withdrawals still drawing on it as blockers.
 * A reduction that lands on exactly zero passes.
 */
export async function assertFeedstockBinLanesNotNegative(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationIds: ReadonlyArray<string | null | undefined>,
  write: FeedstockStockWrite,
): Promise<void> {
  requireOrgScope(ctx);
  const binIds = [
    ...new Set(storageLocationIds.filter((id): id is string => id != null)),
  ];
  if (binIds.length === 0) return;

  const bins = await tx
    .select({ id: storageLocations.id, code: storageLocations.code })
    .from(storageLocations)
    .where(
      and(
        inArray(storageLocations.id, binIds),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    );

  for (const bin of bins) {
    const availableWetKg = await deriveFeedstockWetStockKg(ctx, tx, bin.id);
    if (isNegativeStock(availableWetKg)) {
      const blockers = await listLaneWithdrawals(ctx, tx, bin.id);
      throw new ActionConflictError(
        negativeLaneMessage(write, bin.code, Math.abs(availableWetKg)),
        { entity: CONFLICT_ENTITY, id: bin.id, code: conflictCode(bin.code) },
        { blockers },
      );
    }
  }
}
