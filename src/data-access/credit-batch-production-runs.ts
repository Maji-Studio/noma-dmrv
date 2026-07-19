import { and, eq, inArray, sql } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { applications } from "@/db/schema/application";
import { creditBatchProductionRuns } from "@/db/schema/credits";
import { deliveries, orders } from "@/db/schema/logistics";
import { biocharProducts } from "@/db/schema/products";
import { SafeError } from "@/lib/errors";

import { requireOrgScope } from "./utils";
import { loadCreditBatchLineageFacts } from "./credit-batch-lineage-facts";

export interface ApplicationForRun {
  applicationId: string;
  productionRunId: string;
  biocharAppliedTons: number;
}

export interface BatchApplicationRollup {
  applicationIds: string[];
  /** Σ member applications' biocharAppliedTons — derived, never stored (issue #285). */
  appliedWeightTons: number;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function getProductionRunIdsByBatchId(
  ctx: OrgContext,
  batchIds: string[],
  executor: DbTransaction | typeof db = db,
): Promise<Record<string, string[]>> {
  requireOrgScope(ctx);
  const ids = unique(batchIds);
  if (ids.length === 0) return {};

  const rows = await executor
    .select({
      creditBatchId: creditBatchProductionRuns.creditBatchId,
      productionRunId: creditBatchProductionRuns.productionRunId,
    })
    .from(creditBatchProductionRuns)
    .where(and(
      inArray(creditBatchProductionRuns.creditBatchId, ids),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ));

  return rows.reduce(
    (acc, row) => {
      acc[row.creditBatchId] ??= [];
      acc[row.creditBatchId].push(row.productionRunId);
      return acc;
    },
    {} as Record<string, string[]>,
  );
}

async function getApplicationsForRunsWithExecutor(
  ctx: OrgContext,
  executor: DbTransaction | typeof db,
  runIds: string[],
): Promise<ApplicationForRun[]> {
  const ids = unique(runIds);
  if (ids.length === 0) return [];

  const rows = await executor
    .select({
      applicationId: applications.id,
      productionRunId: biocharProducts.linkedProductionRunId,
      biocharAppliedTons: applications.biocharAppliedTons,
    })
    .from(applications)
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .innerJoin(
      biocharProducts,
      and(
        sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .where(and(
      inArray(biocharProducts.linkedProductionRunId, ids),
      eq(applications.organizationId, ctx.organizationId),
    ));

  const runIdsByApplicationId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.productionRunId) continue;
    const appRunIds = runIdsByApplicationId.get(row.applicationId) ?? new Set();
    appRunIds.add(row.productionRunId);
    runIdsByApplicationId.set(row.applicationId, appRunIds);
  }

  const multiRunApplicationIds = Array.from(runIdsByApplicationId.entries())
    .filter(([, appRunIds]) => appRunIds.size > 1)
    .map(([applicationId]) => applicationId);
  if (multiRunApplicationIds.length > 0) {
    throw new SafeError(
      `Application(s) resolve to multiple production runs: ${multiRunApplicationIds.join(", ")}`,
    );
  }

  return rows.flatMap((row) =>
    row.productionRunId
      ? [
          {
            applicationId: row.applicationId,
            productionRunId: row.productionRunId,
            biocharAppliedTons: row.biocharAppliedTons,
          },
        ]
      : [],
  );
}

export async function getApplicationsForRuns(
  ctx: OrgContext,
  runIds: string[],
): Promise<ApplicationForRun[]> {
  requireOrgScope(ctx);
  return getApplicationsForRunsWithExecutor(ctx, db, runIds);
}

/**
 * Roll up member applications per batch from the run membership map:
 * unique application ids + derived applied weight (Σ biocharAppliedTons).
 * This replaces the stored `weightTons` column (issue #285) — the figure is
 * recomputed on every read so edited/deleted applications can never leave a
 * stale headline number on a credit batch.
 */
export function summarizeApplicationsForBatches(
  applicationsForRuns: ApplicationForRun[],
  productionRunIdsByBatchId: Record<string, string[]>,
): Record<string, BatchApplicationRollup> {
  const batchIdByRunId = new Map<string, string>();
  for (const [batchId, batchRunIds] of Object.entries(productionRunIdsByBatchId)) {
    for (const runId of batchRunIds) {
      batchIdByRunId.set(runId, batchId);
    }
  }

  // Dedupe by application id (defensive — the lineage walk yields one row per
  // application) so a duplicate row can never double-count applied weight.
  const appliedTonsByBatchId = new Map<string, Map<string, number>>();
  for (const row of applicationsForRuns) {
    const batchId = batchIdByRunId.get(row.productionRunId);
    if (!batchId) continue;
    const batchApps = appliedTonsByBatchId.get(batchId) ?? new Map();
    batchApps.set(row.applicationId, row.biocharAppliedTons);
    appliedTonsByBatchId.set(batchId, batchApps);
  }

  return Object.fromEntries(
    Array.from(appliedTonsByBatchId.entries()).map(([batchId, batchApps]) => [
      batchId,
      {
        applicationIds: Array.from(batchApps.keys()),
        appliedWeightTons: Array.from(batchApps.values()).reduce(
          (total, tons) => total + tons,
          0,
        ),
      },
    ]),
  );
}

export async function getApplicationRollupsByBatchFromRuns(
  ctx: OrgContext,
  productionRunIdsByBatchId: Record<string, string[]>,
): Promise<Record<string, BatchApplicationRollup>> {
  requireOrgScope(ctx);
  const runIds = unique(Object.values(productionRunIdsByBatchId).flat());
  const applicationsForRuns = await getApplicationsForRuns(ctx, runIds);
  return summarizeApplicationsForBatches(
    applicationsForRuns,
    productionRunIdsByBatchId,
  );
}

/**
 * Convenience entry point when only batch ids are at hand (wizard, dashboard):
 * resolves the run membership first, then rolls up member applications.
 */
export async function getApplicationRollupsByBatchIds(
  ctx: OrgContext,
  batchIds: string[],
): Promise<Record<string, BatchApplicationRollup>> {
  requireOrgScope(ctx);
  const factsByBatch = await loadCreditBatchLineageFacts(ctx, batchIds);
  return Object.fromEntries(
    Object.entries(factsByBatch).map(([batchId, facts]) => [batchId, {
      applicationIds: facts.applicationIds,
      appliedWeightTons: facts.appliedWeightTons,
    }]),
  );
}
