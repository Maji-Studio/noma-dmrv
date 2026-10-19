import { PARTY_FIELD, PARTY_PICKUP, PARTY_SOIL_TEMPERATURE_C, type PartyCaseId } from "./config";

/** The archive target is non-default so archiving it changes no sibling. */
export function partyLocationFixturePlan(caseId: PartyCaseId) {
  if (caseId === "supplier-location-update") return { kind: "supplier" as const,
    locations: [{ name: "Existing pickup", country: "Tanzania", city: "Dar es Salaam", isDefault: true,
      gpsLatitude: PARTY_PICKUP.gpsLatitude, gpsLongitude: PARTY_PICKUP.gpsLongitude }], order: false, archive: false };
  if (!["customer-field-missing-gps", "customer-location-archive", "customer-location-in-use", "order-archived-destination"].includes(caseId)) return;
  return { kind: "customer" as const, locations: [
    { ...PARTY_FIELD, name: "Main Block", country: "Tanzania", isDefault: true },
    { ...PARTY_FIELD, country: "Tanzania", isDefault: false, defaultSoilTemperatureC: PARTY_SOIL_TEMPERATURE_C },
  ], order: caseId === "customer-location-in-use" || caseId === "order-archived-destination", archive: caseId === "order-archived-destination" };
}
