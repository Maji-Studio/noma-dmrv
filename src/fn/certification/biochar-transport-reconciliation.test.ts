import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";
import { buildLedgerModel } from "@/lib/certification/evidence-ledger/build-model";
import { aggregateProductionRuns, enrichWithTransportLegs, type ProductionRunWithSamples } from "@/lib/isometric";
import { buildRemovalLedgerPreview } from "./removal-ledger-preview";

const run = {
  id: "run-1", code: "PR-1", biocharDryMassKg: 100, feedstockMassDryKg: 200,
  dieselOperationLiters: 0, dieselGensetLiters: 0, preprocessingFuelLiters: 0, electricityKwh: 0,
  startTime: new Date("2026-01-01"), endTime: new Date("2026-01-02"), samples: [],
} as unknown as ProductionRunWithSamples;
const metadata = {
  memberBatchCodes: "CB-1", facilityName: "Facility", externalProjectId: null,
  generatedAtIso: "2026-01-03T00:00:00.000Z",
};

describe("biochar transport reconciliation", () => {
  it.each([
    { loads: [[25, 10]], expected: 0.5 },
    { loads: [[25, 10], [40, 30]], expected: 2.9 },
  ])("reconciles submission, preview and evidence at $expected tonne-km", ({ loads, expected }) => {
    const biochar = loads.map(([loadMassKg, distanceKm], index) => ({
      id: `delivery-${index}`, entityId: `delivery-${index}`, entityType: "biochar",
      loadMassKg, distanceKm, transportMethodType: "road", calculationMethodType: "distance_based",
      originName: "Facility", destinationName: `Delivery ${index}`, isDerived: true,
    })) as TransportLeg[];
    const transportLegs = { feedstock: [], biochar, sample: [] };
    const attributionByRunId = new Map([[run.id, 0.25]]);
    const submitted = enrichWithTransportLegs(aggregateProductionRuns([run], attributionByRunId), transportLegs);
    const preview = buildRemovalLedgerPreview({
      removalId: "removal-1", memberBatchClaims: [], runs: [run], lineages: [],
      transportLegs, attributionByRunId,
      runSummary: { runCount: 1, totalBiocharOutputKg: 100, appliedDryKg: 25 },
      requiredTransportCategories: ["biochar"],
    });
    const ledger = buildLedgerModel({ ...metadata, legsByCategory: transportLegs });
    expect(submitted.biocharTransportMassDistanceTonneKm).toBe(expected);
    expect(preview.inputs.find(input => input.id === "biochar-transport")?.magnitude).toBe(expected);
    expect(ledger.categories[1].subtotalTkm).toBe(expected);
    expect(ledger.categories[1].legs.map(leg => leg.loadMassKg)).toEqual(loads.map(([mass]) => mass));
  });
});
