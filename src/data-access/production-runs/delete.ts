import type { SnapshotStock } from "../stock-effects";
import { runReferenceNotFound } from "@/lib/production-run-domain-errors";
import { DomainError } from "@/lib/domain-errors";
import { db, type DbTransaction } from "@/db";
import { creditBatches, creditBatchProductionRuns, incidentReports, productionRuns, productionRunFeedstockDraws, productionRunFeedstocks, productionRunReadings } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode, type ConflictRef } from "@/lib/conflict-ref";
import { and, eq } from "drizzle-orm";
import { assertRowVersion } from "../row-version";
import { assertCanMutateCertifiedLineage } from "../certification-lineage-guards";
import { retireDocumentsForEntities } from "../documents";
import { lockBinStocks } from "../lock-bin-stocks";
import { assertProductionRunStockSnapshot } from "../production-run-stock-locks";
import { processPendingStorageObjectDeletions } from "../storage-object-deletions";
import { requireOrgScope } from "../utils";
import { getProductionRunFeedstockDrawStorageIds } from "./feedstock-draws";
import { getProductionRunDependentProduct } from "./product-dependencies";
const PRODUCTION_RUN_CONFLICT_ENTITY = "productionRun";
export class ProductionRunDependencyError extends DomainError {
  readonly conflict: ConflictRef;

  constructor(message: string, conflict: ConflictRef) {
    super("conflict", message, { conflict });
    this.name = "ProductionRunDependencyError";
    this.conflict = conflict;
  }
}

/**
 * Delete a production run
 * Will fail if the run has dependent biochar products or credit batches.
 */
export async function deleteProductionRunInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunId: string,
  expectedVersion: number,
  snapshotStock?: SnapshotStock,
): Promise<void> {
  requireOrgScope(ctx);

  // Verify run exists
  const [existing] = await tx
    .select({
      id: productionRuns.id,
      version: productionRuns.version,
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!existing) {
    throw runReferenceNotFound("Production run not found");
  }
  const existingFeedstockStorageLocationIds =
    await getProductionRunFeedstockDrawStorageIds(ctx, tx, productionRunId);

  // Run all four deletes in one transaction so the child-row deletes roll back
  // if the final productionRuns delete fails. Foreign-key constraints remain
  // the race-safe backstop for dependent records; without the transaction the
  // removable children would already be gone, leaving a half-deleted run.
  const [locked] = await tx
    .select({
      id: productionRuns.id,
      version: productionRuns.version,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(and(
      eq(productionRuns.id, productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    ))
    .for("update");

  if (!locked) {
    throw runReferenceNotFound("Production run not found");
  }
  assertRowVersion({ entity: PRODUCTION_RUN_CONFLICT_ENTITY, id: productionRunId, expectedVersion, actualVersion: locked.version });
  // Existing entity row -> sorted certification lineage -> sorted bin locks.
  await assertCanMutateCertifiedLineage(
    ctx,
    tx,
    { entityType: "productionRun", entityId: productionRunId },
    "delete",
  );

  await lockBinStocks(ctx, tx, [
    ...existingFeedstockStorageLocationIds,
    existing.biocharStorageLocationId,
  ]);

  const lockedFeedstockStorageLocationIds =
    await getProductionRunFeedstockDrawStorageIds(ctx, tx, productionRunId);
  assertProductionRunStockSnapshot(
    {
      feedstockStorageLocationIds: existingFeedstockStorageLocationIds,
      biocharStorageLocationId: existing.biocharStorageLocationId,
    },
    {
      feedstockStorageLocationIds: lockedFeedstockStorageLocationIds,
      biocharStorageLocationId: locked.biocharStorageLocationId,
    },
    {
      feedstockDraws: existingFeedstockStorageLocationIds.map(
        (storageLocationId) => ({ storageLocationId }),
      ),
      biocharOutputKg: locked.biocharOutputKg,
    },
  );

  await snapshotStock?.(tx, [...lockedFeedstockStorageLocationIds, locked.biocharStorageLocationId]);

  const dependentProduct = await getProductionRunDependentProduct(
    ctx,
    tx,
    productionRunId,
  );
  const [dependentCreditBatch] = await tx
    .select({ id: creditBatches.id, code: creditBatches.code })
    .from(creditBatchProductionRuns)
    .innerJoin(
      creditBatches,
      and(
        eq(creditBatchProductionRuns.creditBatchId, creditBatches.id),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .where(and(
      eq(creditBatchProductionRuns.productionRunId, productionRunId),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ))
    .limit(1);

  if (dependentProduct || dependentCreditBatch) {
    const dependentKinds = [
      dependentProduct ? "biochar products" : null,
      dependentCreditBatch ? "credit batches" : null,
    ].filter((kind): kind is string => kind != null);
    const dependent = dependentProduct
      ? { entity: "biocharProduct", ...dependentProduct }
      : { entity: "creditBatch", ...dependentCreditBatch! };
    const conflict = { ...dependent, code: conflictCode(dependent.code) };
    throw new ProductionRunDependencyError(
      `This production run cannot be deleted because dependent ${dependentKinds.join(" and ")} exist. Remove those records first.`,
      conflict,
    );
  }

  const productionIncidents = await tx
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.productionRunId, productionRunId),
        eq(incidentReports.organizationId, ctx.organizationId),
      ),
    );
  await tx
    .delete(productionRunFeedstocks)
    .where(and(eq(productionRunFeedstocks.productionRunId, productionRunId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

  await tx
    .delete(productionRunFeedstockDraws)
    .where(and(eq(productionRunFeedstockDraws.productionRunId, productionRunId), eq(productionRunFeedstockDraws.organizationId, ctx.organizationId)));

  await tx
    .delete(productionRunReadings)
    .where(and(eq(productionRunReadings.productionRunId, productionRunId), eq(productionRunReadings.organizationId, ctx.organizationId)));

  await tx
    .delete(incidentReports)
    .where(and(eq(incidentReports.productionRunId, productionRunId), eq(incidentReports.organizationId, ctx.organizationId)));

  await tx
    .delete(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));
  await retireDocumentsForEntities(ctx, tx, [
    { entityType: "production_run", entityId: productionRunId },
    ...productionIncidents.map((incident) => ({
      entityType: "production_incident" as const,
      entityId: incident.id,
    })),
  ]);

}

export async function deleteProductionRun(ctx: OrgContext, id: string, expectedVersion: number): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction((tx) => deleteProductionRunInTransaction(ctx, tx, id, expectedVersion));
  await processPendingStorageObjectDeletions(ctx);
}
