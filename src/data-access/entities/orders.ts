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
import { numericAggregate, sumNumeric } from "@/db/aggregate";
import { biocharProducts, customers, deliveries, orders } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { formatLocalDate } from "@/lib/date-utils";


// Deterministic integer formatting — pin the locale so the label can't vary
// with the server's locale (same rationale as production-runs.ts).
const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

// Total wet mass already allocated to each order by its (non-archived)
// deliveries, whatever their status.
function buildAllocatedMassAggregate(ctx: OrgContext) {
  return db
  .select({
    orderId: deliveries.orderId,
    totalDeliveredKg: sumNumeric(deliveries.deliveredWetMassKg).as(
      "total_delivered_kg",
    ),
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

function buildSelection(
  allocatedMassAggregate: ReturnType<typeof buildAllocatedMassAggregate>,
) {
  return {
    id: orders.id,
    code: orders.code,
    orderDate: orders.orderDate,
    quantityKg: orders.quantityKg,
    customerName: customers.name,
    biocharProductCode: biocharProducts.code,
    totalDeliveredKg: numericAggregate(
      sql<number>`COALESCE(${allocatedMassAggregate.totalDeliveredKg}, 0)`,
    ),
  };
}

function toEntityOption(r: {
  id: string;
  code: string;
  orderDate: Date;
  quantityKg: number;
  customerName: string | null;
  biocharProductCode: string | null;
  totalDeliveredKg: number;
}): EntityOption {
  const remainingKg = Math.max(0, r.quantityKg - r.totalDeliveredKg);
  return {
    id: r.id,
    code: r.code,
    name: r.code,
    subtitle: [
      r.customerName,
      r.biocharProductCode,
      formatLocalDate(r.orderDate),
      `${INTEGER_FORMATTER.format(Math.round(remainingKg))} kg remaining`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export async function getOrdersEntity(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const allocatedMassAggregate = buildAllocatedMassAggregate(ctx);
  const selection = buildSelection(allocatedMassAggregate);
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
        ilike(biocharProducts.code, searchPattern)
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
    .leftJoin(allocatedMassAggregate, eq(allocatedMassAggregate.orderId, orders.id))
    .where(and(eq(orders.organizationId, ctx.organizationId), whereClause))
    .orderBy(desc(orders.orderDate))
    .limit(limit);

  return results.map(toEntityOption);
}

export async function getOrderEntityById(
  ctx: OrgContext,
  id: string
): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const allocatedMassAggregate = buildAllocatedMassAggregate(ctx);
  const selection = buildSelection(allocatedMassAggregate);
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
    .leftJoin(allocatedMassAggregate, eq(allocatedMassAggregate.orderId, orders.id))
    .where(and(eq(orders.id, id), eq(orders.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return toEntityOption(result);
}
