/**
 * Storage-location options for searchable entity selection.
 *
 * The subtitle reflects live inventory (remaining feedstock, available biochar,
 * stored product), computed from five aggregate subqueries joined per location.
 */

import { ilike, or, eq, and, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  storageLocations,
  feedstocks,
  feedstockTypes,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
} from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import {
  formatStorageLocationType,
  type StorageLocationType,
} from "@/schemas/storage-locations";

function formatStorageLocationSubtitle(
  type: string,
  feedstockTypeName: string | null,
  totalStoredKg: number,
  totalConsumedKg: number,
  totalProducedKg: number,
  totalAllocatedKg: number,
  totalProductKg: number,
  biocharEquivalentKg: number,
  formulationName: string | null,
): string {
  switch (type) {
    case "feedstock_bin": {
      const typeLabel = formatStorageLocationType(type);
      const remainingKg = Math.max(0, totalStoredKg - totalConsumedKg);
      if (!feedstockTypeName && remainingKg === 0) {
        return `${typeLabel} · Empty`;
      }

      const parts: string[] = [typeLabel];
      if (feedstockTypeName) {
        parts.push(feedstockTypeName);
      }
      parts.push(`${Math.round(remainingKg).toLocaleString()} kg remaining`);
      return parts.join(" · ");
    }
    case "biochar_bin": {
      const typeLabel = formatStorageLocationType(type);
      const availableBiocharKg = Math.max(0, totalProducedKg - totalAllocatedKg);
      if (availableBiocharKg === 0) {
        return `${typeLabel} · Empty`;
      }
      return `${typeLabel} · ${Math.round(availableBiocharKg).toLocaleString()} kg biochar available`;
    }
    case "product_bin": {
      const typeLabel = formatStorageLocationType(type);
      // A product bin is bound to one formulation (or pure biochar when unset).
      const blendLabel = formulationName ?? "Pure biochar";
      if (totalProductKg === 0) {
        return `${typeLabel} · ${blendLabel} · Empty`;
      }

      const parts = [
        typeLabel,
        blendLabel,
        `${Math.round(totalProductKg).toLocaleString()} kg products`,
      ];
      if (biocharEquivalentKg > 0) {
        parts.push(`${Math.round(biocharEquivalentKg).toLocaleString()} kg biochar eq`);
      }
      return parts.join(" · ");
    }
    case "ingredient_bin": {
      const typeLabel = formatStorageLocationType(type);
      const remainingKg = Math.max(0, totalStoredKg - totalConsumedKg);
      if (!feedstockTypeName && remainingKg === 0) {
        return `${typeLabel} · Empty`;
      }

      const parts: string[] = [typeLabel];
      if (feedstockTypeName) {
        parts.push(feedstockTypeName);
      }
      parts.push(`${Math.round(remainingKg).toLocaleString()} kg remaining`);
      return parts.join(" · ");
    }
    default:
      return "Empty";
  }
}

const feedstockInventoryAggregate = db
  .select({
    storageLocationId: feedstocks.storageLocationId,
    feedstockTypeName: sql<string | null>`string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})`.as("feedstock_type_name"),
    totalStoredKg: sql<number>`SUM(${feedstocks.massDryKg})`.as("total_stored_kg"),
  })
  .from(feedstocks)
  .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
  .groupBy(feedstocks.storageLocationId)
  .as("feedstock_inventory_agg");

const productionRunConsumptionAggregate = db
  .select({
    storageLocationId: productionRuns.feedstockStorageLocationId,
    totalConsumedKg: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`.as("total_consumed_kg"),
  })
  .from(productionRuns)
  .leftJoin(
    productionRunFeedstocks,
    eq(productionRunFeedstocks.productionRunId, productionRuns.id)
  )
  .groupBy(productionRuns.feedstockStorageLocationId)
  .as("production_run_consumption_agg");

const biocharOutputAggregate = db
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalProducedKg: sql<number>`COALESCE(SUM(${productionRuns.biocharOutputKg}), 0)`.as("total_produced_kg"),
  })
  .from(productionRuns)
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_output_agg");

const biocharAllocationAggregate = db
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalAllocatedKg: sql<number>`
      COALESCE(
        SUM(
          COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
        ),
        0
      )
    `.as("total_allocated_kg"),
  })
  .from(productionRuns)
  .innerJoin(
    biocharProducts,
    eq(biocharProducts.linkedProductionRunId, productionRuns.id)
  )
  .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_allocation_agg");

const productInventoryAggregate = db
  .select({
    storageLocationId: biocharProducts.storageLocationId,
    totalProductKg: sql<number>`COALESCE(SUM(${biocharProducts.massKg}), 0)`.as("total_product_kg"),
    biocharEquivalentKg: sql<number>`
      COALESCE(
        SUM(
          COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
        ),
        0
      )
    `.as("biochar_equivalent_kg"),
  })
  .from(biocharProducts)
  .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
  .groupBy(biocharProducts.storageLocationId)
  .as("product_inventory_agg");

export async function getStorageLocations(params: {
  search?: string;
  facilityId?: string;
  type?: StorageLocationType | StorageLocationType[];
  feedstockTypeId?: string;
  /** Show product bins reserved for this formulation, plus unassigned (empty) bins. */
  formulationId?: string;
  /** Show only pure-biochar product bins (formulation unset). For pure-biochar products. */
  pureProductOnly?: boolean;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, type, feedstockTypeId, formulationId, pureProductOnly, limit } =
    params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(storageLocations.facilityId, facilityId));
  }

  if (type) {
    if (Array.isArray(type)) {
      conditions.push(inArray(storageLocations.type, type));
    } else {
      conditions.push(eq(storageLocations.type, type));
    }
  }

  // Only show bins that are empty or already hold the same feedstock type
  if (feedstockTypeId) {
    conditions.push(
      or(
        sql`${storageLocations.feedstockTypeId} IS NULL`,
        eq(storageLocations.feedstockTypeId, feedstockTypeId)
      )!
    );
  }

  // Keep product bins clean: a pure-biochar product can only land in an unassigned
  // bin; a formulated product can land in a matching bin or an unassigned one (which
  // then gets claimed for that formulation on first intake).
  if (pureProductOnly) {
    conditions.push(sql`${storageLocations.formulationId} IS NULL`);
  } else if (formulationId) {
    conditions.push(
      or(
        sql`${storageLocations.formulationId} IS NULL`,
        eq(storageLocations.formulationId, formulationId)
      )!
    );
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(storageLocations.code, searchPattern),
        ilike(storageLocations.name, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      feedstockTypeName: feedstockInventoryAggregate.feedstockTypeName,
      formulationName: formulations.name,
      totalStoredKg: sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredKg}, 0)`,
      totalConsumedKg: sql<number>`COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)`,
      totalProducedKg: sql<number>`COALESCE(${biocharOutputAggregate.totalProducedKg}, 0)`,
      totalAllocatedKg: sql<number>`COALESCE(${biocharAllocationAggregate.totalAllocatedKg}, 0)`,
      totalProductKg: sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      biocharEquivalentKg: sql<number>`COALESCE(${productInventoryAggregate.biocharEquivalentKg}, 0)`,
    })
    .from(storageLocations)
    .leftJoin(formulations, eq(storageLocations.formulationId, formulations.id))
    .leftJoin(
      feedstockInventoryAggregate,
      eq(storageLocations.id, feedstockInventoryAggregate.storageLocationId)
    )
    .leftJoin(
      productionRunConsumptionAggregate,
      eq(storageLocations.id, productionRunConsumptionAggregate.storageLocationId)
    )
    .leftJoin(
      biocharOutputAggregate,
      eq(storageLocations.id, biocharOutputAggregate.storageLocationId)
    )
    .leftJoin(
      biocharAllocationAggregate,
      eq(storageLocations.id, biocharAllocationAggregate.storageLocationId)
    )
    .leftJoin(
      productInventoryAggregate,
      eq(storageLocations.id, productInventoryAggregate.storageLocationId)
    )
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: formatStorageLocationSubtitle(
      r.type,
      r.feedstockTypeName,
      r.totalStoredKg,
      r.totalConsumedKg,
      r.totalProducedKg,
      r.totalAllocatedKg,
      r.totalProductKg,
      r.biocharEquivalentKg,
      r.formulationName
    ),
  }));
}

export async function getStorageLocationById(
  id: string
): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      feedstockTypeName: feedstockInventoryAggregate.feedstockTypeName,
      formulationName: formulations.name,
      totalStoredKg: sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredKg}, 0)`,
      totalConsumedKg: sql<number>`COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)`,
      totalProducedKg: sql<number>`COALESCE(${biocharOutputAggregate.totalProducedKg}, 0)`,
      totalAllocatedKg: sql<number>`COALESCE(${biocharAllocationAggregate.totalAllocatedKg}, 0)`,
      totalProductKg: sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      biocharEquivalentKg: sql<number>`COALESCE(${productInventoryAggregate.biocharEquivalentKg}, 0)`,
    })
    .from(storageLocations)
    .leftJoin(formulations, eq(storageLocations.formulationId, formulations.id))
    .leftJoin(
      feedstockInventoryAggregate,
      eq(storageLocations.id, feedstockInventoryAggregate.storageLocationId)
    )
    .leftJoin(
      productionRunConsumptionAggregate,
      eq(storageLocations.id, productionRunConsumptionAggregate.storageLocationId)
    )
    .leftJoin(
      biocharOutputAggregate,
      eq(storageLocations.id, biocharOutputAggregate.storageLocationId)
    )
    .leftJoin(
      biocharAllocationAggregate,
      eq(storageLocations.id, biocharAllocationAggregate.storageLocationId)
    )
    .leftJoin(
      productInventoryAggregate,
      eq(storageLocations.id, productInventoryAggregate.storageLocationId)
    )
    .where(eq(storageLocations.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: formatStorageLocationSubtitle(
      result.type,
      result.feedstockTypeName,
      result.totalStoredKg,
      result.totalConsumedKg,
      result.totalProducedKg,
      result.totalAllocatedKg,
      result.totalProductKg,
      result.biocharEquivalentKg,
      result.formulationName
    ),
  };
}
