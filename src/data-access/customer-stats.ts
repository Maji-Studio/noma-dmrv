import { db } from "@/db";
import { customerLocations, customers } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface CustomerStats {
  totalCustomers: number;
  totalLocations: number;
}

export interface CustomerStatsFilters {
  archived?: boolean;
}

export async function getCustomerStats(
  ctx: OrgContext,
  filters?: CustomerStatsFilters,
): Promise<CustomerStats> {
  requireOrgScope(ctx);
  const archivedCondition = filters?.archived
    ? isNotNull(customers.archivedAt)
    : isNull(customers.archivedAt);

  const [[customerStats], [locationStats]] = await Promise.all([
    db.select({ totalCustomers: count() })
      .from(customers)
      .where(and(eq(customers.organizationId, ctx.organizationId), archivedCondition)),
    db.select({ totalLocations: count() })
      .from(customerLocations)
      .innerJoin(customers, and(
        eq(customerLocations.customerId, customers.id),
        eq(customers.organizationId, ctx.organizationId),
      ))
      .where(and(
        eq(customerLocations.organizationId, ctx.organizationId),
        isNull(customerLocations.archivedAt),
        archivedCondition,
      )),
  ]);

  return {
    totalCustomers: Number(customerStats.totalCustomers),
    totalLocations: Number(locationStats.totalLocations),
  };
}
