import { describe, expect, it } from "vitest";

import type { TransportLeg } from "@/db/schema";
import { aggregateTransportLegs } from "./aggregation";

function leg(
  id: string,
  overrides: Partial<TransportLeg> = {},
): TransportLeg {
  return {
    id,
    entityType: "feedstock",
    entityId: `00000000-0000-0000-0000-0000000000${id.slice(-2)}`,
    originGpsLatitude: null,
    originGpsLongitude: null,
    originName: null,
    destinationGpsLatitude: null,
    destinationGpsLongitude: null,
    destinationName: null,
    distanceKm: 10,
    transportMethodType: "road",
    vehicleType: "truck",
    modelYear: null,
    loadMassKg: 100,
    calculationMethodType: "distance_based",
    isDerived: false,
    billOfLading: null,
    weighScaleTicketRef: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("aggregateTransportLegs", () => {
  it("reports all legs missing load mass in one warning", () => {
    const result = aggregateTransportLegs(
      [
        leg("00000000-0000-0000-0000-000000000001", { loadMassKg: null }),
        leg("00000000-0000-0000-0000-000000000002", { loadMassKg: 0 }),
      ],
      "Feedstock",
    );

    expect(result.distanceKm).toBeNull();
    expect(result.warning).toContain(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result.warning).toContain(
      "00000000-0000-0000-0000-000000000002",
    );
  });
});
