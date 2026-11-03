import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { applications, deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface ApplicationStats {
  totalApplications: number;
  /** Wet product applied (biochar plus manure and water). */
  totalBiocharAppliedTons: number;
  /** Dry biochar in that product; the figure the dashboard reports as applied to soil. */
  totalBiocharAppliedDryTons: number;
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
    totalBiocharAppliedDryTons: sumNumeric(applications.biocharAppliedDryTons),
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
    totalBiocharAppliedDryTons: stats.totalBiocharAppliedDryTons,
  };
}
