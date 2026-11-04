import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CreditBatchLineageFacts } from "./credit-batch-lineage-types";
import type { AllocationDeliveryFact, AllocationManualFact } from "@/lib/certification/emission-allocation-facts";
import { buildAllocationManualFacts } from "@/lib/certification/emission-allocation-manual";
import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { formatUtcDate } from "@/lib/date-utils";
import { loadBiocharDeliveryTransportLegs } from "./biochar-delivery-transport";
import { listEmissionEntriesForBatches } from "./emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "./removal-template-observations";
import { requireOrgScope, type Executor } from "./utils";

export async function loadAllocationDeliveries(ctx: OrgContext,
  batches: { id: string; code: string; lineageFacts: CreditBatchLineageFacts }[], reader: Executor,
): Promise<AllocationDeliveryFact[]> {
  requireOrgScope(ctx);
  const loads = new Map<string, AllocationDeliveryFact["loads"]>();
  for (const batch of batches) {
    for (const share of emissionDeliveryShares(batch.lineageFacts.runForwards)) {
      const group = loads.get(share.id) ?? [];
      group.push({ creditBatchId: batch.id, code: batch.code, kg: share.exactWetMassKg === null ? null : Number(share.exactWetMassKg) });
      loads.set(share.id, group);
    }
  }
  const ids = [...loads.keys()];
  if (!ids.length) return [];
  const rows = await reader.select().from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, ids)));
  const legs = await loadBiocharDeliveryTransportLegs(ctx, rows.map(row => ({ deliveryId: row.id, loadMassKg: Number(row.deliveredWetMassKg ?? 0) })), reader);
  const byId = new Map(legs.map(leg => [leg.id, leg]));
  return rows.map(row => ({ id: row.id, code: row.code, date: formatUtcDate(row.deliveryDate),
    wetKg: row.deliveredWetMassKg, oneWayKm: (byId.get(row.id)?.distanceKm ?? 0) > 0 ? byId.get(row.id)!.distanceKm : null,
    loads: loads.get(row.id)! }));
}

/** Entries retain their recorded batch even while their template needs reconfirmation. */
export async function loadAllocationManualEntries(
  ctx: OrgContext, batchIds: string[], reader: Pick<typeof db, "select" | "selectDistinctOn">,
): Promise<AllocationManualFact[]> {
  requireOrgScope(ctx);
  const entries = await listEmissionEntriesForBatches(ctx, batchIds, reader);
  const [current, previous] = await Promise.all([
    getLatestTemplateObservations(ctx, "isometric", [...new Set(entries.map(entry => entry.removalTemplateId))], reader),
    getTemplateObservationsByIds(ctx, entries.map(entry => entry.observationId), reader),
  ]);
  return buildAllocationManualFacts(entries, current, previous);
}
