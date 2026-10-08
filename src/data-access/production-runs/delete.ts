import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns, incidentReports, productionRuns, productionRunFeedstockDraws, productionRunFeedstocks, productionRunReadings } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode, type ConflictRef } from "@/lib/conflict-ref";
import { SafeError } from "@/lib/errors";
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
export class ProductionRunDependencyError extends SafeError {
  readonly conflict: ConflictRef;

  constructor(message: string, conflict: ConflictRef) {
    super(message);
    this.name = "ProductionRunDependencyError";
    this.conflict = conflict;
  }
}

/**
 * Delete a production run
 * Will fail if the run has dependent biochar products or credit batches.
 */
export async function deleteProductionRun(
  ctx: OrgContext,
  productionRunId: string,
  expectedVersion: number
): Promise<void> {
  requireOrgScope(ctx);

  // Verify run exists
  const [existing] = await db
    .select({
      id: productionRuns.id,
        version: productionRuns.version,
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Production run not found");
  }
  const existingFeedstockStorageLocationIds =
    await getProductionRunFeedstockDrawStorageIds(ctx, db, productionRunId);

  // Run all four deletes in one transaction so the child-row deletes roll back
  // if the final productionRuns delete fails. Foreign-key constraints remain
  // the race-safe backstop for dependent records; without the transaction the
  // removable children would already be gone, leaving a half-deleted run.
  await db.transaction(async (tx) => {
    await lockBinStocks(ctx, tx, [
      ...existingFeedstockStorageLocationIds,
      existing.biocharStorageLocationId,
    ]);

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
      throw new SafeError("Production run not found");
    }
    assertRowVersion({ entity: PRODUCTION_RUN_CONFLICT_ENTITY, id: productionRunId, expectedVersion, actualVersion: locked.version });
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

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "productionRun", entityId: productionRunId },
      "delete",
    );

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
  });
  await processPendingStorageObjectDeletions(ctx);
}
