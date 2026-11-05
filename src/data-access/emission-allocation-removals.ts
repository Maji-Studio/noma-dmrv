import { and, eq, inArray } from "drizzle-orm";
import type { db, DbTransaction } from "@/db";
import { applications, creditBatchApplications } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import type { AllocationDeliveryFact } from "@/lib/certification/emission-allocation-facts";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { loadBiocharDeliveryTransportLegs } from "./biochar-delivery-transport";
import { requireOrgScope } from "./utils";

/** Same frozen application lineage and delivery-load projection used by submission. */
export async function loadAllocationRemovalLoads(
  ctx: OrgContext, batchIds: string[], removals: { id: string; code: string }[], executor: typeof db | DbTransaction,
): Promise<Map<string, NonNullable<AllocationDeliveryFact["removalLoads"]>>> {
  requireOrgScope(ctx);
  const byDelivery = new Map<string, NonNullable<AllocationDeliveryFact["removalLoads"]>>();
  for (const removal of removals) {
    const rollups = await loadCreditBatchRollups(ctx, batchIds, { removalId: removal.id }, executor);
    const slices = Object.values(rollups).flatMap(rollup => rollup.lineageFacts.applications.map(application => ({
      deliveryId: application.delivery.id, loadMassKg: tonnesToKg(application.biocharAppliedTons),
    })));
    const legs = await loadBiocharDeliveryTransportLegs(ctx, slices, executor);
    for (const leg of legs) {
      const loads = byDelivery.get(leg.id) ?? [];
      loads.push({ removalId: removal.id, code: removal.code, kg: leg.loadMassKg ?? 0 });
      byDelivery.set(leg.id, loads);
    }
  }
  return byDelivery;
}

/** Deliveries the batches' applied slices came from, whether or not a Removal holds them yet. */
export async function loadAppliedDeliveryIds(ctx: OrgContext, batchIds: string[], executor: typeof db | DbTransaction): Promise<string[]> {
  requireOrgScope(ctx);
  if (!batchIds.length) return [];
  const rows = await executor.selectDistinct({ deliveryId: applications.deliveryId }).from(creditBatchApplications)
    .innerJoin(applications, and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, creditBatchApplications.applicationId)))
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, batchIds)));
  return rows.flatMap(row => row.deliveryId ? [row.deliveryId] : []);
}
