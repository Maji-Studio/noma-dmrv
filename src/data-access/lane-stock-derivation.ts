/**
 * Shared per-location stock derivation for the feedstock and biochar lanes.
 *
 * Stock stays unclamped: a negative value is an operational reconciliation
 * signal. Callers inside a transaction must supply that transaction so every
 * source row and movement overlay is read from the same snapshot.
 */

import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { countRows, numericAggregate, sumNumeric } from "@/db/aggregate";
import type { db } from "@/db";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  binMovements,
  feedstocks,
  productionRunFeedstocks,
  productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { sourceBiocharMassKgSql } from "./biochar-product-source-mass";

export interface LaneStockDerivation {
  storageLocationId: string;
  feedstockIntakeDryKg: number;
  feedstockIntakeWetKg: number;
  feedstockConsumedWetKg: number;
  feedstockMovementDeltaKg: number;
  feedstockStockWetKg: number;
  /** Intake-moisture estimate only. Never use as an availability limit. */
  feedstockEstimatedDryKg: number | null;
  biocharProducedKg: number;
  biocharAllocatedKg: number;
  biocharMovementDeltaKg: number;
  biocharStockKg: number;
  productMovementDeltaKg: number;
}

export interface DeriveLaneStockOptions {
  storageLocationIds: string[];
  excludeRunId?: string;
  excludeProductId?: string;
}

type DbReader = Pick<typeof db, "select">;

export async function deriveLaneStock(
  ctx: OrgContext,
  executor: DbReader,
  options: DeriveLaneStockOptions,
): Promise<LaneStockDerivation[]> {
  requireOrgScope(ctx);
  if (options.storageLocationIds.length === 0) return [];

  const consumptionConditions = [
    inArray(
      productionRuns.feedstockStorageLocationId,
      options.storageLocationIds,
    ),
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  ];
  if (options.excludeRunId) {
    consumptionConditions.push(ne(productionRuns.id, options.excludeRunId));
  }

  const legacyAllocationConditions = [
    inArray(
      productionRuns.biocharStorageLocationId,
      options.storageLocationIds,
    ),
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
    isNull(biocharProducts.sourceBiocharStorageLocationId),
  ];
  const sourceAllocationConditions = [
    inArray(
      biocharProductSourceAllocations.sourceStorageLocationId,
      options.storageLocationIds,
    ),
    eq(
      biocharProductSourceAllocations.organizationId,
      ctx.organizationId,
    ),
  ];
  if (options.excludeProductId) {
    legacyAllocationConditions.push(
      ne(biocharProducts.id, options.excludeProductId),
    );
    sourceAllocationConditions.push(
      ne(
        biocharProductSourceAllocations.biocharProductId,
        options.excludeProductId,
      ),
    );
  }

  const [
    intakeRows,
    runConsumptionRows,
    ingredientConsumptionRows,
    outputRows,
    legacyAllocationRows,
    sourceAllocationRows,
    movementRows,
  ] =
    await Promise.all([
      executor
        .select({
          storageLocationId: feedstocks.storageLocationId,
          total: sumNumeric(
            feedstocks.massDryKg,
            sql`${feedstocks.status} = 'complete'`,
          ),
          totalWet: sumNumeric(
            feedstocks.massWetKg,
            sql`${feedstocks.status} = 'complete'`,
          ),
          missingDryMassCount: countRows(
            and(
              eq(feedstocks.status, "complete"),
              sql`${feedstocks.massWetKg} > 0`,
              isNull(feedstocks.massDryKg),
            ),
          ),
        })
        .from(feedstocks)
        .where(
          and(
            inArray(feedstocks.storageLocationId, options.storageLocationIds),
            eq(feedstocks.organizationId, ctx.organizationId),
          ),
        )
        .groupBy(feedstocks.storageLocationId),
      executor
        .select({
          storageLocationId: productionRuns.feedstockStorageLocationId,
          totalWet: sumNumeric(productionRunFeedstocks.wetMassUsedKg),
        })
        .from(productionRuns)
        .leftJoin(
          productionRunFeedstocks,
          and(
            eq(
              productionRunFeedstocks.productionRunId,
              productionRuns.id,
            ),
            eq(
              productionRunFeedstocks.organizationId,
              ctx.organizationId,
            ),
          ),
        )
        .where(and(...consumptionConditions))
        .groupBy(productionRuns.feedstockStorageLocationId),
      executor
        .select({
          storageLocationId: sql<string>`ingredient.value ->> 'storageLocationId'`,
          totalWet: numericAggregate(sql<number>`
            COALESCE(
              SUM(
                CASE
                  WHEN jsonb_typeof(ingredient.value -> 'massKg') = 'number'
                    AND (ingredient.value ->> 'massKg')::numeric > 0
                  THEN (ingredient.value ->> 'massKg')::numeric
                  ELSE 0
                END
              ),
              0
            )
          `),
        })
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
        .where(and(
          eq(biocharProducts.organizationId, ctx.organizationId),
          inArray(
            sql<string>`ingredient.value ->> 'storageLocationId'`,
            options.storageLocationIds,
          ),
          ...(options.excludeProductId
            ? [ne(biocharProducts.id, options.excludeProductId)]
            : []),
        ))
        .groupBy(sql`ingredient.value ->> 'storageLocationId'`),
      executor
        .select({
          storageLocationId: productionRuns.biocharStorageLocationId,
          total: sumNumeric(productionRuns.biocharOutputKg),
        })
        .from(productionRuns)
        .where(
          and(
            inArray(
              productionRuns.biocharStorageLocationId,
              options.storageLocationIds,
            ),
            eq(productionRuns.organizationId, ctx.organizationId),
            ne(
              productionRuns.status,
              CANCELLED_PRODUCTION_RUN_STATUS,
            ),
          ),
        )
        .groupBy(productionRuns.biocharStorageLocationId),
      executor
        .select({
          storageLocationId: productionRuns.biocharStorageLocationId,
          total: numericAggregate(
            sql<number>`COALESCE(SUM(${sourceBiocharMassKgSql(
              biocharProducts.massKg,
              biocharProducts.composition,
            )}), 0)`,
          ),
        })
        .from(productionRuns)
        .innerJoin(
          biocharProducts,
          and(
            eq(
              biocharProducts.linkedProductionRunId,
              productionRuns.id,
            ),
            eq(biocharProducts.organizationId, ctx.organizationId),
          ),
        )
        .where(and(...legacyAllocationConditions))
        .groupBy(productionRuns.biocharStorageLocationId),
      executor
        .select({
          storageLocationId:
            biocharProductSourceAllocations.sourceStorageLocationId,
          total: sumNumeric(
            biocharProductSourceAllocations.allocatedWetMassKg,
          ),
        })
        .from(biocharProductSourceAllocations)
        .where(and(...sourceAllocationConditions))
        .groupBy(
          biocharProductSourceAllocations.sourceStorageLocationId,
        ),
      executor
        .select({
          storageLocationId: binMovements.storageLocationId,
          lane: binMovements.lane,
          totalDeltaKg: sumNumeric(binMovements.massDeltaKg),
        })
        .from(binMovements)
        .where(
          and(
            inArray(
              binMovements.storageLocationId,
              options.storageLocationIds,
            ),
            eq(binMovements.organizationId, ctx.organizationId),
          ),
        )
        .groupBy(binMovements.storageLocationId, binMovements.lane),
    ]);

  const byLocation = new Map<string, LaneStockDerivation>(
    options.storageLocationIds.map((storageLocationId) => [
      storageLocationId,
      {
        storageLocationId,
        feedstockIntakeDryKg: 0,
        feedstockIntakeWetKg: 0,
        feedstockConsumedWetKg: 0,
        feedstockMovementDeltaKg: 0,
        feedstockStockWetKg: 0,
        feedstockEstimatedDryKg: 0,
        biocharProducedKg: 0,
        biocharAllocatedKg: 0,
        biocharMovementDeltaKg: 0,
        biocharStockKg: 0,
        productMovementDeltaKg: 0,
      },
    ]),
  );
  const missingDryBasisByLocation = new Set<string>();

  for (const row of intakeRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) {
      stock.feedstockIntakeDryKg = row.total;
      stock.feedstockIntakeWetKg = row.totalWet;
      if (row.missingDryMassCount > 0) {
        missingDryBasisByLocation.add(stock.storageLocationId);
      }
    }
  }
  for (const row of runConsumptionRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.feedstockConsumedWetKg = row.totalWet;
  }
  for (const row of ingredientConsumptionRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) {
      stock.feedstockConsumedWetKg += row.totalWet;
    }
  }
  for (const row of outputRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.biocharProducedKg = row.total;
  }
  for (const row of legacyAllocationRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.biocharAllocatedKg += row.total;
  }
  for (const row of sourceAllocationRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.biocharAllocatedKg += row.total;
  }
  for (const row of movementRows) {
    const stock = byLocation.get(row.storageLocationId);
    if (!stock) continue;
    if (row.lane === "feedstock") {
      stock.feedstockMovementDeltaKg = row.totalDeltaKg;
    } else if (row.lane === "biochar") {
      stock.biocharMovementDeltaKg = row.totalDeltaKg;
    } else {
      stock.productMovementDeltaKg = row.totalDeltaKg;
    }
  }

  for (const stock of byLocation.values()) {
    stock.feedstockStockWetKg =
      stock.feedstockIntakeWetKg -
      stock.feedstockConsumedWetKg +
      stock.feedstockMovementDeltaKg;
    stock.feedstockEstimatedDryKg =
      stock.feedstockStockWetKg === 0
        ? 0
        : stock.feedstockIntakeWetKg > 0 &&
            !missingDryBasisByLocation.has(stock.storageLocationId)
          ? stock.feedstockStockWetKg *
            (stock.feedstockIntakeDryKg / stock.feedstockIntakeWetKg)
          : null;
    stock.biocharStockKg =
      stock.biocharProducedKg -
      stock.biocharAllocatedKg +
      stock.biocharMovementDeltaKg;
  }

  return [...byLocation.values()];
}
