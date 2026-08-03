/**
 * Storage-location options for searchable entity selection.
 *
 * The subtitle reflects live inventory (remaining feedstock, available biochar,
 * stored product), computed from five aggregate subqueries joined per location.
 */

import {
  ilike,
  or,
  eq,
  and,
  inArray,
  isNull,
  lt,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { countRows, numericAggregate, sumNumeric } from "@/db/aggregate";
import {
  storageLocations,
  feedstocks,
  feedstockTypes,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  biocharProductSourceAllocations,
  binMovements,
  deliveries,
  formulations,
  orders,
} from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import {
  formatStorageLocationType,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { requireOrgScope } from "../utils";
import {
  CANCELLED_PRODUCTION_RUN_STATUS,
  COMPLETED_PRODUCTION_RUN_STATUS,
} from "@/lib/production-runs/lifecycle";
import {
  deriveLaneStock,
  type LaneStockDerivation,
} from "../lane-stock-derivation";
import { estimateRemainingFeedstockWetMassKg } from "../storage-location-enrichment";
import { sourceBiocharMassKgSql } from "../biochar-product-source-mass";

export function formatStorageLocationSubtitle(
  type: string,
  feedstockTypeName: string | null,
  feedstockTypeUsage: string | null,
  totalStoredKg: number,
  pendingStoredKg: number,
  totalConsumedKg: number,
  totalProducedWetKg: number,
  totalProducedDryKg: number,
  unresolvedProducedDryCount: number,
  totalAllocatedWetKg: number,
  totalAllocatedDryKg: number,
  documentedLossWetKg: number,
  totalProductKg: number,
  totalProductDryKg: number,
  unresolvedProductDryCount: number,
  biocharEquivalentKg: number,
  formulationName: string | null,
  remainingMass?: EntityOption["remainingMass"],
): string {
  switch (type) {
    case "feedstock_bin": {
      const typeLabel = formatStorageLocationType(type);
      const onHandKg =
        remainingMass?.dryKg ?? Math.max(0, totalStoredKg - totalConsumedKg);
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
      const availableWetKg =
        remainingMass?.wetKg ??
        Math.max(
          0,
          totalProducedWetKg - totalAllocatedWetKg - documentedLossWetKg,
        );
      const availableDryKg =
        remainingMass && "dryKg" in remainingMass
          ? remainingMass.dryKg
          : unresolvedProducedDryCount > 0 || documentedLossWetKg > 0
          ? null
          : Math.max(0, totalProducedDryKg - totalAllocatedDryKg);
      if (availableWetKg === 0) {
        return `${typeLabel} · Empty`;
      }
      return `${typeLabel} · ${formatWetDryMass({
        wetKg: availableWetKg,
        dryKg: availableDryKg,
        wetLabel: "Wet biochar",
        dryLabel: "Dry biochar",
        separator: " | ",
        unitSpacing: "compact",
      })} available`;
    }
    case "product_bin": {
      const typeLabel = formatStorageLocationType(type);
      // A product bin is bound to one formulation (or pure biochar when unset).
      const blendLabel = formulationName ?? PURE_BIOCHAR_LABEL;
      const availableWetKg = remainingMass?.wetKg ?? totalProductKg;
      if (availableWetKg === 0) {
        return `${typeLabel} · ${blendLabel} · Empty`;
      }
      const productDryKg =
        remainingMass && "dryKg" in remainingMass
          ? remainingMass.dryKg
          : unresolvedProductDryCount > 0
            ? null
            : totalProductDryKg;
      const parts = [
        typeLabel,
        blendLabel,
        `${formatWetDryMass({
          wetKg: availableWetKg,
          dryKg: productDryKg,
          wetLabel: "Wet biochar product",
          dryLabel: "Dry biochar",
          separator: " | ",
          unitSpacing: "compact",
        })} stored`,
      ];
      if (biocharEquivalentKg > 0) {
        parts.push(
          `${Math.round(biocharEquivalentKg).toLocaleString()} kg biochar equivalent`,
        );
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

type StorageLocationReadExecutor = Pick<typeof db, "select">;

function buildInventoryAggregates(
  ctx: OrgContext,
  executor: StorageLocationReadExecutor = db,
) {
  const feedstockInventoryAggregate = executor
  .select({
    storageLocationId: feedstocks.storageLocationId,
    feedstockTypeName: sql<string | null>`string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})`.as("feedstock_type_name"),
    totalStoredKg: sumNumeric(
      feedstocks.massDryKg,
      sql`${feedstocks.status} = 'complete'`,
    ).as("total_stored_kg"),
    totalStoredWetKg: sumNumeric(
      feedstocks.massWetKg,
      sql`${feedstocks.status} = 'complete'`,
    ).as("total_stored_wet_kg"),
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

  const productionRunConsumptionAggregate = executor
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

  const ingredientConsumptionAggregate = executor
  .select({
    storageLocationId: sql<string>`ingredient.value ->> 'storageLocationId'`.as(
      "ingredient_storage_location_id",
    ),
    totalConsumedKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          CASE
            WHEN jsonb_typeof(ingredient.value -> 'massDryKg') = 'number'
              AND (ingredient.value ->> 'massDryKg')::numeric > 0
            THEN (ingredient.value ->> 'massDryKg')::numeric
            ELSE 0
          END
        ),
        0
      )
    `).as("ingredient_consumed_kg"),
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
  .where(eq(biocharProducts.organizationId, ctx.organizationId))
  .groupBy(sql`ingredient.value ->> 'storageLocationId'`)
  .as("ingredient_consumption_agg");

  const biocharOutputAggregate = executor
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalProducedWetKg: sumNumeric(productionRuns.biocharOutputKg).as(
      "total_produced_wet_kg",
    ),
    totalProducedDryKg: sumNumeric(productionRuns.biocharDryMassKg).as(
      "total_produced_dry_kg",
    ),
    unresolvedProducedDryCount: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          CASE
            WHEN COALESCE(${productionRuns.biocharOutputKg}, 0) > 0
              AND ${productionRuns.biocharDryMassKg} IS NULL
            THEN 1
            ELSE 0
          END
        ),
        0
      )
    `).as(
      "unresolved_produced_dry_count",
    ),
  })
  .from(productionRuns)
  .where(and(
    eq(productionRuns.organizationId, ctx.organizationId),
    eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
  ))
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_output_agg");

  const legacyBiocharAllocationAggregate = executor
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalAllocatedWetKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          ${sourceBiocharMassKgSql(biocharProducts.massKg, biocharProducts.composition)}
        ),
        0
      )
    `).as("legacy_allocated_wet_kg"),
    totalAllocatedDryKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          ${sourceBiocharMassKgSql(biocharProducts.massKg, biocharProducts.composition)}
          * (
            COALESCE(${productionRuns.biocharDryMassKg}, 0)
            / NULLIF(COALESCE(${productionRuns.biocharOutputKg}, 0), 0)
          )
        ),
        0
      )
    `).as("legacy_allocated_dry_kg"),
  })
  .from(productionRuns)
  .innerJoin(
    biocharProducts,
    and(
      eq(biocharProducts.linkedProductionRunId, productionRuns.id),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ),
  )
  .where(and(
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
    isNull(biocharProducts.sourceBiocharStorageLocationId),
  ))
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("legacy_biochar_allocation_agg");

  const sourceBiocharAllocationAggregate = executor
  .select({
    storageLocationId:
      biocharProductSourceAllocations.sourceStorageLocationId,
    totalAllocatedWetKg: sumNumeric(
      biocharProductSourceAllocations.allocatedWetMassKg,
    ).as("source_allocated_wet_kg"),
    totalAllocatedDryKg: sumNumeric(
      biocharProductSourceAllocations.allocatedDryMassKg,
    ).as("source_allocated_dry_kg"),
  })
  .from(biocharProductSourceAllocations)
  .where(
    eq(
      biocharProductSourceAllocations.organizationId,
      ctx.organizationId,
    ),
  )
  .groupBy(
    biocharProductSourceAllocations.sourceStorageLocationId,
  )
  .as("source_biochar_allocation_agg");

  const biocharLossAggregate = executor
  .select({
    storageLocationId: binMovements.storageLocationId,
    documentedLossWetKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(-${binMovements.massDeltaKg}),
        0
      )
    `).as("documented_loss_wet_kg"),
  })
  .from(binMovements)
  .where(
    and(
      eq(binMovements.organizationId, ctx.organizationId),
      eq(binMovements.lane, "biochar"),
      lt(binMovements.massDeltaKg, 0),
    ),
  )
  .groupBy(binMovements.storageLocationId)
  .as("biochar_loss_agg");

  const productInventoryAggregate = executor
  .select({
    storageLocationId: biocharProducts.storageLocationId,
    totalProductKg: sumNumeric(
      sql`COALESCE(${biocharProducts.massKg}, 0) + COALESCE(${biocharProducts.waterAddedKg}, 0)`,
    ).as("total_product_kg"),
    totalProductDryKg: sumNumeric(
      sql`${biocharProducts.massKg} * (1 - (${biocharProducts.moistureContentPercent} / 100.0))`,
      sql`${biocharProducts.massKg} IS NOT NULL AND ${biocharProducts.moistureContentPercent} IS NOT NULL`,
    ).as("total_product_dry_kg"),
    unresolvedProductDryCount: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          CASE
            WHEN COALESCE(${biocharProducts.massKg}, 0) > 0
              AND ${biocharProducts.moistureContentPercent} IS NULL
            THEN 1
            ELSE 0
          END
        ),
        0
      )
    `).as("unresolved_product_dry_count"),
    biocharEquivalentKg: numericAggregate(sql<number>`
      COALESCE(
        SUM(
          ${sourceBiocharMassKgSql(biocharProducts.massKg, biocharProducts.composition)}
        ),
        0
      )
    `).as("biochar_equivalent_kg"),
  })
  .from(biocharProducts)
  .where(eq(biocharProducts.organizationId, ctx.organizationId))
  .groupBy(biocharProducts.storageLocationId)
  .as("product_inventory_agg");

  const productDeliveredAggregate = executor
  .select({
    storageLocationId: biocharProducts.storageLocationId,
    totalDeliveredWetKg: sumNumeric(deliveries.deliveredWetMassKg).as(
      "total_delivered_wet_kg",
    ),
    totalDeliveredDryKg: sumNumeric(deliveries.massDryKg).as(
      "total_delivered_dry_kg",
    ),
    unresolvedDeliveredDryCount: countRows(
      and(
        sql`${deliveries.deliveredWetMassKg} > 0`,
        isNull(deliveries.massDryKg),
      ),
    ).as("unresolved_delivered_dry_count"),
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
    ),
  )
  .groupBy(biocharProducts.storageLocationId)
  .as("product_delivered_agg");

  return {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    ingredientConsumptionAggregate,
    biocharOutputAggregate,
    legacyBiocharAllocationAggregate,
    sourceBiocharAllocationAggregate,
    biocharLossAggregate,
    productInventoryAggregate,
    productDeliveredAggregate,
  };
}

interface StorageLocationOptionRow {
  id: string;
  code: string;
  name: string;
  type: StorageLocationType;
  heldFeedstockTypeName: string | null;
  heldFeedstockTypeUsage: string | null;
  feedstockTypeName: string | null;
  formulationName: string | null;
  totalStoredKg: number;
  totalStoredWetKg: number;
  pendingStoredKg: number;
  totalConsumedKg: number;
  totalProducedWetKg: number;
  totalProducedDryKg: number;
  unresolvedProducedDryCount: number;
  totalAllocatedWetKg: number;
  totalAllocatedDryKg: number;
  documentedLossWetKg: number;
  totalProductKg: number;
  totalProductDryKg: number;
  unresolvedProductDryCount: number;
  totalDeliveredWetKg: number;
  totalDeliveredDryKg: number;
  unresolvedDeliveredDryCount: number;
  biocharEquivalentKg: number;
}

export function toStorageLocationEntityOption(
  row: StorageLocationOptionRow,
  stock?: LaneStockDerivation,
): EntityOption {
  let remainingMass: EntityOption["remainingMass"];

  if (row.type === "feedstock_bin") {
    const remainingDryKg =
      stock?.feedstockStockDryKg ?? row.totalStoredKg - row.totalConsumedKg;
    remainingMass = {
      wetKg: estimateRemainingFeedstockWetMassKg({
        intakeDryKg: stock?.feedstockIntakeDryKg ?? row.totalStoredKg,
        intakeWetKg: row.totalStoredWetKg,
        remainingDryKg,
      }),
      dryKg: remainingDryKg,
    };
  } else if (row.type === "biochar_bin") {
    const movementDeltaKg = stock?.biocharMovementDeltaKg ?? 0;
    const dryBasisDiffersFromLane = Boolean(
      stock &&
      (stock.biocharProducedKg !== row.totalProducedWetKg ||
        stock.biocharAllocatedKg !== row.totalAllocatedWetKg),
    );
    remainingMass = {
      wetKg:
        stock?.biocharStockKg ??
        row.totalProducedWetKg -
          row.totalAllocatedWetKg -
          row.documentedLossWetKg,
      dryKg:
        row.unresolvedProducedDryCount > 0 ||
        movementDeltaKg !== 0 ||
        dryBasisDiffersFromLane
          ? null
          : row.totalProducedDryKg - row.totalAllocatedDryKg,
    };
  } else {
    const movementDeltaKg = stock?.productMovementDeltaKg ?? 0;
    remainingMass = {
      wetKg:
        row.totalProductKg - row.totalDeliveredWetKg + movementDeltaKg,
      dryKg:
        row.unresolvedProductDryCount > 0 ||
        row.unresolvedDeliveredDryCount > 0 ||
        movementDeltaKg !== 0
          ? null
          : row.totalProductDryKg - row.totalDeliveredDryKg,
    };
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    remainingMass,
    subtitle: formatStorageLocationSubtitle(
      row.type,
      row.heldFeedstockTypeName ?? row.feedstockTypeName,
      row.heldFeedstockTypeUsage,
      row.totalStoredKg,
      row.pendingStoredKg,
      row.totalConsumedKg,
      row.totalProducedWetKg,
      row.totalProducedDryKg,
      row.unresolvedProducedDryCount,
      row.totalAllocatedWetKg,
      row.totalAllocatedDryKg,
      row.documentedLossWetKg,
      row.totalProductKg,
      row.totalProductDryKg,
      row.unresolvedProductDryCount,
      row.biocharEquivalentKg,
      row.formulationName,
      remainingMass,
    ),
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
    ingredientConsumptionAggregate,
    biocharOutputAggregate,
    legacyBiocharAllocationAggregate,
    sourceBiocharAllocationAggregate,
    biocharLossAggregate,
    productInventoryAggregate,
    productDeliveredAggregate,
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
      totalStoredWetKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredWetKg}, 0)`,
      ),
      pendingStoredKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.pendingStoredKg}, 0)`,
      ),
      totalConsumedKg: numericAggregate(
        sql<number>`
          COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)
          + COALESCE(${ingredientConsumptionAggregate.totalConsumedKg}, 0)
        `,
      ),
      totalProducedWetKg: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.totalProducedWetKg}, 0)`,
      ),
      totalProducedDryKg: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.totalProducedDryKg}, 0)`,
      ),
      unresolvedProducedDryCount: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.unresolvedProducedDryCount}, 0)`,
      ),
      totalAllocatedWetKg: numericAggregate(
        sql<number>`
          COALESCE(${legacyBiocharAllocationAggregate.totalAllocatedWetKg}, 0)
          + COALESCE(${sourceBiocharAllocationAggregate.totalAllocatedWetKg}, 0)
        `,
      ),
      totalAllocatedDryKg: numericAggregate(
        sql<number>`
          COALESCE(${legacyBiocharAllocationAggregate.totalAllocatedDryKg}, 0)
          + COALESCE(${sourceBiocharAllocationAggregate.totalAllocatedDryKg}, 0)
        `,
      ),
      documentedLossWetKg: numericAggregate(
        sql<number>`COALESCE(${biocharLossAggregate.documentedLossWetKg}, 0)`,
      ),
      totalProductKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      ),
      totalProductDryKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.totalProductDryKg}, 0)`,
      ),
      unresolvedProductDryCount: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.unresolvedProductDryCount}, 0)`,
      ),
      totalDeliveredWetKg: numericAggregate(
        sql<number>`COALESCE(${productDeliveredAggregate.totalDeliveredWetKg}, 0)`,
      ),
      totalDeliveredDryKg: numericAggregate(
        sql<number>`COALESCE(${productDeliveredAggregate.totalDeliveredDryKg}, 0)`,
      ),
      unresolvedDeliveredDryCount: numericAggregate(
        sql<number>`COALESCE(${productDeliveredAggregate.unresolvedDeliveredDryCount}, 0)`,
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
      ingredientConsumptionAggregate,
      sql`${storageLocations.id}::text = ${ingredientConsumptionAggregate.storageLocationId}`,
    )
    .leftJoin(
      biocharOutputAggregate,
      eq(storageLocations.id, biocharOutputAggregate.storageLocationId)
    )
    .leftJoin(
      legacyBiocharAllocationAggregate,
      eq(
        storageLocations.id,
        legacyBiocharAllocationAggregate.storageLocationId,
      )
    )
    .leftJoin(
      sourceBiocharAllocationAggregate,
      eq(
        storageLocations.id,
        sourceBiocharAllocationAggregate.storageLocationId,
      )
    )
    .leftJoin(
      biocharLossAggregate,
      eq(
        storageLocations.id,
        biocharLossAggregate.storageLocationId,
      )
    )
    .leftJoin(
      productInventoryAggregate,
      eq(storageLocations.id, productInventoryAggregate.storageLocationId)
    )
    .leftJoin(
      productDeliveredAggregate,
      eq(storageLocations.id, productDeliveredAggregate.storageLocationId),
    )
    .where(whereClause)
    .limit(limit);

  const laneStocks = await deriveLaneStock(ctx, db, {
    storageLocationIds: results.map((result) => result.id),
  });
  const laneStockById = new Map(
    laneStocks.map((stock) => [stock.storageLocationId, stock]),
  );

  return results.map((result) =>
    toStorageLocationEntityOption(result, laneStockById.get(result.id)),
  );
}

export async function getStorageLocationById(
  ctx: OrgContext,
  id: string,
  executor: StorageLocationReadExecutor = db,
): Promise<EntityOption | null> {
  requireOrgScope(ctx);

  const {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    ingredientConsumptionAggregate,
    biocharOutputAggregate,
    legacyBiocharAllocationAggregate,
    sourceBiocharAllocationAggregate,
    biocharLossAggregate,
    productInventoryAggregate,
    productDeliveredAggregate,
  } = buildInventoryAggregates(ctx, executor);

  const [result] = await executor
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
      totalStoredWetKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredWetKg}, 0)`,
      ),
      pendingStoredKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.pendingStoredKg}, 0)`,
      ),
      totalConsumedKg: numericAggregate(
        sql<number>`
          COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)
          + COALESCE(${ingredientConsumptionAggregate.totalConsumedKg}, 0)
        `,
      ),
      totalProducedWetKg: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.totalProducedWetKg}, 0)`,
      ),
      totalProducedDryKg: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.totalProducedDryKg}, 0)`,
      ),
      unresolvedProducedDryCount: numericAggregate(
        sql<number>`COALESCE(${biocharOutputAggregate.unresolvedProducedDryCount}, 0)`,
      ),
      totalAllocatedWetKg: numericAggregate(
        sql<number>`
          COALESCE(${legacyBiocharAllocationAggregate.totalAllocatedWetKg}, 0)
          + COALESCE(${sourceBiocharAllocationAggregate.totalAllocatedWetKg}, 0)
        `,
      ),
      totalAllocatedDryKg: numericAggregate(
        sql<number>`
          COALESCE(${legacyBiocharAllocationAggregate.totalAllocatedDryKg}, 0)
          + COALESCE(${sourceBiocharAllocationAggregate.totalAllocatedDryKg}, 0)
        `,
      ),
      documentedLossWetKg: numericAggregate(
        sql<number>`COALESCE(${biocharLossAggregate.documentedLossWetKg}, 0)`,
      ),
      totalProductKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      ),
      totalProductDryKg: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.totalProductDryKg}, 0)`,
      ),
      unresolvedProductDryCount: numericAggregate(
        sql<number>`COALESCE(${productInventoryAggregate.unresolvedProductDryCount}, 0)`,
      ),
      totalDeliveredWetKg: numericAggregate(
        sql<number>`COALESCE(${productDeliveredAggregate.totalDeliveredWetKg}, 0)`,
      ),
      totalDeliveredDryKg: numericAggregate(
        sql<number>`COALESCE(${productDeliveredAggregate.totalDeliveredDryKg}, 0)`,
      ),
      unresolvedDeliveredDryCount: numericAggregate(
        sql<number>`COALESCE(${productDeliveredAggregate.unresolvedDeliveredDryCount}, 0)`,
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
      ingredientConsumptionAggregate,
      sql`${storageLocations.id}::text = ${ingredientConsumptionAggregate.storageLocationId}`,
    )
    .leftJoin(
      biocharOutputAggregate,
      eq(storageLocations.id, biocharOutputAggregate.storageLocationId)
    )
    .leftJoin(
      legacyBiocharAllocationAggregate,
      eq(
        storageLocations.id,
        legacyBiocharAllocationAggregate.storageLocationId,
      )
    )
    .leftJoin(
      sourceBiocharAllocationAggregate,
      eq(
        storageLocations.id,
        sourceBiocharAllocationAggregate.storageLocationId,
      )
    )
    .leftJoin(
      biocharLossAggregate,
      eq(
        storageLocations.id,
        biocharLossAggregate.storageLocationId,
      )
    )
    .leftJoin(
      productInventoryAggregate,
      eq(storageLocations.id, productInventoryAggregate.storageLocationId)
    )
    .leftJoin(
      productDeliveredAggregate,
      eq(storageLocations.id, productDeliveredAggregate.storageLocationId),
    )
    .where(
      and(
        eq(storageLocations.id, id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  if (!result) return null;

  const [stock] = await deriveLaneStock(ctx, executor, {
    storageLocationIds: [result.id],
  });
  return toStorageLocationEntityOption(result, stock);
}
