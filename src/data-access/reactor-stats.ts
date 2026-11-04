import { db } from "@/db";
import { sumNullableNumeric } from "@/db/aggregate";
import { reactors } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { requireOrgScope } from "./utils";

export interface ReactorStats {
  totalReactors: number;
  totalNominalThroughputTph: number | null;
}

export interface ReactorStatsFilters {
  facilityId?: string;
}

export async function getReactorStats(
  ctx: OrgContext,
  filters?: ReactorStatsFilters,
): Promise<ReactorStats> {
  requireOrgScope(ctx);
  const conditions = [isNull(reactors.archivedAt)];
  if (filters?.facilityId) {
    conditions.push(eq(reactors.facilityId, filters.facilityId));
  }
  const [stats] = await db.select({
    totalReactors: count(),
    totalNominalThroughputTph: sumNullableNumeric(sql`${reactors.nominalThroughputTph}::numeric`),
  })
    .from(reactors)
    .where(and(eq(reactors.organizationId, ctx.organizationId), ...conditions));
  return {
    totalReactors: Number(stats.totalReactors),
    totalNominalThroughputTph: stats.totalNominalThroughputTph,
  };
}
