import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierProjects,
  creditBatches,
  facilities,
  feedstocks,
  productionRuns,
  reactors,
  suppliers,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgFacility, requireOrgScope } from "./utils";

const COMPLETE_PRODUCTION_RUN_STATUS = "complete";

export interface OnboardingStatus {
  isOwnerOrAdmin: boolean;
  facilityCount: number;
  supplierCount: number;
  facility: null | {
    reactorCount: number;
    registryConnected: boolean;
    feedstockCount: number;
    completeProductionRunCount: number;
    creditBatchCount: number;
  };
}

export async function getOnboardingStatus(
  ctx: OrgContext,
  facilityId: string | null,
): Promise<OnboardingStatus> {
  requireOrgScope(ctx);

  const isOwnerOrAdmin =
    ctx.isPlatformAdmin ||
    ctx.orgRole === "owner" ||
    ctx.orgRole === "admin";

  if (facilityId === null) {
    const [[facilityCount], [supplierCount]] = await Promise.all([
      db
        .select({ count: count() })
        .from(facilities)
        .where(eq(facilities.organizationId, ctx.organizationId)),
      db
        .select({ count: count() })
        .from(suppliers)
        .where(eq(suppliers.organizationId, ctx.organizationId)),
    ]);

    return {
      isOwnerOrAdmin,
      facilityCount: Number(facilityCount.count),
      supplierCount: Number(supplierCount.count),
      facility: null,
    };
  }

  await requireOrgFacility(ctx, facilityId);

  const [
    [facilityCount],
    [supplierCount],
    [reactorCount],
    [certifierProjectCount],
    [feedstockCount],
    [completeProductionRunCount],
    [creditBatchCount],
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(facilities)
      .where(eq(facilities.organizationId, ctx.organizationId)),
    db
      .select({ count: count() })
      .from(suppliers)
      .where(eq(suppliers.organizationId, ctx.organizationId)),
    db
      .select({ count: count() })
      .from(reactors)
      .where(
        and(
          eq(reactors.organizationId, ctx.organizationId),
          eq(reactors.facilityId, facilityId),
        ),
      ),
    db
      .select({ count: count() })
      .from(certifierProjects)
      .where(
        and(
          eq(certifierProjects.organizationId, ctx.organizationId),
          eq(certifierProjects.facilityId, facilityId),
        ),
      ),
    db
      .select({ count: count() })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.organizationId, ctx.organizationId),
          eq(feedstocks.facilityId, facilityId),
        ),
      ),
    db
      .select({ count: count() })
      .from(productionRuns)
      .where(
        and(
          eq(productionRuns.organizationId, ctx.organizationId),
          eq(productionRuns.facilityId, facilityId),
          eq(productionRuns.status, COMPLETE_PRODUCTION_RUN_STATUS),
        ),
      ),
    db
      .select({ count: count() })
      .from(creditBatches)
      .where(
        and(
          eq(creditBatches.organizationId, ctx.organizationId),
          eq(creditBatches.facilityId, facilityId),
        ),
      ),
  ]);

  return {
    isOwnerOrAdmin,
    facilityCount: Number(facilityCount.count),
    supplierCount: Number(supplierCount.count),
    facility: {
      reactorCount: Number(reactorCount.count),
      registryConnected: Number(certifierProjectCount.count) > 0,
      feedstockCount: Number(feedstockCount.count),
      completeProductionRunCount: Number(completeProductionRunCount.count),
      creditBatchCount: Number(creditBatchCount.count),
    },
  };
}
