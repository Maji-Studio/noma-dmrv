import { beforeEach, expect, it, vi } from "vitest";
import type { RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { collectCandidateSourceDocumentsForRemoval, loadCandidateDocumentsForRemovalForUser } from "./source-candidates";

const mocks = vi.hoisted(() => ({ documents: vi.fn(), contributions: vi.fn() }));
vi.mock("@/data-access/documents", () => ({ listDocumentsForEntity: mocks.documents }));
vi.mock("./emission-entry-source-context", () => ({ loadEntrySourceContributions: mocks.contributions }));
vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: vi.fn(async () => ({ facilityId: "facility" })),
  getCreditBatchesByRemovalId: vi.fn(async () => []),
}));
vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: vi.fn(async () => null) }));
vi.mock("@/data-access/certifier-document-uploads", () => ({ listDocumentUploadsForDocuments: vi.fn(async () => []) }));
const ctx = makeTestOrgContext();
const contributions: RemovalEntryContributions = {
  manifest: [{ componentId: "component", inputKey: "energy", entries: [{ entryId: "entry", creditBatchId: "batch",
    contentRevision: 3, kind: "value", value: { magnitude: "2", unit: "kWh" }, evidenceDocumentIds: ["frozen-file"] }] }],
  entrySet: [{ entryId: "entry", contentRevision: 3 }], inputs: [], selectedEntryIds: ["entry"], sentSingleComponentIds: [], blockers: [],
};
const collect = (entryContributions = contributions) => collectCandidateSourceDocumentsForRemoval(ctx, {
  removalId: "removal", lineages: [], entryContributions,
});
beforeEach(() => vi.clearAllMocks());
it("reads org-scoped entry documents and binds only IDs in the manifest on every retry", async () => {
  mocks.documents.mockResolvedValue([{ id: "frozen-file", uploadStatus: "uploaded" }, { id: "later-file", uploadStatus: "uploaded" }]);
  const first = await collect();
  mocks.documents.mockResolvedValue([{ id: "another-later-file", uploadStatus: "uploaded" }, { id: "frozen-file", uploadStatus: "uploaded" }]);
  expect(await collect()).toEqual(first);
  expect(first.map((candidate) => candidate.documentId)).toEqual(["frozen-file"]);
  expect(mocks.documents).toHaveBeenCalledWith(ctx, "emission_entry", "entry");
});
it("fails closed when a manifest file is absent or not uploaded", async () => {
  mocks.documents.mockResolvedValue([]);
  await expect(collect()).rejects.toThrow(/file is unavailable/);
  mocks.documents.mockResolvedValue([{ id: "frozen-file", uploadStatus: "pending" }]);
  await expect(collect()).rejects.toThrow(/file is unavailable/);
});
it("does not walk entries absent from the contribution manifest", async () => {
  expect(await collect({ ...contributions, manifest: [], entrySet: [] })).toEqual([]);
  expect(mocks.documents).not.toHaveBeenCalled();
});

it("exposes the same manifest-bound file to the Source mirroring authorization path", async () => {
  mocks.contributions.mockResolvedValue(contributions);
  mocks.documents.mockResolvedValue([{ id: "frozen-file", fileName: "Evidence.pdf", uploadStatus: "uploaded" }]);
  const result = await loadCandidateDocumentsForRemovalForUser(ctx, "removal");
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ document: { id: "frozen-file" },
    lineageEntity: { entityType: "emission_entry", entityId: "entry" },
    binding: { nomaRole: "emission_entry", intendedTarget: { kind: "explicit", componentId: "component", inputKey: "energy" } },
  });
});
