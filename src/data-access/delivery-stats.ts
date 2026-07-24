import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { deliveries, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { inCreditBatchLineage } from "./credit-batch-lineage-filter";
import {
  activeDeliveriesCondition,
  getDeliveryColumnAvailability,
} from "./deliveries";
import { requireOrgScope } from "./utils";

export interface DeliveryStats {
  totalDeliveries: number;
  totalDeliveredWetMassKg: number;
  totalMassDryKg: number;
  upcomingCount: number;
  deliveredCount: number;
}

export interface DeliveryStatsFilters {
  facilityId?: string;
  creditBatchId?: string;
  fromDate?: Date;
  toDate?: Date;
}

export async function getDeliveryStats(
  ctx: OrgContext,
  filters?: DeliveryStatsFilters,
): Promise<DeliveryStats> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();
  const conditions = [
    eq(deliveries.organizationId, ctx.organizationId),
    ...activeDeliveriesCondition(deliveryColumns),
  ];

  if (filters?.facilityId) {
    conditions.push(eq(deliveries.facilityId, filters.facilityId));
  }
  if (filters?.creditBatchId) {
    conditions.push(
      inCreditBatchLineage(
        ctx,
        filters.creditBatchId,
        sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
      ),
    );
  }
  if (filters?.fromDate) {
    conditions.push(gte(deliveries.deliveryDate, filters.fromDate));
  }
  if (filters?.toDate) {
    conditions.push(lte(deliveries.deliveryDate, filters.toDate));
  }

  const whereClause = and(...conditions);
  const baseQuery = db
    .select({
      totalDeliveries: count(),
      totalDeliveredWetMassKg: sumNumeric(
        deliveries.deliveredWetMassKg,
        eq(deliveries.status, "delivered"),
      ),
      totalMassDryKg: sumNumeric(
        deliveries.massDryKg,
        eq(deliveries.status, "delivered"),
      ),
    })
    .from(deliveries)
    .leftJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause);
  const statusQuery = db
    .select({ status: deliveries.status, count: count() })
    .from(deliveries)
    .leftJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause)
    .groupBy(deliveries.status);
  const [[stats], statusCounts] = await Promise.all([baseQuery, statusQuery]);
  const statusCountMap = new Map(
    statusCounts.map((row) => [row.status, Number(row.count)]),
  );

  return {
    totalDeliveries: Number(stats.totalDeliveries),
    totalDeliveredWetMassKg: stats.totalDeliveredWetMassKg || 0,
    totalMassDryKg: stats.totalMassDryKg || 0,
    upcomingCount: statusCountMap.get("upcoming") ?? 0,
    deliveredCount: statusCountMap.get("delivered") ?? 0,
  };
}
