/**
 * Shared per-location stock derivation for the feedstock and biochar lanes.
 *
 * Stock stays unclamped: a negative value is an operational reconciliation
 * signal. Callers inside a transaction must supply that transaction so every
 * source row and movement overlay is read from the same snapshot.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { numericAggregate, sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  feedstocks,
  formulations,
  productionRunFeedstocks,
  productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  getBinMovementLaneSums,
  type DbReader,
} from "./bin-movements";
import { requireOrgScope } from "./utils";

export interface LaneStockDerivation {
  storageLocationId: string;
  feedstockIntakeDryKg: number;
  feedstockConsumedDryKg: number;
  feedstockMovementDeltaKg: number;
  feedstockStockDryKg: number;
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
  ];
  if (options.excludeRunId) {
    consumptionConditions.push(ne(productionRuns.id, options.excludeRunId));
  }

  const allocationConditions = [
    inArray(
      productionRuns.biocharStorageLocationId,
      options.storageLocationIds,
    ),
    eq(productionRuns.organizationId, ctx.organizationId),
  ];
  if (options.excludeProductId) {
    allocationConditions.push(
      ne(biocharProducts.id, options.excludeProductId),
    );
  }

  const [intakeRows, consumptionRows, outputRows, allocationRows, movementRows] =
    await Promise.all([
      executor
        .select({
          storageLocationId: feedstocks.storageLocationId,
          total: sumNumeric(
            feedstocks.massDryKg,
            sql`${feedstocks.status} = 'complete'`,
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
          total: sumNumeric(productionRunFeedstocks.massUsedKg),
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
          ),
        )
        .groupBy(productionRuns.biocharStorageLocationId),
      executor
        .select({
          storageLocationId: productionRuns.biocharStorageLocationId,
          total: numericAggregate(
            sql<number>`COALESCE(SUM(COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)), 0)`,
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
        .leftJoin(
          formulations,
          and(
            eq(biocharProducts.formulationId, formulations.id),
            eq(formulations.organizationId, ctx.organizationId),
          ),
        )
        .where(and(...allocationConditions))
        .groupBy(productionRuns.biocharStorageLocationId),
      getBinMovementLaneSums(
        ctx,
        options.storageLocationIds,
        executor,
      ),
    ]);

  const byLocation = new Map<string, LaneStockDerivation>(
    options.storageLocationIds.map((storageLocationId) => [
      storageLocationId,
      {
        storageLocationId,
        feedstockIntakeDryKg: 0,
        feedstockConsumedDryKg: 0,
        feedstockMovementDeltaKg: 0,
        feedstockStockDryKg: 0,
        biocharProducedKg: 0,
        biocharAllocatedKg: 0,
        biocharMovementDeltaKg: 0,
        biocharStockKg: 0,
        productMovementDeltaKg: 0,
      },
    ]),
  );

  for (const row of intakeRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.feedstockIntakeDryKg = row.total;
  }
  for (const row of consumptionRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.feedstockConsumedDryKg = row.total;
  }
  for (const row of outputRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.biocharProducedKg = row.total;
  }
  for (const row of allocationRows) {
    const stock = row.storageLocationId
      ? byLocation.get(row.storageLocationId)
      : undefined;
    if (stock) stock.biocharAllocatedKg = row.total;
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
    stock.feedstockStockDryKg =
      stock.feedstockIntakeDryKg -
      stock.feedstockConsumedDryKg +
      stock.feedstockMovementDeltaKg;
    stock.biocharStockKg =
      stock.biocharProducedKg -
      stock.biocharAllocatedKg +
      stock.biocharMovementDeltaKg;
  }

  return [...byLocation.values()];
}
