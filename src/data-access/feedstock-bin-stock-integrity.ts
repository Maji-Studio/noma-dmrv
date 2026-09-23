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
 * The refusal carries the bin as its `conflict` and lists the withdrawals
 * still drawing on it as `blockers`, so the form can show the operator which
 * records hold the mass (decision 2026-09-17). The repair is to correct the
 * withdrawal that is wrong: nothing in the app adds mass back to a feedstock
 * bin (ADR 0027, decided 2026-09-23).
 */

import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProducts,
  binMovements,
  productionRunFeedstockDraws,
  productionRuns,
  storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode, type ConflictRef } from "@/lib/conflict-ref";
import { ActionConflictError } from "@/lib/errors";
import { formatDateTime, formatMassKg } from "@/lib/format-utils";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { STOCK_CONFLICT_ENTITY } from "@/lib/stock-conflict-entities";
import { isStockOverdraw } from "@/lib/stock-overdraw";
import { deriveFeedstockWetStockKg } from "./feedstock-wet-stock";
import { requireOrgScope } from "./utils";

/** Which write is being refused, so the message names the right action. */
export type FeedstockStockWrite = "save" | "delete";

const WRITE_OUTCOME: Record<FeedstockStockWrite, string> = {
  save: "Feedstock was not saved.",
  delete: "Feedstock was not deleted.",
};

const CONFLICT_ENTITY = STOCK_CONFLICT_ENTITY.storageLocation;
const RUN_BLOCKER_ENTITY = STOCK_CONFLICT_ENTITY.productionRun;
const PRODUCT_BLOCKER_ENTITY = STOCK_CONFLICT_ENTITY.biocharProduct;

/** Bound the payload: the form lists the first few, the bin page has the rest. */
const MAX_BLOCKERS = 10;

/** True when a derived lane sits materially below zero. */
function isNegativeStock(availableKg: number): boolean {
  return isStockOverdraw(0, availableKg);
}

/**
 * Copy for the refusal: the record and the problem first, then the next
 * action (docs/ux-writing.md). The action is to review the withdrawals the
 * blockers name, because nothing in the app can add mass back to a bin.
 */
export function negativeLaneMessage(
  write: FeedstockStockWrite,
  binCode: string,
  shortfallWetKg: number,
): string {
  return (
    `${WRITE_OUTCOME[write]} Bin ${binCode} would go ${formatMassKg(shortfallWetKg)} below zero. ` +
    `Review bin ${binCode} intake and withdrawal history, including recorded losses.`
  );
}

/**
 * The withdrawals still drawing on the bin: every non-cancelled production run
 * with a draw from it, then every product whose composition takes a positive
 * mass from it, then negative feedstock movements, matching the withdrawals
 * counted by `deriveLaneStock`.
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
          .selectDistinct({ id: biocharProducts.id, code: biocharProducts.code })
          .from(biocharProducts)
          .innerJoin(
            sql`LATERAL jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(${biocharProducts.composition} -> 'ingredients') = 'array'
                THEN ${biocharProducts.composition} -> 'ingredients'
                ELSE '[]'::jsonb
              END
            ) AS ingredient(value)`,
            sql`true`,
          )
          .where(
            and(
              eq(biocharProducts.organizationId, ctx.organizationId),
              sql`ingredient.value ->> 'storageLocationId' = ${storageLocationId}`,
              sql`jsonb_typeof(ingredient.value -> 'massKg') = 'number'`,
              gt(sql`(ingredient.value ->> 'massKg')::numeric`, 0),
            ),
          )
          .orderBy(biocharProducts.code)
          .limit(remaining)
      : [];

  const movementSlots = remaining - products.length;
  const movements =
    movementSlots > 0
      ? await tx
          .select({
            id: binMovements.id,
            reason: binMovements.reason,
            createdAt: binMovements.createdAt,
          })
          .from(binMovements)
          .where(
            and(
              eq(binMovements.organizationId, ctx.organizationId),
              eq(binMovements.storageLocationId, storageLocationId),
              eq(binMovements.lane, "feedstock"),
              lt(binMovements.massDeltaKg, 0),
            ),
          )
          .orderBy(binMovements.createdAt, binMovements.id)
          .limit(movementSlots)
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
    ...movements.map((movement) => ({
      entity: STOCK_CONFLICT_ENTITY.binMovement,
      id: movement.id,
      // Feedstock history shows the reason and recorded time, not an output physical date.
      code: conflictCode(`${movement.reason} (${formatDateTime(movement.createdAt)})`),
    })),
  ];
}

/**
 * Refuse the transaction when any of these bins now derives a negative wet
 * feedstock lane. The conflict names the offending bin, and the blockers
 * name its withdrawals for the operator to review.
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
