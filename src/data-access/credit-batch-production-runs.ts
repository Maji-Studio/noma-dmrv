import {
  and,
  eq,
  exists,
  inArray,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { applications } from "@/db/schema/application";
import { deliveries, orders } from "@/db/schema/logistics";
import {
  biocharProducts,
  biocharProductSourceAllocations,
} from "@/db/schema/products";
import { SafeError } from "@/lib/errors";

import { requireOrgScope } from "./utils";

export interface ApplicationForRun {
  applicationId: string;
  productionRunId: string;
  biocharAppliedTons: number;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface ApplicationProductRow {
  applicationId: string;
  biocharProductId: string;
  linkedProductionRunId: string | null;
  biocharAppliedTons: number;
}

interface ProductSourceAllocationRow {
  biocharProductId: string;
  productionRunId: string;
  allocatedWetMassKg: number;
}

/**
 * Split each physical application's applied wet mass across the runs that
 * supplied its product. Allocation rows are authoritative; the legacy product
 * link is used only when a product has no source-allocation rows.
 */
export function projectApplicationsAcrossSourceAllocations(
  applicationRows: ApplicationProductRow[],
  allocationRows: ProductSourceAllocationRow[],
  requestedRunIds: string[],
): ApplicationForRun[] {
  const requestedRunIdSet = new Set(requestedRunIds);
  const allocationsByProductId = new Map<
    string,
    ProductSourceAllocationRow[]
  >();
  for (const allocation of allocationRows) {
    const productAllocations =
      allocationsByProductId.get(allocation.biocharProductId) ?? [];
    productAllocations.push(allocation);
    allocationsByProductId.set(
      allocation.biocharProductId,
      productAllocations,
    );
  }

  const projectedRows = applicationRows.flatMap(
    (application): ApplicationForRun[] => {
      const allocations = [
        ...(allocationsByProductId.get(application.biocharProductId) ?? []),
      ].sort((left, right) =>
        left.productionRunId.localeCompare(right.productionRunId),
      );

      if (allocations.length === 0) {
        const productionRunId = application.linkedProductionRunId;
        return productionRunId && requestedRunIdSet.has(productionRunId)
          ? [{
              applicationId: application.applicationId,
              productionRunId,
              biocharAppliedTons: application.biocharAppliedTons,
            }]
          : [];
      }

      const totalAllocatedWetMassKg = allocations.reduce(
        (total, allocation) =>
          total + allocation.allocatedWetMassKg,
        0,
      );
      if (totalAllocatedWetMassKg <= 0) {
        if (application.biocharAppliedTons === 0) return [];
        throw new SafeError(
          `Application ${application.applicationId} cannot be attributed because its biochar product has zero allocated wet mass.`,
        );
      }

      let remainingAppliedTons = application.biocharAppliedTons;
      return allocations.flatMap((allocation, index) => {
        const biocharAppliedTons =
          index === allocations.length - 1
            ? remainingAppliedTons
            : application.biocharAppliedTons *
              (allocation.allocatedWetMassKg /
                totalAllocatedWetMassKg);
        remainingAppliedTons -= biocharAppliedTons;

        return requestedRunIdSet.has(allocation.productionRunId)
          ? [{
              applicationId: application.applicationId,
              productionRunId: allocation.productionRunId,
              biocharAppliedTons,
            }]
          : [];
      });
    },
  );

  return projectedRows.sort(
    (left, right) =>
      left.applicationId.localeCompare(right.applicationId) ||
      left.productionRunId.localeCompare(right.productionRunId),
  );
}

async function getApplicationsForRunsWithExecutor(
  ctx: OrgContext,
  executor: DbTransaction | typeof db,
  runIds: string[],
): Promise<ApplicationForRun[]> {
  const ids = unique(runIds);
  if (ids.length === 0) return [];

  const allocationForRequestedRun = executor
    .select({ value: sql`1` })
    .from(biocharProductSourceAllocations)
    .where(
      and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          biocharProducts.id,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
        inArray(
          biocharProductSourceAllocations.productionRunId,
          ids,
        ),
      ),
    );
  const anySourceAllocation = executor
    .select({ value: sql`1` })
    .from(biocharProductSourceAllocations)
    .where(
      and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          biocharProducts.id,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
      ),
    );

  const applicationRows = await executor
    .select({
      applicationId: applications.id,
      biocharProductId: biocharProducts.id,
      linkedProductionRunId:
        biocharProducts.linkedProductionRunId,
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
      or(
        exists(allocationForRequestedRun),
        and(
          notExists(anySourceAllocation),
          inArray(biocharProducts.linkedProductionRunId, ids),
        ),
      ),
      eq(applications.organizationId, ctx.organizationId),
    ));

  const productIds = unique(
    applicationRows.map((row) => row.biocharProductId),
  );
  const allocationRows = productIds.length === 0
    ? []
    : await executor
        .select({
          biocharProductId:
            biocharProductSourceAllocations.biocharProductId,
          productionRunId:
            biocharProductSourceAllocations.productionRunId,
          allocatedWetMassKg:
            biocharProductSourceAllocations.allocatedWetMassKg,
        })
        .from(biocharProductSourceAllocations)
        .where(
          and(
            inArray(
              biocharProductSourceAllocations.biocharProductId,
              productIds,
            ),
            eq(
              biocharProductSourceAllocations.organizationId,
              ctx.organizationId,
            ),
          ),
        );

  return projectApplicationsAcrossSourceAllocations(
    applicationRows,
    allocationRows,
    ids,
  );
}

export async function getApplicationsForRuns(
  ctx: OrgContext,
  runIds: string[],
): Promise<ApplicationForRun[]> {
  requireOrgScope(ctx);
  return getApplicationsForRunsWithExecutor(ctx, db, runIds);
}
