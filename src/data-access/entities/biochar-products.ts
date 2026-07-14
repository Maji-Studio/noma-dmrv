/**
 * Biochar-product options for searchable entity selection.
 *
 * The subtitle shows physically-remaining stock per product batch: the produced
 * wet mass (massKg) minus the wet mass already delivered out of the bin. Only
 * deliveries with status 'delivered' are subtracted — an 'upcoming' delivery has
 * not physically left storage yet. The biocharStorageInventory table is not yet
 * wired into delivery flows, so delivered wet mass is the reliable signal for
 * what has left the bin.
 */

import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, deliveries, formulations, orders } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";


function formatStockSubtitle(massKg: number | null, deliveredKg: number): string {
  const remaining = Math.max(0, (massKg ?? 0) - deliveredKg);
  return `${Math.round(remaining).toLocaleString()} kg in bin`;
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
    totalDeliveredKg:
      sql<number>`COALESCE(SUM(${deliveries.deliveredWetMassKg}), 0)`.as(
        "total_delivered_kg"
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
    code: biocharProducts.code,
    formulationName: formulations.name,
    massKg: biocharProducts.massKg,
    totalDeliveredKg: sql<number>`COALESCE(${deliveredMassAggregate.totalDeliveredKg}, 0)`,
  };
}

function toEntityOption(r: {
  id: string;
  code: string;
  formulationName: string | null;
  massKg: number | null;
  totalDeliveredKg: number;
}): EntityOption {
  return {
    id: r.id,
    code: r.code,
    name: r.formulationName ?? PURE_BIOCHAR_LABEL,
    // Raw SQL aggregates over numeric columns arrive as strings — coerce at the boundary.
    subtitle: formatStockSubtitle(r.massKg, Number(r.totalDeliveredKg)),
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
        ilike(formulations.name, searchPattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select(selection)
    .from(biocharProducts)
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
