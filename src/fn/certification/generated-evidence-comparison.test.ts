import { beforeEach, expect, it, vi } from "vitest";
import type { TransportLeg } from "@/db/schema";
import { getSentRemovalForComparison } from "@/data-access/removal-entry-correction";
import { generatedEvidenceFacts, compareGeneratedEvidenceFacts } from "./generated-evidence-facts";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { changedGeneratedEvidence } from "./generated-evidence-comparison";
import { stableLedgerContentHash, transportLedgerModel } from "./evidence-ledger-models";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";

vi.mock("@/data-access/removal-entry-correction", () => ({ getSentRemovalForComparison: vi.fn() }));
const org = makeTestOrgContext();
function context(): RemovalSubmissionContext {
  const leg = (id: string, distanceKm: number) => ({ id, entityType: "feedstock", entityId: id,
    originName: "Origin", destinationName: "Facility", distanceKm, loadMassKg: 1000,
    distanceSource: "map_estimate", transportMethodType: "road", vehicleType: "Truck", calculationMethodType: "distance_based",
  }) as TransportLeg;
  return { mapping: { externalProjectId: "project" }, memberBatches: [{ id: "batch", code: "CB-1" }],
    transportLegs: { feedstock: [leg("a", 5), leg("b", 15)], biochar: [], sample: [] }, batchesWithSamples: [],
  } as unknown as RemovalSubmissionContext;
}
beforeEach(() => vi.resetAllMocks());
async function comparison(changed: boolean) {
  const ctx = context();
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { generatedEvidenceFacts: generatedEvidenceFacts(ctx) } } as never);
  const before = transportLedgerModel(ctx, "Facility", "first");
  if (changed) { ctx.transportLegs.feedstock[0].distanceKm = 10; ctx.transportLegs.feedstock[1].distanceKm = 10; }
  const after = transportLedgerModel(ctx, "Facility", "later");
  expect(after.categories[0].subtotalTkm).toBe(before.categories[0].subtotalTkm);
  const differences = await changedGeneratedEvidence(org, "removal", ctx);
  return { before, after, differences, state: deriveRemovalSemanticCorrection({ windowOpen: true, previous: {},
    current: differences.length ? { changedGeneratedEvidence: differences } : {}, previousEntries: [], currentEntries: [], componentIds: [], batchIds: ["batch"] }) };
}
it("detects per-leg changes even when the submitted transport total stays equal", async () => {
  const result = await comparison(true);
  expect(result.differences).toHaveLength(1);
  expect(result.state.correctionNeeded).toBe(true);
});
it("keeps unchanged ledger inputs unchanged, independent of rendering time", async () => {
  const result = await comparison(false);
  expect(result.differences).toEqual([]);
  expect(result.state.correctionNeeded).toBe(false);
  expect(stableLedgerContentHash(result.before)).toBe(stableLedgerContentHash(result.after));
});

it("does not treat missing historical raw facts as changed", async () => {
  const ctx = context();
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), undefined)).toEqual({ status: "unknown", changed: [] });
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {} } } as never);
  expect(await changedGeneratedEvidence(org, "removal", ctx)).toEqual([]);
});
it("ignores names, GPS, vehicle labels, ordering and render code", () => {
  const ctx = context();
  const baseline = generatedEvidenceFacts(ctx);
  ctx.memberBatches[0].code = "renamed";
  ctx.transportLegs.feedstock.reverse();
  for (const leg of ctx.transportLegs.feedstock) {
    leg.originName = "renamed"; leg.vehicleType = "different label"; leg.originGpsLatitude = 12;
  }
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("unchanged");
});
it("detects removal, addition, method and category changes", () => {
  for (const change of [
    (ctx: RemovalSubmissionContext) => { ctx.transportLegs.feedstock.pop(); },
    (ctx: RemovalSubmissionContext) => { ctx.transportLegs.feedstock[0].transportMethodType = "rail"; },
    (ctx: RemovalSubmissionContext) => { ctx.transportLegs.sample.push(ctx.transportLegs.feedstock.pop()!); },
  ]) {
    const ctx = context(); const baseline = generatedEvidenceFacts(ctx); change(ctx);
    expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("changed");
  }
});
it("compares the applicable measured chemistry and attributed product mass", () => {
  const ctx = context();
  ctx.attributionByRunId = new Map([["run", 0.5]]);
  ctx.batchesWithSamples = [{ creditBatchId: "batch", durabilityOption: "1000_year", creditBatchCode: "CB-1",
    samples: [{ id: "sample", hToCOrgRatio: 0.4, oToCOrgRatio: 0.1, totalCarbonPercent: 80,
      organicCarbonPercent: 78, inorganicCarbonPercent: 2, sReflectanceFraction: 0.5, randomReflectanceR0Percent: 3 }],
    runs: [{ id: "run", biocharDryMassKg: 100 }],
  }] as never;
  const baseline = generatedEvidenceFacts(ctx);
  ctx.batchesWithSamples[0].creditBatchCode = "renamed";
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("unchanged");
  ctx.batchesWithSamples[0].samples[0].sReflectanceFraction = 0.6;
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("changed");
  ctx.batchesWithSamples[0].samples[0].sReflectanceFraction = 0.5;
  ctx.attributionByRunId.set("run", 0.6);
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("changed");
});

it("compares the frozen facts independently of duplicate or newer active ledger documents", async () => {
  const ctx = context();
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: {
    generatedEvidenceFacts: generatedEvidenceFacts(ctx),
    semantic: { candidateSources: [{ documentId: "matching" }, { documentId: "other" }] },
  } } as never);
  expect(await changedGeneratedEvidence(org, "removal", ctx)).toEqual([]);
});
it("makes member-code ledger order deterministic while preserving already sorted content", () => {
  const ctx = context();
  ctx.memberBatches.push({ ...ctx.memberBatches[0], id: "batch-z", code: "CB-2" });
  const before = transportLedgerModel(ctx, "Facility", "first");
  ctx.memberBatches.reverse();
  const after = transportLedgerModel(ctx, "Facility", "later");
  expect(after.memberBatchCodes).toBe("CB-1 · CB-2");
  expect(stableLedgerContentHash(after)).toBe(stableLedgerContentHash(before));
});

it("ignores replacement transport identities and calculation methods in the same ledger row", () => {
  const ctx = context();
  ctx.transportLegs.feedstock[0].createdAt = new Date("2026-01-01");
  ctx.transportLegs.feedstock[1].createdAt = new Date("2026-01-02");
  const baseline = generatedEvidenceFacts(ctx);
  ctx.transportLegs.feedstock[0] = { ...ctx.transportLegs.feedstock[0], id: "replacement", entityId: "new-owner",
    calculationMethodType: "distance_based" };
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("unchanged");
});

it.each(["200_year", "1000_year"] as const)("ignores R0 and unused chemistry for %s", tier => {
  const ctx = context();
  ctx.attributionByRunId = new Map();
  ctx.facilityReferenceSoilTemperature = { declaredSoilTemperatureC: 20, effectiveSoilTemperatureC: 20,
    temperatureFloored: false, source: "facility_reference", method: "declared", warnings: [] };
  ctx.batchesWithSamples = [{ creditBatchId: "batch", creditBatchCode: "CB-1", durabilityOption: tier,
    samples: [{ id: "sample", hToCOrgRatio: 0.4, oToCOrgRatio: 0.1, totalCarbonPercent: 80,
      organicCarbonPercent: 78, inorganicCarbonPercent: 2, sReflectanceFraction: 0.5, randomReflectanceR0Percent: 3 }],
    runs: [{ id: "run", biocharDryMassKg: 100 }],
  }] as never;
  const baseline = generatedEvidenceFacts(ctx);
  expect(baseline.durability).not.toBeNull();
  const sample = ctx.batchesWithSamples[0].samples[0];
  sample.randomReflectanceR0Percent = 4;
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("unchanged");
  if (tier === "200_year") sample.sReflectanceFraction = 0.9;
  else {
    sample.hToCOrgRatio = 0.6;
    sample.oToCOrgRatio = 0.2;
    sample.organicCarbonPercent = 70;
    ctx.facilityReferenceSoilTemperature!.declaredSoilTemperatureC = 25;
  }
  expect(compareGeneratedEvidenceFacts(generatedEvidenceFacts(ctx), baseline).status).toBe("unchanged");
});
