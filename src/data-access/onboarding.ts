import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { countRows } from "@/db/aggregate";
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
  /**
   * True only for a real org membership of owner/admin rank — excludes the
   * platform-admin fallback. The wizard auto-opens only for these users; a
   * platform admin browsing a fresh org gets the guide, not a modal.
   */
  isOrgOwnerOrAdmin: boolean;
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

/** One-row aggregate subqueries, cross joined so every count is one round trip. */
function orgCountAggregates(organizationId: string) {
  return {
    facilityAgg: db
      .select({ count: countRows().as("facility_count") })
      .from(facilities)
      .where(
        and(
          eq(facilities.organizationId, organizationId),
          isNull(facilities.archivedAt),
        ),
      )
      .as("facility_agg"),
    supplierAgg: db
      .select({ count: countRows().as("supplier_count") })
      .from(suppliers)
      .where(eq(suppliers.organizationId, organizationId))
      .as("supplier_agg"),
  };
}

export async function getOnboardingStatus(
  ctx: OrgContext,
  facilityId: string | null,
): Promise<OnboardingStatus> {
  requireOrgScope(ctx);

  const isOrgOwnerOrAdmin =
    ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const isOwnerOrAdmin = ctx.isPlatformAdmin || isOrgOwnerOrAdmin;
  const orgId = ctx.organizationId;
  const { facilityAgg, supplierAgg } = orgCountAggregates(orgId);

  if (facilityId === null) {
    const [row] = await db
      .select({
        facilityCount: facilityAgg.count,
        supplierCount: supplierAgg.count,
      })
      .from(facilityAgg)
      .crossJoin(supplierAgg);

    return {
      isOwnerOrAdmin,
      isOrgOwnerOrAdmin,
      facilityCount: row?.facilityCount ?? 0,
      supplierCount: row?.supplierCount ?? 0,
      facility: null,
    };
  }

  const reactorAgg = db
    .select({ count: countRows().as("reactor_count") })
    .from(reactors)
    .where(
      and(
        eq(reactors.organizationId, orgId),
        eq(reactors.facilityId, facilityId),
        isNull(reactors.archivedAt),
      ),
    )
    .as("reactor_agg");
  const projectAgg = db
    .select({ count: countRows().as("certifier_project_count") })
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.organizationId, orgId),
        eq(certifierProjects.facilityId, facilityId),
      ),
    )
    .as("project_agg");
  const feedstockAgg = db
    .select({ count: countRows().as("feedstock_count") })
    .from(feedstocks)
    .where(
      and(
        eq(feedstocks.organizationId, orgId),
        eq(feedstocks.facilityId, facilityId),
        isNull(feedstocks.archivedAt),
      ),
    )
    .as("feedstock_agg");
  const runAgg = db
    .select({ count: countRows().as("complete_run_count") })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.organizationId, orgId),
        eq(productionRuns.facilityId, facilityId),
        eq(productionRuns.status, COMPLETE_PRODUCTION_RUN_STATUS),
        isNull(productionRuns.archivedAt),
      ),
    )
    .as("run_agg");
  const batchAgg = db
    .select({ count: countRows().as("credit_batch_count") })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.organizationId, orgId),
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.archivedAt),
      ),
    )
    .as("batch_agg");

  const [, [row]] = await Promise.all([
    requireOrgFacility(ctx, facilityId),
    db
      .select({
        facilityCount: facilityAgg.count,
        supplierCount: supplierAgg.count,
        reactorCount: reactorAgg.count,
        certifierProjectCount: projectAgg.count,
        feedstockCount: feedstockAgg.count,
        completeProductionRunCount: runAgg.count,
        creditBatchCount: batchAgg.count,
      })
      .from(facilityAgg)
      .crossJoin(supplierAgg)
      .crossJoin(reactorAgg)
      .crossJoin(projectAgg)
      .crossJoin(feedstockAgg)
      .crossJoin(runAgg)
      .crossJoin(batchAgg),
  ]);
  if (!row) throw new Error("onboarding aggregate returned no row");

  return {
    isOwnerOrAdmin,
    isOrgOwnerOrAdmin,
    facilityCount: row.facilityCount,
    supplierCount: row.supplierCount,
    facility: {
      reactorCount: row.reactorCount,
      registryConnected: row.certifierProjectCount > 0,
      feedstockCount: row.feedstockCount,
      completeProductionRunCount: row.completeProductionRunCount,
      creditBatchCount: row.creditBatchCount,
    },
  };
}
