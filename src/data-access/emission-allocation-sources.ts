import type { db, DbTransaction } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CreditBatchLineageFacts } from "./credit-batch-lineage-types";
import type { AllocationDeliveryFact, AllocationManualFact } from "@/lib/certification/emission-allocation-facts";
import { buildAllocationManualFacts } from "@/lib/certification/emission-allocation-manual";
import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { formatFacilityDate } from "@/lib/date-utils";
import { loadBiocharDeliveryTransportLegs } from "./biochar-delivery-transport";
import { listEmissionEntriesForBatches } from "./emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "./removal-template-observations";
import { removalEntryOwner, isLiveEntryReservation } from "@/lib/certification/removal-emission-contributions";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { requireOrgScope, type Executor } from "./utils";

/** `sliceDeliveryIds` adds deliveries a Removal's application slices reach outside batch lineage. */
export async function loadAllocationDeliveries(ctx: OrgContext,
  batches: { id: string; code: string; lineageFacts: CreditBatchLineageFacts }[], reader: Executor,
  timezone: string, sliceDeliveryIds: readonly string[] = [],
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
  const ids = [...new Set([...loads.keys(), ...sliceDeliveryIds])];
  if (!ids.length) return [];
  const rows = await reader.select().from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, ids)));
  const legs = await loadBiocharDeliveryTransportLegs(ctx, rows.map(row => ({ deliveryId: row.id, loadMassKg: Number(row.deliveredWetMassKg ?? 0) })), reader);
  const byId = new Map(legs.map(leg => [leg.id, leg]));
  return rows.map(row => ({ id: row.id, code: row.code, date: formatFacilityDate(row.deliveryDate, timezone),
    wetKg: row.deliveredWetMassKg, oneWayKm: (byId.get(row.id)?.distanceKm ?? 0) > 0 ? byId.get(row.id)!.distanceKm : null,
    loads: loads.get(row.id) ?? [] }));
}

/** Entries retain their recorded batch even while their template needs reconfirmation. */
export async function loadAllocationManualEntries(
  ctx: OrgContext, batchIds: string[], facilityId: string, reader: typeof db | DbTransaction,
): Promise<AllocationManualFact[]> {
  requireOrgScope(ctx);
  const entries = await listEmissionEntriesForBatches(ctx, batchIds, reader);
  if (!entries.length) return [];
  const [current, previous, carry, contenders, reservations] = await Promise.all([
    getLatestTemplateObservations(ctx, "isometric", [...new Set(entries.map(entry => entry.removalTemplateId))], reader),
    getTemplateObservationsByIds(ctx, entries.map(entry => entry.observationId), reader),
    loadFacilityEmissionEntryCarry(ctx, facilityId, reader, undefined, { ownedBatchIds: batchIds }),
    listEmissionEntryDraftContenders(ctx, batchIds, reader),
    loadEmissionEntryReservations(ctx, entries.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []), reader),
  ]);
  const nowMs = Date.now();
  const owners = new Map(entries.map(entry => {
    const carried = carry.entries.find(fact => fact.id === entry.id);
    const reservation = reservations.find(row => row.submissionId === entry.sendReservedBySubmissionId);
    const live = reservation && isLiveEntryReservation(reservation, nowMs);
    const fact = { ...entry, counts: true, evidenceDocumentIds: [], ...carried,
      reservedByRemovalId: carried?.reservedByRemovalId ?? (live ? reservation.removalId : null),
      reservationKnownInactive: carried?.reservationKnownInactive ?? (!entry.sendReservedBySubmissionId || !!reservation && !live),
    };
    const removalId = removalEntryOwner(fact, contenders) ?? carried?.carry.receiver?.removalId ??
      (entry.kind === "zero" && fact.reservationKnownInactive ? entry.confirmedForRemovalId : null);
    return [entry.id, { removalId, pending: !entry.sentByRemovalId }] as const;
  }));
  return buildAllocationManualFacts(entries, current, previous).map(entry => ({ ...entry, ...owners.get(entry.id) }));
}
