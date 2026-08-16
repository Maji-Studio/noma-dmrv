import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type DbTransaction } from "@/db";
import {
  applications,
  biocharProductSourceAllocations,
  biocharProducts,
  creditBatchApplications,
  creditBatchProductionRuns,
  deliveries,
  orders,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

export interface CreditBatchApplicationSlice {
  creditBatchId: string;
  applicationId: string;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
  removalId: string | null;
}

interface ReconcileSliceScope {
  applicationIds?: string[];
  creditBatchIds?: string[];
  biocharProductIds?: string[];
}

/**
 * Refreshes only unassigned application x credit-batch slices. Once a slice
 * has a Removal owner it is immutable and is never updated or deleted here.
 *
 * Product source allocations remain the physical provenance authority. This
 * seam projects them once onto the credit-batch grain and persists both wet
 * and dry applied mass, so Removal accounting never re-splits a captured
 * Application from mutable live totals.
 */
export async function reconcileUnassignedCreditBatchApplicationSlices(
  ctx: OrgContext,
  tx: DbTransaction,
  scope: ReconcileSliceScope,
): Promise<void> {
  requireOrgScope(ctx);
  const requestedApplicationIds = [...new Set(scope.applicationIds ?? [])];
  const requestedBatchIds = [...new Set(scope.creditBatchIds ?? [])];
  const requestedProductIds = [...new Set(scope.biocharProductIds ?? [])];
  if (
    requestedApplicationIds.length === 0 &&
    requestedBatchIds.length === 0 &&
    requestedProductIds.length === 0
  ) {
    return;
  }

  const scopedRunRows = requestedBatchIds.length
    ? await tx
        .select({
          creditBatchId: creditBatchProductionRuns.creditBatchId,
          productionRunId: creditBatchProductionRuns.productionRunId,
        })
        .from(creditBatchProductionRuns)
        .where(
          and(
            inArray(creditBatchProductionRuns.creditBatchId, requestedBatchIds),
            eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
          ),
        )
    : [];
  const scopedRunIds = [...new Set(scopedRunRows.map((row) => row.productionRunId))];

  const scopedProductRows = scopedRunIds.length
    ? await tx
        .selectDistinct({ id: biocharProducts.id })
        .from(biocharProducts)
        .leftJoin(
          biocharProductSourceAllocations,
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
        )
        .where(
          and(
            or(
              inArray(
                biocharProductSourceAllocations.productionRunId,
                scopedRunIds,
              ),
              inArray(biocharProducts.linkedProductionRunId, scopedRunIds),
            ),
            eq(biocharProducts.organizationId, ctx.organizationId),
          ),
        )
    : [];
  const scopedProductIds = [
    ...new Set([
      ...requestedProductIds,
      ...scopedProductRows.map((row) => row.id),
    ]),
  ];

  const derivedApplicationRows = scopedProductIds.length
    ? await tx
        .select({ id: applications.id })
        .from(applications)
        .innerJoin(
          deliveries,
          and(
            eq(applications.deliveryId, deliveries.id),
            eq(deliveries.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(
          orders,
          and(
            eq(deliveries.orderId, orders.id),
            eq(orders.organizationId, ctx.organizationId),
          ),
        )
        .where(
          and(
            inArray(
              sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
              scopedProductIds,
            ),
            eq(applications.organizationId, ctx.organizationId),
          ),
        )
    : [];
  const applicationIds = [
    ...new Set([
      ...requestedApplicationIds,
      ...derivedApplicationRows.map((row) => row.id),
    ]),
  ];
  if (applicationIds.length === 0) {
    if (requestedBatchIds.length > 0) {
      await tx.delete(creditBatchApplications).where(
        and(
          inArray(creditBatchApplications.creditBatchId, requestedBatchIds),
          isNull(creditBatchApplications.removalId),
          eq(creditBatchApplications.organizationId, ctx.organizationId),
        ),
      );
    }
    return;
  }

  const applicationRows = await tx
    .select({
      applicationId: applications.id,
      appliedWetTons: applications.biocharAppliedTons,
      appliedDryTons: applications.biocharAppliedDryTons,
      productId: biocharProducts.id,
      legacyProductionRunId: biocharProducts.linkedProductionRunId,
    })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      biocharProducts,
      and(
        eq(
          biocharProducts.id,
          sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
        ),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(applications.id, applicationIds),
        eq(applications.organizationId, ctx.organizationId),
      ),
    );

  const productIds = [...new Set(applicationRows.map((row) => row.productId))];
  const allocationRows = productIds.length
    ? await tx
        .select({
          productId: biocharProductSourceAllocations.biocharProductId,
          productionRunId: biocharProductSourceAllocations.productionRunId,
          allocatedWetMassKg:
            biocharProductSourceAllocations.allocatedWetMassKg,
          allocatedDryMassKg:
            biocharProductSourceAllocations.allocatedDryMassKg,
        })
        .from(biocharProductSourceAllocations)
        .where(
          and(
            inArray(biocharProductSourceAllocations.biocharProductId, productIds),
            eq(
              biocharProductSourceAllocations.organizationId,
              ctx.organizationId,
            ),
          ),
        )
    : [];
  const sourceRunIds = [
    ...new Set([
      ...allocationRows.map((row) => row.productionRunId),
      ...applicationRows.map((row) => row.legacyProductionRunId),
    ].filter((runId): runId is string => runId != null)),
  ];
  const membershipRows = sourceRunIds.length
    ? await tx
        .select({
          creditBatchId: creditBatchProductionRuns.creditBatchId,
          productionRunId: creditBatchProductionRuns.productionRunId,
        })
        .from(creditBatchProductionRuns)
        .where(
          and(
            inArray(creditBatchProductionRuns.productionRunId, sourceRunIds),
            eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
          ),
        )
    : [];
  const batchIdByRunId = new Map(
    membershipRows.map((row) => [row.productionRunId, row.creditBatchId]),
  );
  const allocationsByProductId = new Map<
    string,
    typeof allocationRows
  >();
  for (const row of allocationRows) {
    const rows = allocationsByProductId.get(row.productId) ?? [];
    rows.push(row);
    allocationsByProductId.set(row.productId, rows);
  }

  const desired = new Map<string, CreditBatchApplicationSlice>();
  for (const application of applicationRows) {
    const allocations = allocationsByProductId.get(application.productId) ?? [];
    const totalWetWeight = allocations.reduce(
      (sum, row) => sum + row.allocatedWetMassKg,
      0,
    );
    const totalDryWeight = allocations.reduce(
      (sum, row) => sum + row.allocatedDryMassKg,
      0,
    );
    if (application.appliedDryTons == null) {
      throw new SafeError(
        "An Application has no allocated dry biochar mass. Recalculate its applied mass before creating a Removal.",
      );
    }
    if (
      allocations.length > 0 &&
      (totalWetWeight <= 0 || totalDryWeight <= 0)
    ) {
      throw new SafeError(
        "A biochar product has invalid source allocation mass. Correct its provenance before creating a Removal.",
      );
    }
    const sources = allocations.length > 0
      ? allocations
      : [{
          productId: application.productId,
          productionRunId: application.legacyProductionRunId,
          allocatedWetMassKg: 1,
          allocatedDryMassKg: 1,
        }];
    for (const source of sources) {
      if (!source.productionRunId) continue;
      const creditBatchId = batchIdByRunId.get(source.productionRunId);
      if (!creditBatchId) continue;
      if (requestedBatchIds.length > 0 && !requestedBatchIds.includes(creditBatchId)) {
        continue;
      }
      const key = `${creditBatchId}:${application.applicationId}`;
      const slice = desired.get(key) ?? {
        creditBatchId,
        applicationId: application.applicationId,
        allocatedWetMassKg: 0,
        allocatedDryMassKg: 0,
        removalId: null,
      };
      slice.allocatedWetMassKg +=
        tonnesToKg(application.appliedWetTons) *
        (allocations.length === 0
          ? 1
          : source.allocatedWetMassKg / totalWetWeight);
      slice.allocatedDryMassKg +=
        tonnesToKg(application.appliedDryTons) *
        (allocations.length === 0
          ? 1
          : source.allocatedDryMassKg / totalDryWeight);
      desired.set(key, slice);
    }
  }

  const existing = await tx
    .select({
      creditBatchId: creditBatchApplications.creditBatchId,
      applicationId: creditBatchApplications.applicationId,
      removalId: creditBatchApplications.removalId,
    })
    .from(creditBatchApplications)
    .where(
      and(
        requestedBatchIds.length > 0
          ? inArray(creditBatchApplications.creditBatchId, requestedBatchIds)
          : inArray(creditBatchApplications.applicationId, applicationIds),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    );
  const assignedKeys = new Set(
    existing
      .filter((row) => row.removalId)
      .map((row) => `${row.creditBatchId}:${row.applicationId}`),
  );

  await tx.delete(creditBatchApplications).where(
    and(
      requestedBatchIds.length > 0
        ? inArray(creditBatchApplications.creditBatchId, requestedBatchIds)
        : inArray(creditBatchApplications.applicationId, applicationIds),
      isNull(creditBatchApplications.removalId),
      eq(creditBatchApplications.organizationId, ctx.organizationId),
    ),
  );
  const inserts = [...desired.entries()]
    .filter(([key]) => !assignedKeys.has(key))
    .map(([, row]) => ({ ...row, organizationId: ctx.organizationId }));
  if (inserts.length > 0) {
    // A concurrent Removal may assign a slice after the read above. Preserve
    // that assigned row instead of failing this reconciliation on the natural
    // (creditBatchId, applicationId) key.
    // org-scope-ok: every row above is stamped with the active organization id.
    await tx
      .insert(creditBatchApplications)
      .values(inserts)
      .onConflictDoNothing();
  }
}
