import { recordHref } from "@/lib/record-links";

interface LocationDistanceLinkInput {
  facilityId: string;
  /** The supplier or customer that owns the location. */
  partyId: string;
  /** Opens the location's edit dialog; without it the party's edit sheet opens. */
  locationId?: string | null;
}

/** Opens the supplier location whose facility distance feeds a feedstock leg. */
export function supplierLocationDistanceLink(input: LocationDistanceLinkInput): string {
  return recordHref("supplier", input.partyId, { facilityId: input.facilityId, preview: true, mode: "edit", locationId: input.locationId });
}

/** Opens the customer location whose facility distance feeds a delivery. */
export function customerLocationDistanceLink(input: LocationDistanceLinkInput): string {
  return recordHref("customer", input.partyId, { facilityId: input.facilityId, preview: true, mode: "edit", locationId: input.locationId });
}
