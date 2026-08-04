/**
 * Order options for searchable entity selection.
 *
 * The subtitle ends with the remaining undelivered quantity: the ordered
 * quantity minus the wet mass of every delivery already recorded against the
 * order — regardless of delivery status, because an 'upcoming' delivery
 * already allocates part of the order even though it hasn't physically left
 * the bin yet (contrast biochar-products.ts, where only 'delivered' rows count
 * because that subtitle tracks physical stock). Fully-delivered orders stay in
 * the list; "0 kg remaining" makes their state visible (issue #197).
 */

import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { countRows, numericAggregate, sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  customers,
  deliveries,
  orders,
  storageLocations,
} from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate } from "@/lib/format-utils";
import {
  formatRecordedMass,
} from "@/lib/mass-moisture";
import { requireOrgScope } from "../utils";
import { fromCompositionMassJsonb } from "@/lib/biochar-composition";
import {
  allocateTrackedDryBiocharKg,
  resolveProductDryBiocharKg,
} from "@/lib/biochar-mass-accounting";
import { buildSourceAllocationAggregate } from "./source-allocation-aggregate";

// Total wet mass already allocated to each order by its (non-archived)
// deliveries, whatever their status.
function buildAllocatedMassAggregate(ctx: OrgContext) {
  return db
  .select({
    orderId: deliveries.orderId,
    totalDeliveredKg: sumNumeric(deliveries.deliveredWetMassKg).as(
      "total_delivered_kg",
    ),
    totalDeliveredDryKg: sumNumeric(deliveries.massDryKg).as(
      "total_delivered_dry_kg",
    ),
    unresolvedDeliveredDryCount: countRows(
      isNull(deliveries.massDryKg),
    ).as("unresolved_delivered_dry_count"),
  })
  .from(deliveries)
  .where(
    and(
      eq(deliveries.organizationId, ctx.organizationId),
      isNull(deliveries.archivedAt),
    ),
  )
  .groupBy(deliveries.orderId)
  .as("allocated_mass_agg");
}

// Product-wide delivery allocations provide the current remaining composition
// basis. This avoids mixing a corrected product wet mass with dry allocations
// that were frozen before the correction.
function buildProductAllocatedMassAggregate(ctx: OrgContext) {
  return db
    .select({
      biocharProductId:
        sql<string>`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`.as(
          "allocated_biochar_product_id",
        ),
      totalAllocatedWetKg: sumNumeric(deliveries.deliveredWetMassKg).as(
        "total_allocated_wet_kg",
      ),
      totalAllocatedDryKg: sumNumeric(deliveries.massDryKg).as(
        "total_allocated_dry_kg",
      ),
      unresolvedAllocatedDryCount: countRows(and(
        sql`${deliveries.deliveredWetMassKg} > 0`,
        isNull(deliveries.massDryKg),
      )).as("unresolved_allocated_dry_count"),
    })
    .from(deliveries)
    .innerJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .where(and(
      eq(deliveries.organizationId, ctx.organizationId),
      isNull(deliveries.archivedAt),
    ))
    .groupBy(
      sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
    )
    .as("product_allocated_mass_agg");
}

function buildSelection(
  allocatedMassAggregate: ReturnType<typeof buildAllocatedMassAggregate>,
  productAllocatedMassAggregate: ReturnType<
    typeof buildProductAllocatedMassAggregate
  >,
  sourceAllocationAggregate: ReturnType<typeof buildSourceAllocationAggregate>,
) {
  return {
    id: orders.id,
    code: orders.code,
    orderDate: orders.orderDate,
    quantityKg: orders.quantityKg,
    customerName: customers.name,
    productBinName: storageLocations.name,
    productMassKg: biocharProducts.massKg,
    productWaterAddedKg: biocharProducts.waterAddedKg,
    productMoisturePercent: biocharProducts.moistureContentPercent,
    productComposition: biocharProducts.composition,
    sourceAllocatedDryMassKg: sourceAllocationAggregate.allocatedDryMassKg,
    totalDeliveredKg: numericAggregate(
      sql<number>`COALESCE(${allocatedMassAggregate.totalDeliveredKg}, 0)`,
    ),
    totalDeliveredDryKg: numericAggregate(
      sql<number>`COALESCE(${allocatedMassAggregate.totalDeliveredDryKg}, 0)`,
    ),
    unresolvedDeliveredDryCount: numericAggregate(
      sql<number>`COALESCE(${allocatedMassAggregate.unresolvedDeliveredDryCount}, 0)`,
    ),
    productAllocatedWetKg: numericAggregate(
      sql<number>`COALESCE(${productAllocatedMassAggregate.totalAllocatedWetKg}, 0)`,
    ),
    productAllocatedDryKg: numericAggregate(
      sql<number>`COALESCE(${productAllocatedMassAggregate.totalAllocatedDryKg}, 0)`,
    ),
    productUnresolvedDryCount: numericAggregate(
      sql<number>`COALESCE(${productAllocatedMassAggregate.unresolvedAllocatedDryCount}, 0)`,
    ),
  };
}

export function toOrderEntityOption(r: {
  id: string;
  code: string;
  orderDate: Date;
  quantityKg: number;
  customerName: string | null;
  productBinName: string | null;
  productMassKg: number | null;
  productWaterAddedKg: number | null;
  productMoisturePercent: number | null;
  productComposition?: unknown;
  sourceAllocatedDryMassKg?: number | null;
  totalDeliveredKg: number;
  totalDeliveredDryKg: number;
  unresolvedDeliveredDryCount: number;
  productAllocatedWetKg: number;
  productAllocatedDryKg: number;
  productUnresolvedDryCount: number;
}): EntityOption {
  const remainingWetKg = Math.max(
    0,
    r.quantityKg - r.totalDeliveredKg,
  );
  const productDryBiocharKg = resolveProductDryBiocharKg({
    sourceAllocatedDryMassKg: r.sourceAllocatedDryMassKg,
    blendMassKg: r.productMassKg,
    biocharMoisturePercent: r.productMoisturePercent,
    ingredients: fromCompositionMassJsonb(r.productComposition),
  });
  const productWetKg = r.productMassKg == null
    ? null
    : r.productMassKg + (r.productWaterAddedKg ?? 0);
  const remainingProductWetKg = productWetKg == null
    ? null
    : Math.max(0, productWetKg - r.productAllocatedWetKg);
  const remainingProductDryKg =
    productDryBiocharKg == null || r.productUnresolvedDryCount > 0
      ? null
      : Math.max(0, productDryBiocharKg - r.productAllocatedDryKg);
  const remainingDryKg =
    r.unresolvedDeliveredDryCount > 0
      ? null
      : allocateTrackedDryBiocharKg({
          totalWetKg: remainingProductWetKg,
          totalDryBiocharKg: remainingProductDryKg,
          requestedWetKg: remainingWetKg,
        });
  return {
    id: r.id,
    code: r.code,
    name: [
      r.customerName,
      r.productBinName,
      formatDate(r.orderDate),
    ]
      .filter(Boolean)
      .join(" · "),
    remainingMass: {
      wetKg: remainingWetKg,
      dryKg: remainingDryKg,
    },
    subtitle: `Wet biochar product: ${formatRecordedMass(
      remainingWetKg,
      "compact",
    )} remaining`,
  };
}

export async function getOrdersEntity(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const allocatedMassAggregate = buildAllocatedMassAggregate(ctx);
  const productAllocatedMassAggregate =
    buildProductAllocatedMassAggregate(ctx);
  const sourceAllocationAggregate = buildSourceAllocationAggregate(ctx);
  const selection = buildSelection(
    allocatedMassAggregate,
    productAllocatedMassAggregate,
    sourceAllocationAggregate,
  );
  const { search, facilityId, limit } = params;
  requireOrgScope(ctx);

  const conditions: SQL[] = [isNull(orders.archivedAt)];

  if (facilityId) {
    conditions.push(eq(orders.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(orders.code, searchPattern),
        ilike(customers.name, searchPattern),
        ilike(biocharProducts.code, searchPattern),
        ilike(storageLocations.name, searchPattern),
      )!
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select(selection)
    .from(orders)
    .leftJoin(
      customers,
      and(
        eq(orders.customerId, customers.id),
        eq(customers.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      biocharProducts,
      and(
        eq(orders.biocharProductId, biocharProducts.id),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      storageLocations,
      and(
        eq(biocharProducts.storageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(allocatedMassAggregate, eq(allocatedMassAggregate.orderId, orders.id))
    .leftJoin(
      productAllocatedMassAggregate,
      eq(
        productAllocatedMassAggregate.biocharProductId,
        biocharProducts.id,
      ),
    )
    .leftJoin(sourceAllocationAggregate, eq(sourceAllocationAggregate.biocharProductId, biocharProducts.id))
    .where(and(eq(orders.organizationId, ctx.organizationId), whereClause))
    .orderBy(desc(orders.orderDate))
    .limit(limit);

  return results.map(toOrderEntityOption);
}

export async function getOrderEntityById(
  ctx: OrgContext,
  id: string
): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const allocatedMassAggregate = buildAllocatedMassAggregate(ctx);
  const productAllocatedMassAggregate =
    buildProductAllocatedMassAggregate(ctx);
  const sourceAllocationAggregate = buildSourceAllocationAggregate(ctx);
  const selection = buildSelection(
    allocatedMassAggregate,
    productAllocatedMassAggregate,
    sourceAllocationAggregate,
  );
  const [result] = await db
    .select(selection)
    .from(orders)
    .leftJoin(
      customers,
      and(
        eq(orders.customerId, customers.id),
        eq(customers.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      biocharProducts,
      and(
        eq(orders.biocharProductId, biocharProducts.id),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      storageLocations,
      and(
        eq(biocharProducts.storageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(allocatedMassAggregate, eq(allocatedMassAggregate.orderId, orders.id))
    .leftJoin(
      productAllocatedMassAggregate,
      eq(
        productAllocatedMassAggregate.biocharProductId,
        biocharProducts.id,
      ),
    )
    .leftJoin(sourceAllocationAggregate, eq(sourceAllocationAggregate.biocharProductId, biocharProducts.id))
    .where(and(eq(orders.id, id), eq(orders.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return toOrderEntityOption(result);
}
