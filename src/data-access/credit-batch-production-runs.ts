import { eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { applications } from "@/db/schema/application";
import { creditBatchProductionRuns } from "@/db/schema/credits";
import { deliveries, orders } from "@/db/schema/logistics";
import { biocharProducts } from "@/db/schema/products";
import { SafeError } from "@/lib/errors";

import { requireAuth } from "./utils";

export interface ApplicationForRun {
  applicationId: string;
  productionRunId: string;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function getProductionRunIdsByBatchId(
  batchIds: string[],
  executor: DbTransaction | typeof db = db,
): Promise<Record<string, string[]>> {
  const ids = unique(batchIds);
  if (ids.length === 0) return {};

  const rows = await executor
    .select({
      creditBatchId: creditBatchProductionRuns.creditBatchId,
      productionRunId: creditBatchProductionRuns.productionRunId,
    })
    .from(creditBatchProductionRuns)
    .where(inArray(creditBatchProductionRuns.creditBatchId, ids));

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
  executor: DbTransaction | typeof db,
  runIds: string[],
): Promise<ApplicationForRun[]> {
  const ids = unique(runIds);
  if (ids.length === 0) return [];

  const rows = await executor
    .select({
      applicationId: applications.id,
      productionRunId: biocharProducts.linkedProductionRunId,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .innerJoin(
      biocharProducts,
      sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
    )
    .where(inArray(biocharProducts.linkedProductionRunId, ids));

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
      ? [{ applicationId: row.applicationId, productionRunId: row.productionRunId }]
      : [],
  );
}

export async function getApplicationsForRuns(
  userId: string,
  runIds: string[],
): Promise<ApplicationForRun[]> {
  requireAuth(userId);
  return getApplicationsForRunsWithExecutor(db, runIds);
}

export async function getApplicationIdsByBatchFromRuns(
  userId: string,
  productionRunIdsByBatchId: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const runIds = unique(Object.values(productionRunIdsByBatchId).flat());
  const applicationsForRuns = await getApplicationsForRuns(userId, runIds);
  const batchIdByRunId = new Map<string, string>();
  for (const [batchId, batchRunIds] of Object.entries(productionRunIdsByBatchId)) {
    for (const runId of batchRunIds) {
      batchIdByRunId.set(runId, batchId);
    }
  }

  const applicationIdsByBatchId: Record<string, string[]> = {};
  for (const row of applicationsForRuns) {
    const batchId = batchIdByRunId.get(row.productionRunId);
    if (!batchId) continue;
    applicationIdsByBatchId[batchId] ??= [];
    applicationIdsByBatchId[batchId].push(row.applicationId);
  }

  return Object.fromEntries(
    Object.entries(applicationIdsByBatchId).map(([batchId, applicationIds]) => [
      batchId,
      unique(applicationIds),
    ]),
  );
}
