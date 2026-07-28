import { and, eq, inArray, sql } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { applications } from "@/db/schema/application";
import { deliveries, orders } from "@/db/schema/logistics";
import { biocharProducts } from "@/db/schema/products";
import { SafeError } from "@/lib/errors";
import { pluralize } from "@/lib/copy-utils";

import { requireOrgScope } from "./utils";

export interface ApplicationForRun {
  applicationId: string;
  productionRunId: string;
  biocharAppliedTons: number;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
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
      `${pluralize(multiRunApplicationIds.length, "Application")} ${multiRunApplicationIds.join(", ")} ${multiRunApplicationIds.length === 1 ? "resolves" : "resolve"} to multiple production runs. Check the linked biochar products.`,
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
