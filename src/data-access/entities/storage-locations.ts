import { getIngredientMoistureBasis } from '../ingredient-moisture-basis';
import { getOutputBinStocks, getOutputBinStockView, type OutputBinStock } from '../output-stock';
/** Storage-location options with live inventory subtitles. */

import type { EntityOption } from "@/components/forms/entity-select/types";
import { db } from "@/db";
import { numericAggregate, sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  feedstocks,
  feedstockTypes,
  productionRunFeedstockDraws,
  productionRuns,
  storageLocations
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatWetDryStock } from "@/lib/mass-moisture";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import {
  formatStorageLocationType,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import {
  and,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  deriveLaneStock,
  type LaneStockDerivation,
} from "../lane-stock-derivation";
import { requireOrgScope } from "../utils";


/** Bin option subtitle, in the words of the selected bin's caption: "≈ 277 kg wet, 249.6 kg dry biochar". */
function outputBinStockSubtitle(stock: { estimatedWetMassKg: number | null; dryMassKg: number | null }): string {
  return formatWetDryStock({
    wetKg: stock.estimatedWetMassKg,
    dryKg: stock.dryMassKg,
    estimatedWet: true,
  });
}
/** Feedstock bin option subtitle: type, held feedstock, wet stock, pending intake. */
function formatFeedstockBinSubtitle(
  feedstockTypeName: string | null,
  feedstockTypeUsage: string | null,
  onHandWetKg: number,
  pendingStoredWetKg: number,
): string {
  const typeLabel = formatStorageLocationType("feedstock_bin");
  if (!feedstockTypeName && onHandWetKg === 0) {
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
  parts.push(`${Math.round(onHandWetKg).toLocaleString()} kg stored`);
  if (pendingStoredWetKg > 0) {
    parts.push(
      `${Math.round(pendingStoredWetKg).toLocaleString()} kg pending intake (wet)`,
    );
  }
  return parts.join(" · ");
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
    totalStoredWetKg: sumNumeric(
      feedstocks.massWetKg,
      sql`${feedstocks.status} = 'complete'`,
    ).as("total_stored_wet_kg"),
    pendingStoredWetKg: sumNumeric(
      feedstocks.massWetKg,
      sql`${feedstocks.status} = 'missing_data'`,
    ).as("pending_stored_wet_kg"),
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
    storageLocationId: productionRunFeedstockDraws.storageLocationId,
    totalConsumedKg: sumNumeric(productionRunFeedstockDraws.wetMassKg).as(
      "total_consumed_kg",
    ),
  })
  .from(productionRunFeedstockDraws)
  .innerJoin(
    productionRuns,
    and(
      eq(productionRunFeedstockDraws.productionRunId, productionRuns.id),
      eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
    ),
  )
  .where(and(
    eq(productionRuns.organizationId, ctx.organizationId),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  ))
  .groupBy(productionRunFeedstockDraws.storageLocationId)
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
            WHEN jsonb_typeof(ingredient.value -> 'massKg') = 'number'
              AND (ingredient.value ->> 'massKg')::numeric > 0
            THEN (ingredient.value ->> 'massKg')::numeric
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

  return {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    ingredientConsumptionAggregate,
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
  totalStoredWetKg: number;
  pendingStoredWetKg: number;
  totalConsumedKg: number;
}

export function toFeedstockBinEntityOption(
  row: StorageLocationOptionRow,
  stock?: LaneStockDerivation,
): EntityOption {
  const remainingMass = {
    wetKg:
      stock?.feedstockStockWetKg ??
      row.totalStoredWetKg - row.totalConsumedKg,
    dryKg: stock?.feedstockEstimatedDryKg ?? null,
  };
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    remainingMass,
    subtitle: formatFeedstockBinSubtitle(
      row.heldFeedstockTypeName ?? row.feedstockTypeName,
      row.heldFeedstockTypeUsage,
      remainingMass.wetKg,
      row.pendingStoredWetKg,
    ),
  };
}

/** Output bins read their stock from the dry-biochar FIFO layers only. */
/** A bin missing from a batch read has no stock to show, like an unresolved one. */
function outputStockView(stock: OutputBinStock | undefined) {
  return { estimatedWetMassKg: stock?.estimatedWetMassKg ?? null, dryMassKg: stock?.availableDryKg ?? null };
}

function toOutputBinEntityOption(
  row: Pick<StorageLocationOptionRow, "id" | "code" | "name">,
  stock: { estimatedWetMassKg: number | null; dryMassKg: number | null },
): EntityOption {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    remainingMass: { wetKg: stock.estimatedWetMassKg, dryKg: stock.dryMassKg },
    subtitle: outputBinStockSubtitle(stock),
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
      totalStoredWetKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredWetKg}, 0)`,
      ),
      pendingStoredWetKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.pendingStoredWetKg}, 0)`,
      ),
      totalConsumedKg: numericAggregate(
        sql<number>`
          COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)
          + COALESCE(${ingredientConsumptionAggregate.totalConsumedKg}, 0)
        `,
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
    .where(whereClause)
    .limit(limit);

  const laneStocks = await deriveLaneStock(ctx, db, {
    storageLocationIds: results.map((result) => result.id),
    lanes: "feedstock",
  });
  const laneStockById = new Map(
    laneStocks.map((stock) => [stock.storageLocationId, stock]),
  );

  const outputStocks = await getOutputBinStocks(ctx, results.filter(result => result.type !== 'feedstock_bin').map(result => result.id));
  return Promise.all(results.map(async result => {
    if (result.type !== 'feedstock_bin') return toOutputBinEntityOption(result, outputStockView(outputStocks.get(result.id)));
    const option = toFeedstockBinEntityOption(result, laneStockById.get(result.id));
    return { ...option, mass: { moisturePercent: (await getIngredientMoistureBasis(ctx, result.id))?.moisturePercent ?? null } };
  }));
}

export async function getStorageLocationById(
  ctx: OrgContext,
  id: string,
  executor: StorageLocationReadExecutor = db,
  occurredAt?: string,
): Promise<EntityOption | null> {
  requireOrgScope(ctx);

  const {
    feedstockInventoryAggregate,
    productionRunConsumptionAggregate,
    ingredientConsumptionAggregate,
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
      totalStoredWetKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredWetKg}, 0)`,
      ),
      pendingStoredWetKg: numericAggregate(
        sql<number>`COALESCE(${feedstockInventoryAggregate.pendingStoredWetKg}, 0)`,
      ),
      totalConsumedKg: numericAggregate(
        sql<number>`
          COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)
          + COALESCE(${ingredientConsumptionAggregate.totalConsumedKg}, 0)
        `,
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
    .where(
      and(
        eq(storageLocations.id, id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  if (!result) return null;

  if (result.type !== 'feedstock_bin') return toOutputBinEntityOption(result, await getOutputBinStockView(ctx, result.id, executor));
  const [stock] = await deriveLaneStock(ctx, executor, {
    storageLocationIds: [result.id],
    lanes: "feedstock",
  });
  const option = toFeedstockBinEntityOption(result, stock);
  return { ...option, mass: { moisturePercent: (await getIngredientMoistureBasis(ctx, result.id, occurredAt, executor))?.moisturePercent ?? null } };
}
