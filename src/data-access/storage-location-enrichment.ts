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
  feedstocks,
  feedstockTypes,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  deliveries,
  orders,
  applications,
  type StorageLocation,
} from "@/db/schema";
import { getBinMovementLaneSums, groupLaneSumsByLocation } from "./bin-movements";
import { requireAuth } from "./utils";

// ============================================
// Types
// ============================================

export interface StorageLocationLastActivity {
  type: "in" | "out";
  date: Date;
  massKg: number;
  label: string;
}

export interface StorageLocationWithFacility extends StorageLocation {
  facilityCode: string;
  facilityName: string;
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
}

export type BaseStorageLocationRow = {
  id: string;
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
};

function splitAggregateLabels(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

export async function enrichStorageLocationRows(
  userId: string,
  rows: BaseStorageLocationRow[]
): Promise<StorageLocationWithFacility[]> {
  requireAuth(userId);

  const storageLocationIds = rows.map((row) => row.id);
  const storageLocationIdsSql = sql.join(
    storageLocationIds.map((id) => sql`${id}`),
    sql`, `
  );

  // Run all enrichment queries in parallel
  const [
    feedstockInventoryRows,
    feedstockConsumptionRows,
    biocharOutputRows,
    biocharAllocationRows,
    productInventoryRows,
    productApplicationRows,
    lastActivityRows,
    movementLaneSums,
  ] = storageLocationIds.length > 0
    ? await Promise.all([
        db
          .select({
            storageLocationId: feedstocks.storageLocationId,
            batchCount: sql<number>`count(*) filter (where ${feedstocks.status} = 'complete')`,
            pendingBatchCount: sql<number>`count(*) filter (where ${feedstocks.status} = 'missing_data')`,
            feedstockTypes: sql<string | null>`
              string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})
            `,
            totalDryKg: sql<number>`
              COALESCE(SUM(${feedstocks.massDryKg}) filter (where ${feedstocks.status} = 'complete'), 0)
            `,
            totalWetKg: sql<number>`
              COALESCE(SUM(${feedstocks.massWetKg}) filter (where ${feedstocks.status} = 'complete'), 0)
            `,
            pendingDryKg: sql<number>`
              COALESCE(SUM(${feedstocks.massDryKg}) filter (where ${feedstocks.status} = 'missing_data'), 0)
            `,
          })
          .from(feedstocks)
          .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
          .where(inArray(feedstocks.storageLocationId, storageLocationIds))
          .groupBy(feedstocks.storageLocationId),
        db
          .select({
            storageLocationId: productionRuns.feedstockStorageLocationId,
            consumedDryKg: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`,
          })
          .from(productionRuns)
          .leftJoin(
            productionRunFeedstocks,
            eq(productionRunFeedstocks.productionRunId, productionRuns.id)
          )
          .where(inArray(productionRuns.feedstockStorageLocationId, storageLocationIds))
          .groupBy(productionRuns.feedstockStorageLocationId),
        db
          .select({
            storageLocationId: productionRuns.biocharStorageLocationId,
            productionRunCount: count(),
            producedKg: sql<number>`COALESCE(SUM(${productionRuns.biocharOutputKg}), 0)`,
          })
          .from(productionRuns)
          .where(inArray(productionRuns.biocharStorageLocationId, storageLocationIds))
          .groupBy(productionRuns.biocharStorageLocationId),
        db
          .select({
            storageLocationId: productionRuns.biocharStorageLocationId,
            allocatedKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
                ),
                0
              )
            `,
            downstreamFormulations: sql<string | null>`
              string_agg(DISTINCT ${formulations.name}, ', ' ORDER BY ${formulations.name})
            `,
          })
          .from(productionRuns)
          .innerJoin(
            biocharProducts,
            eq(biocharProducts.linkedProductionRunId, productionRuns.id)
          )
          .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
          .where(inArray(productionRuns.biocharStorageLocationId, storageLocationIds))
          .groupBy(productionRuns.biocharStorageLocationId),
        db
          .select({
            storageLocationId: biocharProducts.storageLocationId,
            batchCount: count(),
            currentMassKg: sql<number>`COALESCE(SUM(${biocharProducts.massKg}), 0)`,
            biocharEquivalentKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
                ),
                0
              )
            `,
            formulationNames: sql<string | null>`
              string_agg(DISTINCT ${formulations.name}, ', ' ORDER BY ${formulations.name})
            `,
          })
          .from(biocharProducts)
          .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
          .where(inArray(biocharProducts.storageLocationId, storageLocationIds))
          .groupBy(biocharProducts.storageLocationId),
        db
          .select({
            storageLocationId: sql<string>`
              COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId})
            `,
            appliedApplicationCount: count(),
            appliedDryMassKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${applications.biocharAppliedDryTons}, 0) * 1000
                ),
                0
              )
            `,
            lastAppliedAt: sql<Date | null>`MAX(${applications.applicationDate})`,
          })
          .from(applications)
          .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
          .leftJoin(orders, eq(deliveries.orderId, orders.id))
          .leftJoin(
            biocharProducts,
            sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`
          )
          .where(
            and(
              eq(applications.status, "applied"),
              sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId}) IS NOT NULL`,
              sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId}) IN (${storageLocationIdsSql})`
            )
          )
          .groupBy(
            sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId})`
          ),
        db.execute<{
          storage_location_id: string;
          activity_type: "in" | "out";
          activity_date: Date;
          mass_kg: number | null;
          label: string;
        }>(sql`
          WITH events AS (
            SELECT storage_location_id, 'in' as activity_type, created_at, mass_dry_kg as mass_kg, code as label
            FROM feedstocks WHERE storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT
              pr.feedstock_storage_location_id,
              'out',
              pr.created_at,
              COALESCE(SUM(prf.mass_used_kg), pr.feedstock_mass_dry_kg, 0) as mass_kg,
              pr.code
            FROM production_runs pr
            LEFT JOIN production_run_feedstocks prf ON prf.production_run_id = pr.id
            WHERE pr.feedstock_storage_location_id IN (${storageLocationIdsSql})
            GROUP BY
              pr.id,
              pr.feedstock_storage_location_id,
              pr.created_at,
              pr.feedstock_mass_dry_kg,
              pr.code
            UNION ALL
            SELECT biochar_storage_location_id, 'in', created_at, biochar_output_kg, code
            FROM production_runs WHERE biochar_storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT pr.biochar_storage_location_id, 'out', bp.created_at, bp.mass_kg * COALESCE(f.biochar_ratio, 1), bp.code
            FROM biochar_products bp
            JOIN production_runs pr ON bp.linked_production_run_id = pr.id
            LEFT JOIN formulations f ON bp.formulation_id = f.id
            WHERE pr.biochar_storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT storage_location_id, 'in', created_at, mass_kg, code
            FROM biochar_products WHERE storage_location_id IN (${storageLocationIdsSql})
          )
          SELECT DISTINCT ON (storage_location_id)
            storage_location_id, activity_type, created_at as activity_date, mass_kg, label
          FROM events
          WHERE storage_location_id IS NOT NULL
          ORDER BY storage_location_id, created_at DESC
        `),
        getBinMovementLaneSums(userId, storageLocationIds),
      ])
    : [
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
        label: row.label,
      },
    ])
  );

  const feedstockInventoryMap = new Map(
    feedstockInventoryRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const feedstockConsumptionMap = new Map(
    feedstockConsumptionRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const biocharOutputMap = new Map(
    biocharOutputRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const biocharAllocationMap = new Map(
    biocharAllocationRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const productInventoryMap = new Map(
    productInventoryRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const productApplicationMap = new Map(
    productApplicationRows
      .filter((row) => row.storageLocationId != null)
      .map((row) => [row.storageLocationId, row])
  );
  // Signed manual-reconciliation deltas per lane (issue #194).
  const movementMap = groupLaneSumsByLocation(movementLaneSums);

  return rows.map((row) => {
    const feedstockInventoryRow = feedstockInventoryMap.get(row.id);
    const feedstockConsumptionRow = feedstockConsumptionMap.get(row.id);
    const movements = movementMap.get(row.id) ?? {};
    const totalDryKg = Number(feedstockInventoryRow?.totalDryKg ?? 0);
    const totalWetKg = Number(feedstockInventoryRow?.totalWetKg ?? 0);
    const pendingDryKg = Number(feedstockInventoryRow?.pendingDryKg ?? 0);
    const consumedDryKg = Number(feedstockConsumptionRow?.consumedDryKg ?? 0);
    // Unclamped: intake − consumption + manual adjustments/losses. A negative
    // result is a real signal (draws outran recorded stock), surfaced as
    // "needs reconciliation" rather than hidden with Math.max.
    const currentDryMassKg =
      totalDryKg - consumedDryKg + (movements.feedstock ?? 0);
    // The moisture-ratio clamp stays — it bounds a ratio to [0, 1], it is not a
    // stock clamp.
    const moistureRatio =
      totalWetKg > 0 && totalDryKg >= 0
        ? Math.max(0, Math.min(1, (totalWetKg - totalDryKg) / totalWetKg))
        : null;
    const estimatedWetMassKg =
      moistureRatio != null && moistureRatio < 1
        ? currentDryMassKg / (1 - moistureRatio)
        : null;

    const biocharOutputRow = biocharOutputMap.get(row.id);
    const biocharAllocationRow = biocharAllocationMap.get(row.id);
    const producedKg = Number(biocharOutputRow?.producedKg ?? 0);
    const allocatedKg = Number(biocharAllocationRow?.allocatedKg ?? 0);

    const productInventoryRow = productInventoryMap.get(row.id);
    const productApplicationRow = productApplicationMap.get(row.id);
    const productBaseMassKg = Number(productInventoryRow?.currentMassKg ?? 0);

    return {
      ...row,
      facilityCode: row.facilityCode ?? "",
      facilityName: row.facilityName ?? "",
      feedstockInventory: {
        batchCount: Number(feedstockInventoryRow?.batchCount ?? 0),
        pendingBatchCount: Number(feedstockInventoryRow?.pendingBatchCount ?? 0),
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
        currentMassKg: producedKg - allocatedKg + (movements.biochar ?? 0),
        allocatedToProductsKg: allocatedKg,
        downstreamFormulations: splitAggregateLabels(
          biocharAllocationRow?.downstreamFormulations ?? null
        ),
      },
      productInventory: {
        batchCount: Number(productInventoryRow?.batchCount ?? 0),
        currentMassKg: productBaseMassKg + (movements.product ?? 0),
        biocharEquivalentKg: Number(productInventoryRow?.biocharEquivalentKg ?? 0),
        formulationNames: splitAggregateLabels(
          productInventoryRow?.formulationNames ?? null
        ),
        appliedApplicationCount: Number(
          productApplicationRow?.appliedApplicationCount ?? 0
        ),
        appliedDryMassKg: Number(productApplicationRow?.appliedDryMassKg ?? 0),
        lastAppliedAt: productApplicationRow?.lastAppliedAt
          ? new Date(productApplicationRow.lastAppliedAt)
          : null,
      },
      lastActivity: lastActivityMap.get(row.id) ?? null,
    };
  });
}
