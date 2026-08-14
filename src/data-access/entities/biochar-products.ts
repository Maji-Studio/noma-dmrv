/**
 * Product-bin options for the order form's searchable entity selection.
 *
 * The selected id remains the exact biochar-product batch id required by order
 * traceability and delivery stock guards, while the operator-facing identity is
 * the product bin that physically holds that batch. The subtitle disambiguates
 * multiple batches in one bin and shows physically remaining stock.
 */

import { and, desc, eq, gt, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { countRows, numericAggregate, sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  deliveries,
  formulations,
  orders,
  storageLocations,
} from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import {
  deriveEffectiveMoisturePercent,
  formatWetDryMass,
} from "@/lib/mass-moisture";
import { fromCompositionMassJsonb } from "@/lib/biochar-composition";
import { resolveProductDryBiocharKg } from "@/lib/biochar-mass-accounting";
import { sourceBiocharMassKgSql } from "../biochar-product-source-mass";
import { buildSourceAllocationAggregate } from "./source-allocation-aggregate";

function remainingSourceBiocharDryMassKg(
  productDryKg: number | null,
  deliveredDryKg: number,
  unresolvedDeliveredDryCount: number,
): number | null {
  if (productDryKg == null) return null;
  if (unresolvedDeliveredDryCount > 0) return null;
  return Math.max(0, productDryKg - deliveredDryKg);
}

function formatStockSubtitle(
  massKg: number | null,
  waterAddedKg: number | null,
  moisturePercent: number | null,
  composition: unknown,
  deliveredWetKg: number,
  deliveredDryKg: number,
  unresolvedDeliveredDryCount: number,
  sourceAllocatedDryMassKg?: number | null,
): string {
  const remainingWetKg =
    (massKg ?? 0) + (waterAddedKg ?? 0) - deliveredWetKg;
  const productDryKg = resolveProductDryBiocharKg({
    sourceAllocatedDryMassKg,
    blendMassKg: massKg,
    biocharMoisturePercent: moisturePercent,
    ingredients: fromCompositionMassJsonb(composition),
  });
  const remainingDryKg = remainingSourceBiocharDryMassKg(
    productDryKg,
    deliveredDryKg,
    unresolvedDeliveredDryCount,
  );
  return `${formatWetDryMass({
    wetKg: remainingWetKg,
    dryKg: remainingDryKg,
    wetLabel: "Wet biochar product",
    dryLabel: "Dry biochar",
    separator: " | ",
    unitSpacing: "compact",
  })} available`;
}

// Total delivered wet mass per product batch. A delivery's product is its own
// override when set, otherwise the linked order's product. Only 'delivered' rows
// have physically left the bin. `excludeOrderId` nets out one order's own
// deliveries so an edit form's "remaining" means "available to other demand"
// — without it the order being edited reads its own fulfilment as competing
// consumption (DR-002 / OR-26-001).
function buildDeliveredMassAggregate(
  ctx: OrgContext,
  opts: { excludeOrderId?: string } = {},
) {
  return db
  .select({
    biocharProductId:
      sql<string>`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`.as(
        "biochar_product_id"
      ),
    totalDeliveredKg: sumNumeric(deliveries.deliveredWetMassKg).as(
      "total_delivered_kg",
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
  .where(
    and(
      eq(deliveries.status, "delivered"),
      eq(deliveries.organizationId, ctx.organizationId),
      ...(opts.excludeOrderId
        ? [ne(deliveries.orderId, opts.excludeOrderId)]
        : []),
    ),
  )
  .groupBy(sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`)
  .as("delivered_mass_agg");
}

function buildSelection(
  deliveredMassAggregate: ReturnType<typeof buildDeliveredMassAggregate>,
  sourceAllocationAggregate: ReturnType<typeof buildSourceAllocationAggregate>,
) {
  return {
    id: biocharProducts.id,
    code: storageLocations.code,
    name: storageLocations.name,
    productCode: biocharProducts.code,
    formulationName: formulations.name,
    massKg: biocharProducts.massKg,
    waterAddedKg: biocharProducts.waterAddedKg,
    moisturePercent: biocharProducts.moistureContentPercent,
    composition: biocharProducts.composition,
    sourceAllocatedDryMassKg: sourceAllocationAggregate.allocatedDryMassKg,
    totalDeliveredKg: numericAggregate(
      sql<number>`COALESCE(${deliveredMassAggregate.totalDeliveredKg}, 0)`,
    ),
    totalDeliveredDryKg: numericAggregate(
      sql<number>`COALESCE(${deliveredMassAggregate.totalDeliveredDryKg}, 0)`,
    ),
    unresolvedDeliveredDryCount: numericAggregate(
      sql<number>`COALESCE(${deliveredMassAggregate.unresolvedDeliveredDryCount}, 0)`,
    ),
  };
}

export function toBiocharProductEntityOption(r: {
  id: string;
  code: string | null;
  name: string | null;
  productCode: string;
  formulationName: string | null;
  massKg: number | null;
  waterAddedKg: number | null;
  moisturePercent: number | null;
  composition?: unknown;
  totalDeliveredKg: number;
  totalDeliveredDryKg: number;
  unresolvedDeliveredDryCount: number;
  sourceAllocatedDryMassKg?: number | null;
}): EntityOption {
  const productLabel = r.formulationName ?? PURE_BIOCHAR_LABEL;
  const remainingWetKg =
    (r.massKg ?? 0) + (r.waterAddedKg ?? 0) - r.totalDeliveredKg;
  const productDryKg = resolveProductDryBiocharKg({
    sourceAllocatedDryMassKg: r.sourceAllocatedDryMassKg,
    blendMassKg: r.massKg,
    biocharMoisturePercent: r.moisturePercent,
    ingredients: fromCompositionMassJsonb(r.composition),
  });
  const remainingDryKg = remainingSourceBiocharDryMassKg(
    productDryKg,
    r.totalDeliveredDryKg,
    r.unresolvedDeliveredDryCount,
  );

  return {
    id: r.id,
    code: r.code ?? r.productCode,
    name: r.name ? `${r.name} • ${productLabel}` : productLabel,
    mass: {
      moisturePercent: deriveEffectiveMoisturePercent(
        r.massKg,
        r.moisturePercent,
        r.waterAddedKg,
      ),
    },
    remainingMass: {
      wetKg: remainingWetKg,
      dryKg: remainingDryKg,
    },
    subtitle: formatStockSubtitle(
      r.massKg,
      r.waterAddedKg,
      r.moisturePercent,
      r.composition,
      r.totalDeliveredKg,
      r.totalDeliveredDryKg,
      r.unresolvedDeliveredDryCount,
      r.sourceAllocatedDryMassKg,
    ),
  };
}

export async function getBiocharProducts(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  excludeOrderId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const deliveredMassAggregate = buildDeliveredMassAggregate(ctx, {
    excludeOrderId: params.excludeOrderId,
  });
  const sourceAllocationAggregate = buildSourceAllocationAggregate(ctx);
  const selection = buildSelection(deliveredMassAggregate, sourceAllocationAggregate);
  const { search, facilityId, limit } = params;
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    isNull(biocharProducts.archivedAt),
    gt(
      sourceBiocharMassKgSql(
        biocharProducts.massKg,
        biocharProducts.composition,
      ),
      0,
    ),
    // Bin-less (legacy/partial) products stay orderable via their
    // product-code fallback; products whose bin is archived or not a
    // product bin stay hidden.
    or(
      isNull(biocharProducts.storageLocationId),
      and(
        eq(storageLocations.type, "product_bin"),
        isNull(storageLocations.archivedAt),
      ),
    )!,
  ];

  if (facilityId) {
    conditions.push(eq(biocharProducts.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(biocharProducts.code, searchPattern),
        ilike(formulations.name, searchPattern),
        ilike(storageLocations.code, searchPattern),
        ilike(storageLocations.name, searchPattern),
      )!
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select(selection)
    .from(biocharProducts)
    .leftJoin(
      storageLocations,
      and(
        eq(biocharProducts.storageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(biocharProducts.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      deliveredMassAggregate,
      eq(deliveredMassAggregate.biocharProductId, biocharProducts.id)
    )
    .leftJoin(
      sourceAllocationAggregate,
      eq(sourceAllocationAggregate.biocharProductId, biocharProducts.id),
    )
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), whereClause))
    .orderBy(desc(biocharProducts.productionDate))
    .limit(limit);

  return results.map(toBiocharProductEntityOption);
}

export async function getBiocharProductEntityById(
  ctx: OrgContext,
  id: string,
  opts: { excludeOrderId?: string } = {},
): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const deliveredMassAggregate = buildDeliveredMassAggregate(ctx, {
    excludeOrderId: opts.excludeOrderId,
  });
  const sourceAllocationAggregate = buildSourceAllocationAggregate(ctx);
  const selection = buildSelection(deliveredMassAggregate, sourceAllocationAggregate);
  const [result] = await db
    .select(selection)
    .from(biocharProducts)
    .leftJoin(
      storageLocations,
      and(
        eq(biocharProducts.storageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(biocharProducts.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      deliveredMassAggregate,
      eq(deliveredMassAggregate.biocharProductId, biocharProducts.id)
    )
    .leftJoin(
      sourceAllocationAggregate,
      eq(sourceAllocationAggregate.biocharProductId, biocharProducts.id),
    )
    .where(and(eq(biocharProducts.id, id), eq(biocharProducts.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return toBiocharProductEntityOption(result);
}
