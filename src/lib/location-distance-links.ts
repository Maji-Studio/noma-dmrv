import { CUSTOMER_DEEP_LINK_PARAM } from "./customer-links";
import {
  ENTITY_DEEP_LINK_EDIT_MODE,
  ENTITY_DEEP_LINK_MODE_PARAM,
  LOCATION_DEEP_LINK_PARAM,
  SUPPLIER_QUERY_PARAM,
} from "./entity-deep-link";

interface LocationDistanceLinkInput {
  facilityId: string;
  /** The supplier or customer that owns the location. */
  partyId: string;
  /** Opens the location's edit dialog; without it the party's edit sheet opens. */
  locationId?: string | null;
}

function locationDistanceLink(path: string, partyParam: string, input: LocationDistanceLinkInput): string {
  const params = new URLSearchParams({
    facility: input.facilityId,
    [partyParam]: input.partyId,
    [ENTITY_DEEP_LINK_MODE_PARAM]: ENTITY_DEEP_LINK_EDIT_MODE,
    ...(input.locationId ? { [LOCATION_DEEP_LINK_PARAM]: input.locationId } : {}),
  });
  return `${path}?${params.toString()}`;
}

/** Opens the supplier location whose facility distance feeds a feedstock leg. */
export function supplierLocationDistanceLink(input: LocationDistanceLinkInput): string {
  return locationDistanceLink("/suppliers", SUPPLIER_QUERY_PARAM, input);
}

/** Opens the customer location whose facility distance feeds a delivery. */
export function customerLocationDistanceLink(input: LocationDistanceLinkInput): string {
  return locationDistanceLink("/customers", CUSTOMER_DEEP_LINK_PARAM, input);
}
