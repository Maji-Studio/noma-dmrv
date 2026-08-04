/**
 * Storage Location Enrichment
 *
 * Derives per-lane inventory (feedstock / biochar / product) for a set of
 * storage-location rows by aggregating the source-of-truth entities, then
 * overlaying the signed sum of manual reconciliation movements (issue #194).
 *
 * Split out of `storage-locations.ts` to keep both files well under the 1000-line
 * cap and to give the movement overlay a natural home. The derived stock is
 * intentionally NOT clamped at zero: a negative lane means physical draws +
 * losses have outrun recorded intake, and the UI surfaces that as a
 * "needs reconciliation" signal rather than hiding it.
 */

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  countRows,
  numericAggregate,
  sumNumeric,
} from "@/db/aggregate";
import type { OrgContext } from "@/lib/auth/server";
import {
  feedstocks,
  feedstockTypes,
  productionRuns,
  biocharProducts,
  formulations,
  deliveries,
  orders,
  applications,
  binMovements,
  type StorageLocation,
} from "@/db/schema";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import { deriveLaneStock } from "./lane-stock-derivation";
import { sourceBiocharMassKgSql } from "./biochar-product-source-mass";
import { requireOrgScope } from "./utils";

// ============================================
// Types
// ============================================

export interface StorageLocationLastActivity {
  type: "in" | "out";
  date: Date;
  massKg: number;
  massDryKg: number | null;
  label: string;
}

export interface StorageLocationWithFacility extends StorageLocation {
  facilityCode: string;
  facilityName: string;
  feedstockTypeName: string | null;
  formulationName: string | null;
  feedstockInventory: {
    batchCount: number;
    pendingBatchCount: number;
    feedstockTypes: string[];
    currentDryMassKg: number;
    pendingDryMassKg: number;
    estimatedWetMassKg: number | null;
    estimatedMoisturePercent: number | null;
  };
  biocharInventory: {
    productionRunCount: number;
    currentMassKg: number;
    allocatedToProductsKg: number;
    downstreamFormulations: string[];
  };
  productInventory: {
    batchCount: number;
    currentMassKg: number;
    biocharEquivalentKg: number;
    formulationNames: string[];
    appliedApplicationCount: number;
    appliedDryMassKg: number;
    lastAppliedAt: Date | null;
  };
  lastActivity: StorageLocationLastActivity | null;
}

export interface PaginatedStorageLocations {
  items: StorageLocationWithFacility[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  laneSummary: Record<
    StorageLocation["type"],
    { binCount: number; onHandKg: number }
  >;
}

export type BaseStorageLocationRow = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  type: StorageLocation["type"];
  capacityKg: number | null;
  storageMethod: string | null;
  storageDescription: string | null;
  supplierReferenceId: string | null;
  feedstockTypeId: string | null;
  formulationId: string | null;
  facilityId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  facilityCode: string | null;
  facilityName: string | null;
  feedstockTypeName: string | null;
  formulationName: string | null;
};

function splitAggregateLabels(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

/**
 * Estimate remaining feedstock wet mass from the aggregate intake moisture
 * basis. Feedstock stock is canonically dry, so callers must never expose the
 * dry balance with a wet label when the basis is unavailable.
 */
export function estimateRemainingFeedstockWetMassKg(params: {
  intakeDryKg: number;
  intakeWetKg: number;
  remainingDryKg: number;
}): number | null {
  if (params.intakeWetKg === 0 && params.remainingDryKg === 0) return 0;

  const moistureRatio =
    params.intakeWetKg > 0 && params.intakeDryKg >= 0
      ? Math.max(
          0,
          Math.min(
            1,
            (params.intakeWetKg - params.intakeDryKg) / params.intakeWetKg,
          ),
        )
      : null;

  return moistureRatio != null && moistureRatio < 1
    ? params.remainingDryKg / (1 - moistureRatio)
    : null;
}

export async function enrichStorageLocationRows(
  ctx: OrgContext,
  rows: BaseStorageLocationRow[]
): Promise<StorageLocationWithFacility[]> {
  requireOrgScope(ctx);

  const storageLocationIds = rows.map((row) => row.id);
  const storageLocationIdsSql = sql.join(
    storageLocationIds.map((id) => sql`${id}`),
    sql`, `
  );

  // Run all enrichment queries in parallel
  const [
    feedstockInventoryRows,
    biocharOutputRows,
    sourceDownstreamProductRows,
    legacyDownstreamProductRows,
    productInventoryRows,
    productDeliveredRows,
    productApplicationRows,
    lastActivityRows,
    laneStockRows,
  ] = storageLocationIds.length > 0
    ? await db.transaction(async (tx) => Promise.all([
        tx
          .select({
            storageLocationId: feedstocks.storageLocationId,
            batchCount: countRows(sql`${feedstocks.status} = 'complete'`),
            pendingBatchCount: countRows(
              sql`${feedstocks.status} = 'missing_data'`,
            ),
            feedstockTypes: sql<string | null>`
              string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})
            `,
            totalWetKg: sumNumeric(
              feedstocks.massWetKg,
              sql`${feedstocks.status} = 'complete'`,
            ),
            pendingDryKg: sumNumeric(
              feedstocks.massDryKg,
              sql`${feedstocks.status} = 'missing_data'`,
            ),
          })
          .from(feedstocks)
          .leftJoin(
            feedstockTypes,
            and(
              eq(feedstocks.feedstockTypeId, feedstockTypes.id),
              eq(feedstockTypes.organizationId, ctx.organizationId),
            ),
          )
          .where(
            and(
              inArray(feedstocks.storageLocationId, storageLocationIds),
              eq(feedstocks.organizationId, ctx.organizationId),
            ),
          )
          .groupBy(feedstocks.storageLocationId),
        tx
          .select({
            storageLocationId: productionRuns.biocharStorageLocationId,
            productionRunCount: count(),
          })
          .from(productionRuns)
          .where(
            and(
              inArray(productionRuns.biocharStorageLocationId, storageLocationIds),
              eq(productionRuns.organizationId, ctx.organizationId),
            ),
          )
          .groupBy(productionRuns.biocharStorageLocationId),
        tx
          .select({
            storageLocationId:
              biocharProducts.sourceBiocharStorageLocationId,
            downstreamFormulations: sql<string | null>`
              string_agg(
                DISTINCT COALESCE(${formulations.name}, ${PURE_BIOCHAR_LABEL}),
                ', '
              )
            `,
          })
          .from(biocharProducts)
          .leftJoin(
            formulations,
            and(
              eq(biocharProducts.formulationId, formulations.id),
              eq(formulations.organizationId, ctx.organizationId),
            ),
          )
          .where(
            and(
              inArray(
                biocharProducts.sourceBiocharStorageLocationId,
                storageLocationIds,
              ),
              eq(biocharProducts.organizationId, ctx.organizationId),
            ),
          )
          .groupBy(biocharProducts.sourceBiocharStorageLocationId),
        tx
          .select({
            storageLocationId: productionRuns.biocharStorageLocationId,
            downstreamFormulations: sql<string | null>`
              string_agg(
                DISTINCT COALESCE(${formulations.name}, ${PURE_BIOCHAR_LABEL}),
                ', '
              )
            `,
          })
          .from(productionRuns)
          .innerJoin(
            biocharProducts,
            and(
              eq(biocharProducts.linkedProductionRunId, productionRuns.id),
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
          .where(
            and(
              inArray(productionRuns.biocharStorageLocationId, storageLocationIds),
              eq(productionRuns.organizationId, ctx.organizationId),
              sql`${biocharProducts.sourceBiocharStorageLocationId} IS NULL`,
            ),
          )
          .groupBy(productionRuns.biocharStorageLocationId),
        tx
          .select({
            storageLocationId: biocharProducts.storageLocationId,
            batchCount: count(),
            currentMassKg: sumNumeric(
              sql`COALESCE(${biocharProducts.massKg}, 0) + COALESCE(${biocharProducts.waterAddedKg}, 0)`,
            ),
            biocharEquivalentKg: numericAggregate(sql<number>`
              COALESCE(
                SUM(
                  ${sourceBiocharMassKgSql(
                    biocharProducts.massKg,
                    biocharProducts.composition,
                  )}
                ),
                0
              )
            `),
            formulationNames: sql<string | null>`
              string_agg(DISTINCT ${formulations.name}, ', ' ORDER BY ${formulations.name})
            `,
          })
          .from(biocharProducts)
          .leftJoin(
            formulations,
            and(
              eq(biocharProducts.formulationId, formulations.id),
              eq(formulations.organizationId, ctx.organizationId),
            ),
          )
          .where(
            and(
              inArray(biocharProducts.storageLocationId, storageLocationIds),
              eq(biocharProducts.organizationId, ctx.organizationId),
            ),
          )
          .groupBy(biocharProducts.storageLocationId),
        tx
          .select({
            storageLocationId: biocharProducts.storageLocationId,
            deliveredMassKg: sumNumeric(deliveries.deliveredWetMassKg),
          })
          .from(deliveries)
          .innerJoin(
            orders,
            and(
              eq(deliveries.orderId, orders.id),
              eq(orders.organizationId, ctx.organizationId),
            ),
          )
          .innerJoin(
            biocharProducts,
            and(
              sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
              eq(biocharProducts.organizationId, ctx.organizationId),
            ),
          )
          .where(
            and(
              eq(deliveries.status, "delivered"),
              eq(deliveries.organizationId, ctx.organizationId),
              inArray(biocharProducts.storageLocationId, storageLocationIds),
            ),
          )
          .groupBy(biocharProducts.storageLocationId),
        tx
          .select({
            storageLocationId: sql<string>`
              COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId})
            `,
            appliedApplicationCount: count(),
            appliedDryMassKg: numericAggregate(sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${applications.biocharAppliedDryTons}, 0) * 1000
                ),
                0
              )
            `),
            lastAppliedAt: sql<Date | null>`MAX(${applications.applicationDate})`,
          })
          .from(applications)
          .innerJoin(
            deliveries,
            and(
              eq(applications.deliveryId, deliveries.id),
              eq(deliveries.organizationId, ctx.organizationId),
            ),
          )
          .leftJoin(
            orders,
            and(
              eq(deliveries.orderId, orders.id),
              eq(orders.organizationId, ctx.organizationId),
            ),
          )
          .leftJoin(
            biocharProducts,
            and(
              sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
              eq(biocharProducts.organizationId, ctx.organizationId),
            ),
          )
          .where(
            and(
              eq(applications.status, "applied"),
              eq(applications.organizationId, ctx.organizationId),
              sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId}) IS NOT NULL`,
              sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId}) IN (${storageLocationIdsSql})`
            )
          )
          .groupBy(
            sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId})`
          ),
        tx.execute<{
          storage_location_id: string;
          activity_type: "in" | "out";
          activity_date: Date;
          mass_kg: number | null;
          mass_dry_kg: number | null;
          label: string;
        }>(sql`
          WITH events AS (
            SELECT
              storage_location_id,
              'in' as activity_type,
              created_at,
              mass_wet_kg as mass_kg,
              mass_dry_kg,
              'Feedstock received' as label
            FROM feedstocks WHERE organization_id = ${ctx.organizationId} AND storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT
              pr.feedstock_storage_location_id,
              'out',
              pr.created_at,
              COALESCE(SUM(prf.mass_used_kg), pr.feedstock_mass_dry_kg, 0) as mass_kg,
              COALESCE(SUM(prf.mass_used_kg), pr.feedstock_mass_dry_kg, 0) as mass_dry_kg,
              'Feedstock used'
            FROM production_runs pr
            LEFT JOIN production_run_feedstocks prf ON prf.production_run_id = pr.id AND prf.organization_id = ${ctx.organizationId}
            WHERE pr.organization_id = ${ctx.organizationId} AND pr.feedstock_storage_location_id IN (${storageLocationIdsSql})
            GROUP BY
              pr.id,
              pr.feedstock_storage_location_id,
              pr.created_at,
              pr.feedstock_mass_dry_kg,
              pr.code
            UNION ALL
            SELECT
              biochar_storage_location_id,
              'in',
              created_at,
              biochar_output_kg,
              biochar_dry_mass_kg,
              'Biochar produced'
            FROM production_runs WHERE organization_id = ${ctx.organizationId} AND biochar_storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT
              pr.biochar_storage_location_id,
              'out',
              bp.created_at,
              ${sourceBiocharMassKgSql(
                sql.raw("bp.mass_kg"),
                sql.raw("bp.composition"),
              )},
              CASE
                WHEN bp.mass_kg IS NULL
                  OR pr.biochar_output_kg IS NULL
                  OR pr.biochar_output_kg = 0
                  OR pr.biochar_dry_mass_kg IS NULL
                THEN NULL
                ELSE
                  ${sourceBiocharMassKgSql(
                    sql.raw("bp.mass_kg"),
                    sql.raw("bp.composition"),
                  )}
                  * pr.biochar_dry_mass_kg
                  / pr.biochar_output_kg
              END,
              COALESCE(f.name, ${PURE_BIOCHAR_LABEL})
            FROM biochar_products bp
            JOIN production_runs pr ON bp.linked_production_run_id = pr.id AND pr.organization_id = ${ctx.organizationId}
            LEFT JOIN formulations f ON bp.formulation_id = f.id AND f.organization_id = ${ctx.organizationId}
            WHERE bp.organization_id = ${ctx.organizationId}
              AND bp.source_biochar_storage_location_id IS NULL
              AND pr.biochar_storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT
              bp.source_biochar_storage_location_id,
              'out',
              bp.created_at,
              SUM(bpsa.allocated_wet_mass_kg),
              SUM(bpsa.allocated_dry_mass_kg),
              COALESCE(f.name, ${PURE_BIOCHAR_LABEL})
            FROM biochar_products bp
            LEFT JOIN biochar_product_source_allocations bpsa
              ON bpsa.biochar_product_id = bp.id
              AND bpsa.organization_id = ${ctx.organizationId}
              AND bpsa.source_storage_location_id = bp.source_biochar_storage_location_id
            LEFT JOIN formulations f
              ON bp.formulation_id = f.id
              AND f.organization_id = ${ctx.organizationId}
            WHERE bp.organization_id = ${ctx.organizationId}
              AND bp.source_biochar_storage_location_id IN (${storageLocationIdsSql})
            GROUP BY
              bp.source_biochar_storage_location_id,
              bp.id,
              bp.created_at,
              f.name
            UNION ALL
            SELECT
              bp.storage_location_id,
              'in',
              bp.created_at,
              COALESCE(bp.mass_kg, 0) + COALESCE(bp.water_added_kg, 0),
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM biochar_product_source_allocations allocation
                  WHERE allocation.biochar_product_id = bp.id
                    AND allocation.organization_id = ${ctx.organizationId}
                ) THEN (
                  SELECT COALESCE(SUM(allocation.allocated_dry_mass_kg), 0)
                  FROM biochar_product_source_allocations allocation
                  WHERE allocation.biochar_product_id = bp.id
                    AND allocation.organization_id = ${ctx.organizationId}
                )
                WHEN bp.mass_kg IS NULL OR bp.moisture_content_percent IS NULL
                  THEN NULL
                ELSE
                  ${sourceBiocharMassKgSql(
                    sql.raw("bp.mass_kg"),
                    sql.raw("bp.composition"),
                  )} * (1 - bp.moisture_content_percent / 100.0)
              END,
              COALESCE(f.name, ${PURE_BIOCHAR_LABEL})
            FROM biochar_products bp
            LEFT JOIN formulations f
              ON bp.formulation_id = f.id
              AND f.organization_id = ${ctx.organizationId}
            WHERE bp.organization_id = ${ctx.organizationId}
              AND bp.storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT
              ${binMovements.storageLocationId},
              CASE WHEN ${binMovements.massDeltaKg} >= 0 THEN 'in' ELSE 'out' END,
              ${binMovements.createdAt},
              ABS(${binMovements.massDeltaKg}),
              NULL,
              CASE
                WHEN ${binMovements.movementType} = 'loss' THEN 'Recorded loss'
                ELSE 'Stock-take adjustment'
              END
            FROM ${binMovements}
            WHERE ${binMovements.organizationId} = ${ctx.organizationId}
              AND ${binMovements.storageLocationId} IN (${storageLocationIdsSql})
          )
          SELECT DISTINCT ON (storage_location_id)
            storage_location_id,
            activity_type,
            created_at as activity_date,
            mass_kg,
            mass_dry_kg,
            label
          FROM events
          WHERE storage_location_id IS NOT NULL
          ORDER BY storage_location_id, created_at DESC
        `),
        deriveLaneStock(ctx, tx, { storageLocationIds }),
      ]), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      })
    : [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        {
          rows: [] as Array<{
            storage_location_id: string;
            activity_type: "in" | "out";
            activity_date: Date;
            mass_kg: number | null;
            mass_dry_kg: number | null;
            label: string;
          }>,
        },
        [],
      ];

  const lastActivityMap = new Map(
    lastActivityRows.rows.map((row) => [
      row.storage_location_id,
      {
        type: row.activity_type,
        date: new Date(row.activity_date),
        massKg: Number(row.mass_kg ?? 0),
        massDryKg:
          row.mass_dry_kg == null ? null : Number(row.mass_dry_kg),
        label: row.label,
      },
    ])
  );

  const feedstockInventoryMap = new Map(
    feedstockInventoryRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const biocharOutputMap = new Map(
    biocharOutputRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const downstreamFormulationsByLocation = new Map<string, Set<string>>();
  for (const allocationRow of [
    ...legacyDownstreamProductRows,
    ...sourceDownstreamProductRows,
  ]) {
    if (!allocationRow.storageLocationId) continue;
    const labels =
      downstreamFormulationsByLocation.get(allocationRow.storageLocationId) ??
      new Set<string>();
    for (const label of splitAggregateLabels(
      allocationRow.downstreamFormulations,
    )) {
      labels.add(label);
    }
    downstreamFormulationsByLocation.set(
      allocationRow.storageLocationId,
      labels,
    );
  }
  const productInventoryMap = new Map(
    productInventoryRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const productDeliveredMap = new Map(
    productDeliveredRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const productApplicationMap = new Map(
    productApplicationRows
      .filter((row) => row.storageLocationId != null)
      .map((row) => [row.storageLocationId, row])
  );
  const laneStockMap = new Map(
    laneStockRows.map((row) => [row.storageLocationId, row]),
  );

  return rows.map((row) => {
    const feedstockInventoryRow = feedstockInventoryMap.get(row.id);
    const laneStock = laneStockMap.get(row.id);
    const totalDryKg = laneStock?.feedstockIntakeDryKg ?? 0;
    const totalWetKg = feedstockInventoryRow?.totalWetKg ?? 0;
    const pendingDryKg = feedstockInventoryRow?.pendingDryKg ?? 0;
    // Unclamped: intake − consumption + manual adjustments/losses. A negative
    // result is a real signal (draws outran recorded stock), surfaced as
    // "needs reconciliation" rather than hidden with Math.max.
    const currentDryMassKg = laneStock?.feedstockStockDryKg ?? 0;
    // The moisture-ratio clamp stays — it bounds a ratio to [0, 1], it is not a
    // stock clamp.
    const moistureRatio =
      totalWetKg > 0 && totalDryKg >= 0
        ? Math.max(0, Math.min(1, (totalWetKg - totalDryKg) / totalWetKg))
        : null;
    const estimatedWetMassKg = estimateRemainingFeedstockWetMassKg({
      intakeDryKg: totalDryKg,
      intakeWetKg: totalWetKg,
      remainingDryKg: currentDryMassKg,
    });

    const biocharOutputRow = biocharOutputMap.get(row.id);
    const allocatedKg = laneStock?.biocharAllocatedKg ?? 0;

    const productInventoryRow = productInventoryMap.get(row.id);
    const productDeliveredRow = productDeliveredMap.get(row.id);
    const productApplicationRow = productApplicationMap.get(row.id);
    const productBaseMassKg = productInventoryRow?.currentMassKg ?? 0;
    const productDeliveredMassKg = productDeliveredRow?.deliveredMassKg ?? 0;

    return {
      ...row,
      facilityCode: row.facilityCode ?? "",
      facilityName: row.facilityName ?? "",
      feedstockInventory: {
        batchCount: feedstockInventoryRow?.batchCount ?? 0,
        pendingBatchCount: feedstockInventoryRow?.pendingBatchCount ?? 0,
        feedstockTypes: splitAggregateLabels(feedstockInventoryRow?.feedstockTypes ?? null),
        currentDryMassKg,
        pendingDryMassKg: pendingDryKg,
        estimatedWetMassKg,
        estimatedMoisturePercent:
          moistureRatio != null ? moistureRatio * 100 : null,
      },
      biocharInventory: {
        productionRunCount: Number(biocharOutputRow?.productionRunCount ?? 0),
        // Unclamped, movement-inclusive (see currentDryMassKg above).
        currentMassKg: laneStock?.biocharStockKg ?? 0,
        allocatedToProductsKg: allocatedKg,
        downstreamFormulations: [
          ...(downstreamFormulationsByLocation.get(row.id) ?? []),
        ].sort(),
      },
      productInventory: {
        batchCount: Number(productInventoryRow?.batchCount ?? 0),
        currentMassKg:
          productBaseMassKg -
          productDeliveredMassKg +
          (laneStock?.productMovementDeltaKg ?? 0),
        biocharEquivalentKg: productInventoryRow?.biocharEquivalentKg ?? 0,
        formulationNames: splitAggregateLabels(
          productInventoryRow?.formulationNames ?? null
        ),
        appliedApplicationCount: Number(
          productApplicationRow?.appliedApplicationCount ?? 0
        ),
        appliedDryMassKg: productApplicationRow?.appliedDryMassKg ?? 0,
        lastAppliedAt: productApplicationRow?.lastAppliedAt
          ? new Date(productApplicationRow.lastAppliedAt)
          : null,
      },
      lastActivity: lastActivityMap.get(row.id) ?? null,
    };
  });
}
