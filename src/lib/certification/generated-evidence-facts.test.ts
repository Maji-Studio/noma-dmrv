import { expect, it } from "vitest";
import type { Sample, TransportLeg } from "@/db/schema";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { generatedEvidenceFacts } from "./generated-evidence-facts";
import { durabilityLedgerModel, stableLedgerContentHash, transportLedgerModel } from "./evidence-ledger-models";

function context(tier: "200_year" | "1000_year"): RemovalSubmissionContext {
  const leg = (id: string, distanceKm: number, loadMassKg: number | null, transportMethodType: string, createdAt?: string) => ({
    id, distanceKm, loadMassKg, transportMethodType, createdAt: createdAt ? new Date(createdAt) : null,
    originName: "Origin", destinationName: "Destination", distanceSource: "manual",
  }) as TransportLeg;
  const sample = (id: string, values: Partial<Sample>) => ({ id, sampleCode: id,
    samplingTime: new Date("2026-01-15T22:30:00.000Z"), labName: "Lab",
    hToCOrgRatio: null, oToCOrgRatio: null, totalCarbonPercent: null,
    inorganicCarbonPercent: null, organicCarbonPercent: null, sReflectanceFraction: null,
    ...values,
  }) as Sample;
  return {
    mapping: { externalProjectId: "project" }, memberBatches: [{ id: "z", code: "CB-Z" }, { id: "a", code: "CB-A" }],
    transportLegs: {
      feedstock: [leg("z", 12.345, null, "road", "2026-01-02"), leg("a", 7.25, 1234, "rail", "2026-01-01")],
      biochar: [leg("z", 8.75, 250, "road"), leg("a", 2.5, 100, "road")],
      sample: [leg("z", 3.5, -1, ""), leg("a", 4.25, 2, "air")],
    },
    batchesWithSamples: [
      { creditBatchId: "z", creditBatchCode: "CB-Z", durabilityOption: tier, facilityTimezone: "Africa/Dar_es_Salaam",
        samples: [sample("z", { hToCOrgRatio: 0.4, oToCOrgRatio: 0.1, totalCarbonPercent: 80, organicCarbonPercent: 77, sReflectanceFraction: 0.7 }),
          sample("a", { hToCOrgRatio: 0.3, oToCOrgRatio: 0.2, totalCarbonPercent: 75, inorganicCarbonPercent: 2, organicCarbonPercent: 73, sReflectanceFraction: 0.6 }),
          sample("m", { totalCarbonPercent: 70, organicCarbonPercent: 68, inorganicCarbonPercent: 2 })],
        runs: [{ id: "z", biocharDryMassKg: 101 }, { id: "a", biocharDryMassKg: 37 }] },
      { creditBatchId: "m", creditBatchCode: "CB-M", durabilityOption: tier,
        samples: [sample("unusable", {})], runs: [{ id: "unused", biocharDryMassKg: 999 }] },
      { creditBatchId: "a", creditBatchCode: "CB-A", durabilityOption: tier,
        samples: [sample("b", { hToCOrgRatio: 0.5, totalCarbonPercent: 90, inorganicCarbonPercent: 3, sReflectanceFraction: 0.8 })],
        runs: [{ id: "other", biocharDryMassKg: 50 }] },
    ],
    attributionByRunId: new Map([["z", 0.25], ["a", 0.5], ["other", 0.75]]),
    facilityReferenceSoilTemperature: { declaredSoilTemperatureC: 6.5, effectiveSoilTemperatureC: 7,
      temperatureFloored: true, source: "Reference dataset", method: "declared", warnings: [] },
  } as unknown as RemovalSubmissionContext;
}

// Source-fact pins stay frozen; rendered-model pins include the owning organization.
it.each([
  ["200_year", "6728022445c054c6858c7a714fac47052b34fbdd3a28b462e080db83c5a74635", "1b7214372e1d942c09cc44ec6f9247721f94dd9a6778eae3131f53ebfe9b2efa"],
  ["1000_year", "571b6a6a8e44759fb9153158121b55db1400daf365fe95fd917f9800080aeeeb", "c110345ca85c513ac1592d1fef99a901eac0dec4e437d1195aee91e7dc96ee34"],
] as const)("preserves frozen fingerprints and ledger content for %s", (tier, durability, modelHash) => {
  const ctx = context(tier);
  expect(generatedEvidenceFacts(ctx)).toEqual({ format: "ledger-inputs-v2", transport: "cd977aea589d4819e58f092fdf33c74cdba4b62357c430d193666292a8209e41", durability });
  expect(stableLedgerContentHash(transportLedgerModel(ctx, "Facility", "2026-01-20", "Example Carbon"))).toBe("762a1802d960971a0d73699e495c5024a0be813f913f5c83c4d3bb4780524c9b");
  expect(stableLedgerContentHash(durabilityLedgerModel(ctx, "Facility", "2026-01-20", "Example Carbon").model)).toBe(modelHash);
});


it.each(["200_year", "1000_year"] as const)("invalidates rendered ledger hashes on an organization rename for %s", (tier) => {
  const ctx = context(tier);
  expect(stableLedgerContentHash(transportLedgerModel(ctx, "Facility", "first", "Example Carbon")))
    .not.toBe(stableLedgerContentHash(transportLedgerModel(ctx, "Facility", "later", "Another Operator")));
  expect(stableLedgerContentHash(durabilityLedgerModel(ctx, "Facility", "first", "Example Carbon").model))
    .not.toBe(stableLedgerContentHash(durabilityLedgerModel(ctx, "Facility", "later", "Another Operator").model));
});
