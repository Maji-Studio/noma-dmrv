/**
 * Storage-location options for searchable entity selection.
 *
 * The subtitle reflects live inventory (remaining feedstock, available biochar,
 * stored product), computed from five aggregate subqueries joined per location.
 */

import { ilike, or, eq, and, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { numericAggregate, sumNumeric } from "@/db/aggregate";
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
import type { OrgContext } from "@/lib/auth/server";
import {
  formatStorageLocationType,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import { requireOrgScope } from "../utils";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";

function formatStorageLocationSubtitle(
  type: string,
  feedstockTypeName: string | null,
  feedstockTypeUsage: string | null,
  totalStoredKg: number,
  pendingStoredKg: number,
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
      const onHandKg = Math.max(0, totalStoredKg - totalConsumedKg);
      if (!feedstockTypeName && onHandKg === 0) {
        return `${typeLabel} · Empty · Feedstock type locks on first intake`;
      }

      const parts: string[] = [typeLabel];
      if (feedstockTypeName) {
        parts.push(
          feedstockTypeUsage
            ? `${feedstockTypeName} (${formatFeedstockTypeUsage(feedstockTypeUsage)})`
            : feedstockTypeName
        );
      }
      parts.push(`${Math.round(onHandKg).toLocaleString()} kg stored`);
      if (pendingStoredKg > 0) {
        parts.push(`${Math.round(pendingStoredKg).toLocaleString()} kg pending completion`);
      }
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
      const blendLabel = formulationName ?? PURE_BIOCHAR_LABEL;
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
    default:
      return "Empty";
  }
}

function formatFeedstockTypeUsage(usage: string): string {
  return usage === "pyrolysis" ? "Pyrolysis" : "Blend";
}

const heldFeedstockTypes = alias(feedstockTypes, "held_feedstock_types");

function buildInventoryAggregates(ctx: OrgContext) {
  const feedstockInventoryAggregate = db
  .select({
    storageLocationId: feedstocks.storageLocationId,
    feedstockTypeName: sql<string | null>`string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})`.as("feedstock_type_name"),
    totalStoredKg: sumNumeric(
      feedstocks.massDryKg,
      sql`${feedstocks.status} = 'complete'`,
    ).as("total_stored_kg"),
    pendingStoredKg: sumNumeric(
      feedstocks.massDryKg,
      sql`${feedstocks.status} = 'missing_data'`,
    ).as("pending_stored_kg"),
  })
  .from(feedstocks)
  .leftJoin(
    feedstockTypes,
    and(
      eq(feedstocks.feedstockTypeId, feedstockTypes.id),
      eq(feedstockTypes.organizationId, ctx.organizationId),
    ),
  )
  .where(eq(feedstocks.organizationId, ctx.organizationId))
  .groupBy(feedstocks.storageLocationId)
  .as("feedstock_inventory_agg");

  const productionRunConsumptionAggregate = db
  .select({
    storageLocationId: productionRuns.feedstockStorageLocationId,
    totalConsumedKg: sumNumeric(productionRunFeedstocks.massUsedKg).as(
      "total_consumed_kg",
    ),
  })
  .from(productionRuns)
  .leftJoin(
    productionRunFeedstocks,
    and(
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    ),
  )
  .where(and(
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  ))
  .groupBy(productionRuns.feedstockStorageLocationId)
  .as("production_run_consumption_agg");

  const biocharOutputAggregate = db
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalProducedKg: sumNumeric(productionRuns.biocharOutputKg).as(
      "total_produced_kg",
    ),
  })
  .from(productionRuns)
  .where(and(
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  ))
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_output_agg");

  const biocharAllocationAggregate = db
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalAllocatedKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${biocharProducts.biocharRatio}, ${formulations.biocharRatio}, 1)
        ),
        0
      )
    `).as("total_allocated_kg"),
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
  .where(and(
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  ))
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_allocation_agg");

  const productInventoryAggregate = db
  .select({
    storageLocationId: biocharProducts.storageLocationId,
    totalProductKg: sumNumeric(biocharProducts.massKg).as("total_product_kg"),
    biocharEquivalentKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${biocharProducts.biocharRatio}, ${formulations.biocharRatio}, 1)
        ),
        0
      )
    `).as("biochar_equivalent_kg"),
  })
  .from(biocharProducts)
  .leftJoin(
    formulations,
    and(
      eq(biocharProducts.formulationId, formulations.id),
      eq(formulations.organizationId, ctx.organizationId),
    ),
  )
  .where(eq(biocharProducts.organizationId, ctx.organizationId))
  .groupBy(biocharProducts.storageLocationId)
  .as("product_inventory_agg");

  return {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    biocharOutputAggregate,
    biocharAllocationAggregate,
    productInventoryAggregate,
  };
}

export async function getStorageLocations(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  type?: StorageLocationType | StorageLocationType[];
  feedstockTypeId?: string;
  feedstockTypeUsage?: "pyrolysis" | "blend";
  /** Show product bins reserved for this formulation, plus unassigned (empty) bins. */
  formulationId?: string;
  /** Show only pure-biochar product bins (formulation unset). For pure-biochar products. */
  pureProductOnly?: boolean;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, type, feedstockTypeId, feedstockTypeUsage, formulationId, pureProductOnly, limit } =
    params;
  requireOrgScope(ctx);

  const {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    biocharOutputAggregate,
    biocharAllocationAggregate,
    productInventoryAggregate,
  } = buildInventoryAggregates(ctx);

  const conditions: SQL[] = [
    eq(storageLocations.organizationId, ctx.organizationId),
    isNull(storageLocations.archivedAt),
  ];

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

  // A feedstock-type filter means the bin either already holds that exact type
  // or is still untyped and can be claimed by its first type-specific intake.
  if (feedstockTypeId) {
    conditions.push(
      or(
        eq(storageLocations.feedstockTypeId, feedstockTypeId),
        isNull(storageLocations.feedstockTypeId),
      )!
    );
  }

  // The usage filter must not cancel the untyped-bin inclusion above: an untyped
  // bin has no joined feedstock type (NULL usage), so when a type filter is also
  // active we keep the IS NULL branch claimable instead of dropping it here.
  if (feedstockTypeUsage) {
    conditions.push(
      feedstockTypeId
        ? or(
            eq(heldFeedstockTypes.usage, feedstockTypeUsage),
            isNull(storageLocations.feedstockTypeId),
          )!
        : eq(heldFeedstockTypes.usage, feedstockTypeUsage)
    );
  }

  // Keep product bins clean: a pure-biochar product can only land in an unassigned
  // bin; a formulated product can land in a matching bin or an unassigned one (which
  // then gets claimed for that formulation on first intake).
  if (pureProductOnly) {
    conditions.push(
      and(
        eq(storageLocations.type, "product_bin"),
        sql`${storageLocations.formulationId} IS NULL`
      )!
    );
  } else if (formulationId) {
    conditions.push(
      and(
        eq(storageLocations.type, "product_bin"),
        or(
          sql`${storageLocations.formulationId} IS NULL`,
          eq(storageLocations.formulationId, formulationId)
        )!
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

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      heldFeedstockTypeName: heldFeedstockTypes.name,
      heldFeedstockTypeUsage: heldFeedstockTypes.usage,
      feedstockTypeName: feedstockInventoryAggregate.feedstockTypeName,
      formulationName: formulations.name,
      totalStoredKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredKg}, 0)`,
      ),
      pendingStoredKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.pendingStoredKg}, 0)`,
      ),
      totalConsumedKg: numericAggregate(
        sql<number>`COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)`,
      ),
      totalProducedKg: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.totalProducedKg}, 0)`,
      ),
      totalAllocatedKg: numericAggregate(
        sql<number>`COALESCE(${biocharAllocationAggregate.totalAllocatedKg}, 0)`,
      ),
      totalProductKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      ),
      biocharEquivalentKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.biocharEquivalentKg}, 0)`,
      ),
    })
    .from(storageLocations)
    .leftJoin(
      heldFeedstockTypes,
      and(
        eq(storageLocations.feedstockTypeId, heldFeedstockTypes.id),
        eq(heldFeedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(storageLocations.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
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
      r.heldFeedstockTypeName ?? r.feedstockTypeName,
      r.heldFeedstockTypeUsage,
      r.totalStoredKg,
      r.pendingStoredKg,
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
  ctx: OrgContext,
  id: string
): Promise<EntityOption | null> {
  requireOrgScope(ctx);

  const {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    biocharOutputAggregate,
    biocharAllocationAggregate,
    productInventoryAggregate,
  } = buildInventoryAggregates(ctx);

  const [result] = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      heldFeedstockTypeName: heldFeedstockTypes.name,
      heldFeedstockTypeUsage: heldFeedstockTypes.usage,
      feedstockTypeName: feedstockInventoryAggregate.feedstockTypeName,
      formulationName: formulations.name,
      totalStoredKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredKg}, 0)`,
      ),
      pendingStoredKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.pendingStoredKg}, 0)`,
      ),
      totalConsumedKg: numericAggregate(
        sql<number>`COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)`,
      ),
      totalProducedKg: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.totalProducedKg}, 0)`,
      ),
      totalAllocatedKg: numericAggregate(
        sql<number>`COALESCE(${biocharAllocationAggregate.totalAllocatedKg}, 0)`,
      ),
      totalProductKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      ),
      biocharEquivalentKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.biocharEquivalentKg}, 0)`,
      ),
    })
    .from(storageLocations)
    .leftJoin(
      heldFeedstockTypes,
      and(
        eq(storageLocations.feedstockTypeId, heldFeedstockTypes.id),
        eq(heldFeedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(storageLocations.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
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
    .where(
      and(
        eq(storageLocations.id, id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: formatStorageLocationSubtitle(
      result.type,
      result.heldFeedstockTypeName ?? result.feedstockTypeName,
      result.heldFeedstockTypeUsage,
      result.totalStoredKg,
      result.pendingStoredKg,
      result.totalConsumedKg,
      result.totalProducedKg,
      result.totalAllocatedKg,
      result.totalProductKg,
      result.biocharEquivalentKg,
      result.formulationName
    ),
  };
}
