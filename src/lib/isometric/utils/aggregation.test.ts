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
  it("returns null distance and no warning for an empty leg list", () => {
    const result = aggregateTransportLegs([], "Feedstock");

    expect(result.distanceKm).toBeNull();
    expect(result.warning).toBeNull();
  });

  it("mass-weights distance across legs with valid mass", () => {
    const result = aggregateTransportLegs(
      [
        leg("00000000-0000-0000-0000-000000000001", {
          distanceKm: 100,
          loadMassKg: 50,
        }),
        leg("00000000-0000-0000-0000-000000000002", {
          distanceKm: 200,
          loadMassKg: 100,
        }),
      ],
      "Feedstock",
    );

    // (100*50 + 200*100) / (50 + 100) = 166.67
    expect(result.distanceKm).toBeCloseTo(166.67, 1);
    expect(result.warning).toBeNull();
  });

  it("returns null and names a single leg missing load mass", () => {
    const result = aggregateTransportLegs(
      [leg("00000000-0000-0000-0000-000000000003", { loadMassKg: null })],
      "Feedstock",
    );

    expect(result.distanceKm).toBeNull();
    expect(result.warning).toContain("00000000-0000-0000-0000-000000000003");
  });

  it("returns null and warns when legs mix factor fields", () => {
    const result = aggregateTransportLegs(
      [
        leg("00000000-0000-0000-0000-000000000004", { modelYear: null }),
        leg("00000000-0000-0000-0000-000000000005", { modelYear: 2020 }),
      ],
      "Feedstock",
    );

    expect(result.distanceKm).toBeNull();
    expect(result.warning).toContain("mix factor");
  });

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
