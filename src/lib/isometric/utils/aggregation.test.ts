import { describe, expect, it } from "vitest";
import { TEST_ORG_ID } from "../../../../tests/helpers/test-org";

import type { TransportLeg } from "@/db/schema";
import {
  aggregateProductionRuns,
  aggregateTransportMassDistance,
  type ProductionRunWithSamples,
} from "./aggregation";

function leg(
  id: string,
  overrides: Partial<TransportLeg> = {},
): TransportLeg {
  return {
    organizationId: TEST_ORG_ID,
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
    distanceSource: null,
    transportMethodType: "road",
    vehicleType: "truck",
    modelYear: null,
    loadMassKg: 100,
    tripType: "return",
    calculationMethodType: "distance_based",
    isDerived: false,
    billOfLading: null,
    weighScaleTicketRef: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("aggregateTransportMassDistance", () => {
  it("returns null mass-distance and no warning for an empty leg list", () => {
    const result = aggregateTransportMassDistance([], "Feedstock");

    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toBeNull();
  });

  it("sums Σ(distance × load-mass in tonnes) across one-way legs", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000001", {
          distanceKm: 100,
          loadMassKg: 50,
          tripType: "one_way",
        }),
        leg("00000000-0000-0000-0000-000000000002", {
          distanceKm: 200,
          loadMassKg: 100,
          tripType: "one_way",
        }),
      ],
      "Feedstock",
    );

    // 100 km × 0.05 t + 200 km × 0.1 t = 5 + 20 = 25 t·km (no ×2)
    expect(result.massDistanceTonneKm).toBeCloseTo(25, 6);
    expect(result.warning).toBeNull();
  });

  // Isometric's transport component applies its own round-trip treatment, so
  // noma sends the entered distance once (2026-08-14, superseding #316 §4.2).
  // Re-introducing a local ×2 here double-counts the empty return.
  it("does not double the distance of a Return leg", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000001", {
          distanceKm: 100,
          loadMassKg: 50,
          tripType: "return",
        }),
      ],
      "Feedstock",
    );

    // 100 km × 0.05 t = 5 t·km
    expect(result.massDistanceTonneKm).toBeCloseTo(5, 6);
    expect(result.warning).toBeNull();
  });

  it("treats a null trip type the same as any other", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000001", {
          distanceKm: 100,
          loadMassKg: 50,
          tripType: null as unknown as TransportLeg["tripType"],
        }),
      ],
      "Feedstock",
    );

    // 100 km × 0.05 t = 5 t·km
    expect(result.massDistanceTonneKm).toBeCloseTo(5, 6);
  });

  it("sums mixed Return and one-way legs without weighting either", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000001", {
          distanceKm: 100,
          loadMassKg: 50,
          tripType: "return",
        }),
        leg("00000000-0000-0000-0000-000000000002", {
          distanceKm: 200,
          loadMassKg: 100,
          tripType: "one_way",
        }),
      ],
      "Feedstock",
    );

    // 100×0.05 + 200×0.1 = 5 + 20 = 25 t·km
    expect(result.massDistanceTonneKm).toBeCloseTo(25, 6);
    expect(result.warning).toBeNull();
  });

  it("returns null and names a single leg missing load mass", () => {
    const result = aggregateTransportMassDistance(
      [leg("00000000-0000-0000-0000-000000000003", { loadMassKg: null })],
      "Feedstock",
    );

    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toContain("00000000-0000-0000-0000-000000000003");
  });

  it("identifies a leg missing load mass by its named route", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000003", {
          originName: "Farm A",
          destinationName: "Plant Gate",
          loadMassKg: null,
        }),
      ],
      "Feedstock",
    );

    expect(result.warning).toContain("Farm A to Plant Gate");
  });

  it("returns null and warns when legs mix factor fields", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000004", { modelYear: null }),
        leg("00000000-0000-0000-0000-000000000005", { modelYear: 2020 }),
      ],
      "Feedstock",
    );

    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toContain("mix factor");
  });

  it("reports all legs missing load mass in one warning", () => {
    const result = aggregateTransportMassDistance(
      [
        leg("00000000-0000-0000-0000-000000000001", { loadMassKg: null }),
        leg("00000000-0000-0000-0000-000000000002", { loadMassKg: 0 }),
      ],
      "Feedstock",
    );

    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toContain(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result.warning).toContain(
      "00000000-0000-0000-0000-000000000002",
    );
  });
});

describe("aggregateProductionRuns production claims", () => {
  it("keeps stored mass from every run but includes production inputs only once", () => {
    const run = (
      id: string,
      feedstockMassDryKg: number,
      dieselOperationLiters: number,
    ) =>
      ({
        id,
        code: id,
        startTime: new Date("2026-01-01T08:00:00Z"),
        endTime: new Date("2026-01-01T12:00:00Z"),
        biocharDryMassKg: 100,
        feedstockMassDryKg,
        dieselOperationLiters,
        dieselGensetLiters: 0,
        preprocessingFuelLiters: 0,
        electricityKwh: 10,
        samples: [],
      }) as unknown as ProductionRunWithSamples;

    const result = aggregateProductionRuns(
      [run("run-a", 500, 5), run("run-b", 700, 7)],
      new Map([
        ["run-a", 0.5],
        ["run-b", 0.25],
      ]),
      { productionRunIds: new Set(["run-b"]) },
    );

    expect(result.totalBiocharDryMassKg).toBe(75);
    expect(result.totalFeedstockDryMassKg).toBe(700);
    expect(result.totalStartupDieselLitres).toBe(7);
    expect(result.totalElectricityKwh).toBe(10);
  });

  it("counts an unapplied member run in production while its stored mass stays zero", () => {
    const run = (id: string, biocharDryMassKg: number, feedstockMassDryKg: number) =>
      ({
        id,
        code: id,
        startTime: new Date("2026-01-01T08:00:00Z"),
        endTime: new Date("2026-01-01T12:00:00Z"),
        biocharDryMassKg,
        feedstockMassDryKg,
        dieselOperationLiters: 1,
        dieselGensetLiters: 0,
        preprocessingFuelLiters: 0,
        electricityKwh: 2,
        samples: [],
      }) as unknown as ProductionRunWithSamples;

    const result = aggregateProductionRuns(
      [run("run-applied", 100, 500), run("run-unapplied", 200, 700)],
      new Map([
        ["run-applied", 0.5],
        ["run-unapplied", 0],
      ]),
      { productionRunIds: new Set(["run-applied", "run-unapplied"]) },
    );

    expect(result.totalBiocharDryMassKg).toBe(50);
    expect(result.totalFeedstockDryMassKg).toBe(1_200);
    expect(result.totalStartupDieselLitres).toBe(2);
    expect(result.totalElectricityKwh).toBe(4);
  });
});
