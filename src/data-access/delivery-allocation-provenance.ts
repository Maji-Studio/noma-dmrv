import { db, type DbTransaction } from "@/db";
import { applicationOutputAllocations, applications, biocharProducts, biocharProductSourceAllocations, creditBatchApplications, deliveries, outputStockAllocations, outputStockRunAllocations, productionRuns, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { allocateApplicationShares, GRAMS_PER_KG, massGrams, splitGrams, type DeliveryRunShare } from "./delivery-allocation-math";
import { requireOrgScope } from "./utils";

/** Net signed effects, aggregated BEFORE joining runs so wet mass is never multiplied. */
export function deliveryProductAllocations(ctx: OrgContext, executor: typeof db | DbTransaction = db) {
  requireOrgScope(ctx);
  return executor.select({
    deliveryId: outputStockAllocations.deliveryId,
    biocharProductId: outputStockAllocations.biocharProductId,
    dryMassKg: sql<number>`sum(${outputStockAllocations.dryMassKg})`.mapWith(Number).as("dry_mass_kg"),
    wetMassKg: sql<number>`sum(${outputStockAllocations.wetMassKg})`.mapWith(Number).as("wet_mass_kg"),
  }).from(outputStockAllocations)
    .innerJoin(deliveries, and(eq(deliveries.id, outputStockAllocations.deliveryId), eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.storageLocationId, outputStockAllocations.sourceStorageLocationId)))
    .innerJoin(storageLocations, and(eq(storageLocations.id, outputStockAllocations.sourceStorageLocationId), eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.facilityId, deliveries.facilityId)))
    .innerJoin(biocharProducts, and(eq(biocharProducts.id, outputStockAllocations.biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.facilityId, deliveries.facilityId)))
    .where(eq(outputStockAllocations.organizationId, ctx.organizationId))
    .groupBy(outputStockAllocations.deliveryId, outputStockAllocations.biocharProductId)
    .having(sql`sum(${outputStockAllocations.dryMassKg}) > 0 or sum(${outputStockAllocations.wetMassKg}) > 0`)
    .as("delivery_product_allocations");
}

export async function getDeliveryAllocationProvenance(ctx: OrgContext, deliveryIds: string[], executor: typeof db | DbTransaction = db): Promise<DeliveryRunShare[]> {
  requireOrgScope(ctx);
  if (!deliveryIds.length) return [];
  if (executor === db) return db.transaction(tx => getDeliveryAllocationProvenance(ctx, deliveryIds, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
  const layers = deliveryProductAllocations(ctx, executor);
  const layerRows = await executor.select({ deliveryId: layers.deliveryId, biocharProductId: layers.biocharProductId, dryMassKg: layers.dryMassKg, wetMassKg: layers.wetMassKg })
    .from(layers)
    .innerJoin(deliveries, and(eq(deliveries.id, layers.deliveryId), eq(deliveries.organizationId, ctx.organizationId)))
    .innerJoin(biocharProducts, and(eq(biocharProducts.id, layers.biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.facilityId, deliveries.facilityId)))
    .where(inArray(deliveries.id, deliveryIds));
  const runs = await executor.select({ deliveryId: outputStockAllocations.deliveryId, biocharProductId: outputStockAllocations.biocharProductId,
    productionRunId: outputStockRunAllocations.productionRunId,
    dryMassKg: sql<number>`sum(${outputStockRunAllocations.dryMassKg})`.mapWith(Number),
  }).from(outputStockAllocations)
    .innerJoin(outputStockRunAllocations, and(eq(outputStockRunAllocations.allocationId, outputStockAllocations.id), eq(outputStockRunAllocations.organizationId, ctx.organizationId)))
    .innerJoin(deliveries, and(eq(deliveries.id, outputStockAllocations.deliveryId), eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.storageLocationId, outputStockAllocations.sourceStorageLocationId)))
    .innerJoin(productionRuns, and(eq(productionRuns.id, outputStockRunAllocations.productionRunId), eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, deliveries.facilityId)))
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), inArray(outputStockAllocations.deliveryId, deliveryIds)))
    .groupBy(outputStockAllocations.deliveryId, outputStockAllocations.biocharProductId, outputStockRunAllocations.productionRunId)
    .having(sql`sum(${outputStockRunAllocations.dryMassKg}) >= 0`);
  const zeroDryProducts = layerRows.filter(l => massGrams(l.dryMassKg) === 0).map(l => l.biocharProductId!);
  // Exact physical residual can carry wet mass after its last dry gram was
  // already attributed. Preserve those source identities using frozen weights.
  const zeroDrySources = zeroDryProducts.length ? await executor.select().from(biocharProductSourceAllocations)
    .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), inArray(biocharProductSourceAllocations.biocharProductId, zeroDryProducts))) : [];
  const totals = await executor.select({ id: deliveries.id, wetMassKg: deliveries.deliveredWetMassKg, dryMassKg: deliveries.massDryKg }).from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, deliveryIds)));
  if (totals.length !== new Set(deliveryIds).size) throw new SafeError("Delivery not found in this organization.");
  for (const delivery of totals) {
    const shares = layerRows.filter(layer => layer.deliveryId === delivery.id);
    if (!shares.length || delivery.wetMassKg == null || delivery.dryMassKg == null ||
      shares.reduce((sum, layer) => sum + massGrams(layer.wetMassKg), 0) !== massGrams(delivery.wetMassKg) ||
      shares.reduce((sum, layer) => sum + massGrams(layer.dryMassKg), 0) !== massGrams(delivery.dryMassKg)) {
      throw new SafeError("Saved delivery allocations do not match the shipment totals.");
    }
  }
  return layerRows.sort((a, b) => `${a.deliveryId}:${a.biocharProductId}`.localeCompare(`${b.deliveryId}:${b.biocharProductId}`)).flatMap(layer => {
    const sources = runs.filter(r => r.deliveryId === layer.deliveryId && r.biocharProductId === layer.biocharProductId).sort((a, b) => a.productionRunId.localeCompare(b.productionRunId));
    if (sources.reduce((sum, r) => sum + massGrams(r.dryMassKg), 0) !== massGrams(layer.dryMassKg)) throw new SafeError("Saved delivery source allocations do not balance.");
    if (!sources.length || sources.some(r => r.dryMassKg < 0)) throw new SafeError("Saved delivery source provenance is missing.");
    const wetWeights = massGrams(layer.dryMassKg) > 0 ? sources.map(r => massGrams(r.dryMassKg)) : sources.map(r => {
      const frozen = zeroDrySources.find(s => s.biocharProductId === layer.biocharProductId && s.productionRunId === r.productionRunId);
      if (!frozen) throw new SafeError("Frozen source weights are missing for residual wet mass.");
      return massGrams(Number(frozen.allocatedDryMassKg));
    });
    const wet = splitGrams(massGrams(layer.wetMassKg), wetWeights);
    return sources.map((r, i) => ({ deliveryId: layer.deliveryId!, biocharProductId: layer.biocharProductId!, productionRunId: r.productionRunId, dryMassKg: r.dryMassKg, wetMassKg: wet[i] / GRAMS_PER_KG }));
  });
}

/** Caller holds the delivery row lock and has checked source/target certification. */
export async function saveApplicationOutputAllocations(ctx: OrgContext, tx: DbTransaction, application: typeof applications.$inferSelect): Promise<void> {
  requireOrgScope(ctx);
  const [persisted] = await tx.select().from(applications).where(and(eq(applications.id, application.id), eq(applications.organizationId, ctx.organizationId))).for("update");
  if (!persisted) throw new SafeError("Application not found in this organization.");
  application = persisted;
  await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.id, application.deliveryId), eq(deliveries.organizationId, ctx.organizationId))).for("update");
  const [owned] = await tx.select({ id: creditBatchApplications.id }).from(creditBatchApplications).where(and(eq(creditBatchApplications.applicationId, application.id), eq(creditBatchApplications.organizationId, ctx.organizationId), isNotNull(creditBatchApplications.removalId)));
  if (owned) throw new SafeError("Cannot change application shares owned by a Removal.");
  const saved = await getDeliveryAllocationProvenance(ctx, [application.deliveryId], tx);
  if (!saved.length) throw new SafeError("Delivery has no saved source allocations. Save its stock allocation before recording an application.");
  const used = await tx.select().from(applicationOutputAllocations).where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), eq(applicationOutputAllocations.deliveryId, application.deliveryId), ne(applicationOutputAllocations.applicationId, application.id)));
  const otherApplications = await tx.select({ id: applications.id, wetTons: applications.biocharAppliedTons, dryTons: applications.biocharAppliedDryTons }).from(applications).where(and(eq(applications.deliveryId, application.deliveryId), eq(applications.organizationId, ctx.organizationId), ne(applications.id, application.id)));
  for (const prior of otherApplications) {
    const allocations = used.filter(share => share.applicationId === prior.id);
    if (!allocations.length || prior.dryTons == null ||
      allocations.reduce((n, share) => n + massGrams(Number(share.wetMassKg)), 0) !== massGrams(prior.wetTons * KG_PER_TONNE) ||
      allocations.reduce((n, share) => n + massGrams(Number(share.dryMassKg)), 0) !== massGrams(prior.dryTons * KG_PER_TONNE)) {
      throw new SafeError("An existing application has missing or unbalanced saved source allocations.");
    }
  }
  const shares = allocateApplicationShares(saved, used.map(s => ({ ...s, wetMassKg: Number(s.wetMassKg), dryMassKg: Number(s.dryMassKg) })), application.biocharAppliedTons * KG_PER_TONNE, (application.biocharAppliedDryTons ?? 0) * KG_PER_TONNE);
  await tx.delete(applicationOutputAllocations).where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), eq(applicationOutputAllocations.applicationId, application.id)));
  await tx.insert(applicationOutputAllocations).values(shares.map(s => ({ ...s, wetMassKg: String(s.wetMassKg), dryMassKg: String(s.dryMassKg), organizationId: ctx.organizationId, applicationId: application.id })));
}

export interface ApplicationAllocationShare extends DeliveryRunShare {
  applicationId: string;
  productCode: string;
  productionRunCode: string;
}

export async function getApplicationAllocationShares(ctx: OrgContext, applicationIds: string[], executor: typeof db | DbTransaction = db): Promise<ApplicationAllocationShare[]> {
  requireOrgScope(ctx);
  if (!applicationIds.length) return [];
  const rows = await executor.select({
    applicationId: applicationOutputAllocations.applicationId,
    deliveryId: applicationOutputAllocations.deliveryId,
    biocharProductId: applicationOutputAllocations.biocharProductId,
    productionRunId: applicationOutputAllocations.productionRunId,
    wetMassKg: applicationOutputAllocations.wetMassKg,
    dryMassKg: applicationOutputAllocations.dryMassKg,
    productCode: biocharProducts.code,
    productionRunCode: productionRuns.code,
  }).from(applicationOutputAllocations)
    .innerJoin(biocharProducts, and(eq(biocharProducts.id, applicationOutputAllocations.biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId)))
    .innerJoin(productionRuns, and(eq(productionRuns.id, applicationOutputAllocations.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
    .where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), inArray(applicationOutputAllocations.applicationId, applicationIds)));
  return rows.map(row => ({ ...row, wetMassKg: Number(row.wetMassKg), dryMassKg: Number(row.dryMassKg) }));
}
