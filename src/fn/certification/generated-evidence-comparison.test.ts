import { beforeEach, expect, it, vi } from "vitest";
import type { TransportLeg } from "@/db/schema";
import { listDocumentsByKindForRemoval } from "@/data-access/documents";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { changedGeneratedEvidence, currentEvidenceLedgerHashes } from "./generated-evidence-comparison";
import { stableLedgerContentHash, transportLedgerModel } from "./evidence-ledger-models";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";

vi.mock("@/data-access/documents", () => ({ listDocumentsByKindForRemoval: vi.fn() }));
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
  const hashes = currentEvidenceLedgerHashes(ctx, "Facility");
  vi.mocked(listDocumentsByKindForRemoval).mockImplementation(async (_ctx, kind) => {
    const hash = hashes.find(item => item.kind === kind)?.hash;
    return hash ? [{ metadata: { contentHash: hash } }] as never : [];
  });
  const before = transportLedgerModel(ctx, "Facility", "first");
  if (changed) { ctx.transportLegs.feedstock[0].distanceKm = 10; ctx.transportLegs.feedstock[1].distanceKm = 10; }
  const after = transportLedgerModel(ctx, "Facility", "later");
  expect(after.categories[0].subtotalTkm).toBe(before.categories[0].subtotalTkm);
  const differences = await changedGeneratedEvidence(org, "removal", ctx, "Facility");
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
