/**
 * Product-bin options for the order form's searchable entity selection.
 *
 * The selected id remains the exact biochar-product batch id required by order
 * traceability and delivery stock guards, while the operator-facing identity is
 * the product bin that physically holds that batch. The subtitle disambiguates
 * multiple batches in one bin and shows physically remaining stock.
 */

import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { numericAggregate, sumNumeric } from "@/db/aggregate";
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


function formatStockSubtitle(
  productCode: string,
  formulationName: string | null,
  massKg: number | null,
  deliveredKg: number,
): string {
  const remaining = Math.max(0, (massKg ?? 0) - deliveredKg);
  const productLabel = formulationName ?? PURE_BIOCHAR_LABEL;
  return `${productLabel} · ${Math.round(remaining).toLocaleString()} kg available · batch ${productCode}`;
}

// Total delivered wet mass per product batch. A delivery's product is its own
// override when set, otherwise the linked order's product. Only 'delivered' rows
// have physically left the bin.
function buildDeliveredMassAggregate(ctx: OrgContext) {
  return db
  .select({
    biocharProductId:
      sql<string>`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`.as(
        "biochar_product_id"
      ),
    totalDeliveredKg: sumNumeric(deliveries.deliveredWetMassKg).as(
      "total_delivered_kg",
    ),
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
    ),
  )
  .groupBy(sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`)
  .as("delivered_mass_agg");
}

function buildSelection(
  deliveredMassAggregate: ReturnType<typeof buildDeliveredMassAggregate>,
) {
  return {
    id: biocharProducts.id,
    code: storageLocations.code,
    name: storageLocations.name,
    productCode: biocharProducts.code,
    formulationName: formulations.name,
    massKg: biocharProducts.massKg,
    totalDeliveredKg: numericAggregate(
      sql<number>`COALESCE(${deliveredMassAggregate.totalDeliveredKg}, 0)`,
    ),
  };
}

function toEntityOption(r: {
  id: string;
  code: string | null;
  name: string | null;
  productCode: string;
  formulationName: string | null;
  massKg: number | null;
  totalDeliveredKg: number;
}): EntityOption {
  return {
    id: r.id,
    code: r.code ?? r.productCode,
    name: r.name ?? r.productCode,
    subtitle: formatStockSubtitle(
      r.productCode,
      r.formulationName,
      r.massKg,
      r.totalDeliveredKg,
    ),
  };
}

export async function getBiocharProducts(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const deliveredMassAggregate = buildDeliveredMassAggregate(ctx);
  const selection = buildSelection(deliveredMassAggregate);
  const { search, facilityId, limit } = params;
  requireOrgScope(ctx);

  const conditions: SQL[] = [isNull(biocharProducts.archivedAt)];

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
    .innerJoin(
      storageLocations,
      and(
        eq(biocharProducts.storageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
        eq(storageLocations.type, "product_bin"),
        isNull(storageLocations.archivedAt),
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
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), whereClause))
    .orderBy(desc(biocharProducts.productionDate))
    .limit(limit);

  return results.map(toEntityOption);
}

export async function getBiocharProductEntityById(
  ctx: OrgContext,
  id: string
): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const deliveredMassAggregate = buildDeliveredMassAggregate(ctx);
  const selection = buildSelection(deliveredMassAggregate);
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
    .where(and(eq(biocharProducts.id, id), eq(biocharProducts.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return toEntityOption(result);
}
