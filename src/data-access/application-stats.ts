import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { applications, deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface ApplicationStats {
  totalApplications: number;
  totalBiocharAppliedTons: number;
}

export interface ApplicationStatsFilters {
  facilityId?: string;
}

export async function getApplicationStats(
  ctx: OrgContext,
  filters?: ApplicationStatsFilters,
): Promise<ApplicationStats> {
  requireOrgScope(ctx);
  const conditions = [isNull(deliveries.archivedAt)];
  if (filters?.facilityId) {
    conditions.push(eq(deliveries.facilityId, filters.facilityId));
  }

  const [stats] = await db.select({
    totalApplications: count(),
    totalBiocharAppliedTons: sumNumeric(applications.biocharAppliedTons),
  })
    .from(applications)
    .innerJoin(deliveries, and(
      eq(applications.deliveryId, deliveries.id),
      eq(deliveries.organizationId, ctx.organizationId),
    ))
    .where(and(eq(applications.organizationId, ctx.organizationId), ...conditions));

  return {
    totalApplications: Number(stats.totalApplications),
    totalBiocharAppliedTons: stats.totalBiocharAppliedTons,
  };
}
