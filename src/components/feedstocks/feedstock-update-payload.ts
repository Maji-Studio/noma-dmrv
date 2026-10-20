import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { FeedstockFormData } from "@/schemas/feedstocks";

/**
 * Update input fields the form names differently (the renames in
 * `feedstockUpdatePayload`, reversed), so a refused save lands on the field
 * the operator edited.
 */
export const FEEDSTOCK_UPDATE_REFUSAL_ALIASES = {
  massWetKg: "totalWetMassKg",
  moistureContentPercent: "moisturePercent",
  storageLocationId: "allocations.0.storageLocationId",
} as const;

/** The update input for an edited feedstock, built from the form's draft. */
export function feedstockUpdatePayload(data: FeedstockFormData, editing: Pick<FeedstockWithRelations, "id" | "version">) {
  return {
    feedstockId: editing.id,
    // The version the side sheet opened on, never a refetched one, so a
    // concurrent edit is refused instead of silently overwritten (#768).
    expectedVersion: editing.version,
    facilityId: data.facilityId,
    deliveryDate: data.deliveryDate,
    supplierId: data.supplierId,
    vehicleId: data.vehicleId || null,
    transportDistanceKm: data.transportDistanceKm,
    transportDistanceSource: data.transportDistanceSource,
    distanceNote: data.distanceNote,
    feedstockTypeId: data.feedstockTypeId,
    massWetKg: data.allocations[0]?.allocatedWetMassKg ?? data.totalWetMassKg,
    moistureContentPercent: data.moisturePercent,
    storageLocationId: data.allocations[0].storageLocationId,
    overrideJustification: data.overrideJustification || null,
    notes: data.notes || null,
  };
}
