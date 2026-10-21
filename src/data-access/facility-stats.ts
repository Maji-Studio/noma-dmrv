import { db } from "@/db";
import { facilities, reactors, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

const STORAGE_BIN_TYPES = ["feedstock_bin", "biochar_bin", "product_bin"] as const;

export interface FacilityStats {
  totalFacilities: number;
  totalReactors: number;
  totalStorageBins: number;
}

export interface FacilityStatsFilters {
  archived?: boolean;
}

export async function getFacilityStats(
  ctx: OrgContext,
  filters?: FacilityStatsFilters,
): Promise<FacilityStats> {
  requireOrgScope(ctx);
  const facilityArchiveFilter = filters?.archived
    ? isNotNull(facilities.archivedAt)
    : isNull(facilities.archivedAt);
  const [[facilityStats], [reactorStats], [storageStats]] = await Promise.all([
    db.select({ totalFacilities: count() })
      .from(facilities)
      .where(and(eq(facilities.organizationId, ctx.organizationId), facilityArchiveFilter)),
    db.select({ totalReactors: count() })
      .from(reactors)
      .innerJoin(facilities, and(
        eq(reactors.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ))
      .where(and(
        eq(reactors.organizationId, ctx.organizationId),
        isNull(reactors.archivedAt),
        facilityArchiveFilter,
      )),
    db.select({ totalStorageBins: count() })
      .from(storageLocations)
      .innerJoin(facilities, and(
        eq(storageLocations.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ))
      .where(and(
        eq(storageLocations.organizationId, ctx.organizationId),
        inArray(storageLocations.type, STORAGE_BIN_TYPES),
        // getFacilities counts bins in every archive state for the selected facilities.
        facilityArchiveFilter,
      )),
  ]);
  return {
    totalFacilities: Number(facilityStats.totalFacilities),
    totalReactors: Number(reactorStats.totalReactors),
    totalStorageBins: Number(storageStats.totalStorageBins),
  };
}
