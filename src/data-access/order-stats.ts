import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { deliveries, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface OrderStats {
  totalOrders: number;
  totalDeliveries: number;
  totalQuantityKg: number;
}

export interface OrderStatsFilters {
  facilityId?: string;
}

export async function getOrderStats(
  ctx: OrgContext,
  filters?: OrderStatsFilters,
): Promise<OrderStats> {
  requireOrgScope(ctx);
  const conditions = [isNull(orders.archivedAt)];
  if (filters?.facilityId) {
    conditions.push(eq(orders.facilityId, filters.facilityId));
  }

  const [[orderStats], [deliveryStats]] = await Promise.all([
    db.select({
      totalOrders: count(),
      totalQuantityKg: sumNumeric(orders.quantityKg),
    })
      .from(orders)
      .where(and(eq(orders.organizationId, ctx.organizationId), ...conditions)),
    db.select({ totalDeliveries: count() })
      .from(deliveries)
      .innerJoin(orders, and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ))
      .where(and(
        ...conditions,
        eq(deliveries.organizationId, ctx.organizationId),
        isNull(deliveries.archivedAt),
      )),
  ]);

  return {
    totalOrders: Number(orderStats.totalOrders),
    totalDeliveries: Number(deliveryStats.totalDeliveries),
    totalQuantityKg: orderStats.totalQuantityKg,
  };
}
