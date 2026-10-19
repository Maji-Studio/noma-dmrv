import { expect, it } from "vitest";
import type { ProductionRunForCertification, TransportLegsByCategory } from "@/lib/isometric/utils/aggregation";
import { batchAutomaticFigures } from "./batch-automatic-figures";
const emptyLegs: TransportLegsByCategory = { feedstock: [], biochar: [], sample: [] };
function run(values: Partial<ProductionRunForCertification>): ProductionRunForCertification {
  return { id: "run", code: "RUN", startTime: new Date("2026-10-01"), endTime: new Date("2026-10-02"), ...values } as ProductionRunForCertification;
}
it("keeps absent facts null, including sample transport, and recorded zero non-null", () => {
  const absent = batchAutomaticFigures([run({})], emptyLegs);
  expect(Object.values(absent).every((figure) => figure === null)).toBe(true);
  expect(batchAutomaticFigures([run({ electricityKwh: 0 })], emptyLegs)["run-electricity"]).toEqual({ magnitude: "0", unit: "kWh" });
  expect(Object.values(batchAutomaticFigures([], emptyLegs)).every((figure) => figure === null)).toBe(true);
});
it("includes all run values unscaled, including preprocessing in genset", () => {
  const figures = batchAutomaticFigures([
    run({ id: "applied", electricityKwh: 12, dieselOperationLiters: 2, dieselGensetLiters: 3, preprocessingFuelLiters: 4 }),
    run({ id: "unapplied", electricityKwh: 8, dieselOperationLiters: 5, dieselGensetLiters: 6, preprocessingFuelLiters: 7 }),
  ], emptyLegs);
  expect(figures["run-electricity"]).toEqual({ magnitude: "20", unit: "kWh" });
  expect(figures["run-startup-diesel"]).toEqual({ magnitude: "7", unit: "L" });
  expect(figures["run-genset-diesel"]).toEqual({ magnitude: "20", unit: "L" });
});

it("maps each transport category through the existing round-trip aggregators", () => {
  const leg: TransportLegsByCategory["feedstock"][number] = {
    id: "leg", entityId: "feedstock", entityType: "feedstock", organizationId: "org", version: 1,
    createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"),
    originGpsLatitude: null, originGpsLongitude: null, originName: null,
    destinationGpsLatitude: null, destinationGpsLongitude: null, destinationName: null,
    distanceSource: null, vehicleType: "truck", modelYear: null, isDerived: false,
    distanceKm: 10, loadMassKg: 1000, transportMethodType: "road", calculationMethodType: "distance_based",
  };
  const figures = batchAutomaticFigures([], { feedstock: [leg], biochar: [{ ...leg, distanceKm: 20 }], sample: [{ ...leg, loadMassKg: 10 }] });
  expect(figures["feedstock-transport"]).toEqual({ magnitude: "20", unit: "km * tonne" });
  expect(figures["delivery-transport"]).toEqual({ magnitude: "40", unit: "km * tonne" });
  expect(figures["sample-transport"]).toEqual({ magnitude: "0.2", unit: "km * tonne" });
});

it("preserves DB decimal text and never accumulates energy in floats", () => {
  const figures = batchAutomaticFigures([
    run({ id: "a", electricityKwh: 0.1 }), run({ id: "b", electricityKwh: 0.2 }),
  ], emptyLegs, {
    runs: {
      a: { feedstockMassDryKg: "9007199254740993.001", biocharDryMassKg: null },
      b: { feedstockMassDryKg: "0.002", biocharDryMassKg: null },
    },
    legs: {},
  });
  expect(figures["feedstock-dry-mass"]?.magnitude).toBe("9007199254740993.003");
  expect(figures["run-electricity"]?.magnitude).toBe("0.3");
});

it.each(["empty", "missing-mass", "mixed-mode", "biochar-zero-distance"])("matches submission transport availability for %s", async (scenario) => {
  const { aggregateTransportMassDistance, aggregateBiocharTransportMassDistance } = await import("@/lib/isometric/utils/aggregation");
  const base = {
    id: "one", distanceKm: 10, loadMassKg: 1000, transportMethodType: "road", calculationMethodType: "distance_based",
  } as TransportLegsByCategory["feedstock"][number];
  let legs = [base];
  if (scenario === "empty") legs = [];
  if (scenario === "missing-mass") legs = [{ ...base, loadMassKg: null }];
  if (scenario === "mixed-mode") legs.push({ ...base, id: "two", transportMethodType: "rail" });
  if (scenario === "biochar-zero-distance") legs = [{ ...base, distanceKm: 0 }];
  const figures = batchAutomaticFigures([], { feedstock: legs, biochar: legs, sample: legs });
  expect(figures["feedstock-transport"] === null).toBe(aggregateTransportMassDistance(legs, "Feedstock").massDistanceTonneKm === null);
  expect(figures["delivery-transport"] === null).toBe(aggregateBiocharTransportMassDistance(legs).massDistanceTonneKm === null);
});
