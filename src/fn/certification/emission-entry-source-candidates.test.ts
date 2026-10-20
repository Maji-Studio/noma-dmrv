import { beforeEach, expect, it, vi } from "vitest";
import type { RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { collectCandidateSourceDocumentsForRemoval, loadCandidateDocumentsForRemovalForUser } from "./source-candidates";

const mocks = vi.hoisted(() => ({ documents: vi.fn(), contributions: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/log")>();
  return { ...actual, logger: { ...actual.logger, warn: mocks.warn } };
});
vi.mock("@/data-access/documents", () => ({ listEmissionEntryDocumentsByIds: mocks.documents, listDocumentsForEntity: vi.fn() }));
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
  mocks.documents.mockResolvedValue([{ id: "frozen-file", entityId: "entry", uploadStatus: "uploaded" }, { id: "later-file", uploadStatus: "uploaded" }]);
  const first = await collect();
  mocks.documents.mockResolvedValue([{ id: "another-later-file", uploadStatus: "uploaded" }, { id: "frozen-file", entityId: "entry", uploadStatus: "uploaded" }]);
  expect(await collect()).toEqual(first);
  expect(first.map((candidate) => candidate.documentId)).toEqual(["frozen-file"]);
  expect(mocks.documents).toHaveBeenCalledWith(ctx, ["entry"], ["frozen-file"]);
});
it("fails closed when a manifest file is absent or not uploaded", async () => {
  mocks.documents.mockResolvedValue([]);
  await expect(collect()).rejects.toThrow(/file is unavailable/);
  mocks.documents.mockResolvedValue([{ id: "frozen-file", entityId: "entry", uploadStatus: "pending" }]);
  await expect(collect()).rejects.toThrow(/file is unavailable/);
});
it("does not walk entries absent from the contribution manifest", async () => {
  expect(await collect({ ...contributions, manifest: [], entrySet: [] })).toEqual([]);
  expect(mocks.documents).not.toHaveBeenCalled();
});

it("exposes the same manifest-bound file to the Source mirroring authorization path", async () => {
  mocks.contributions.mockResolvedValue(contributions);
  mocks.documents.mockResolvedValue([{ id: "frozen-file", entityId: "entry", fileName: "Evidence.pdf", uploadStatus: "uploaded" }]);
  const result = await loadCandidateDocumentsForRemovalForUser(ctx, "removal");
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ document: { id: "frozen-file" },
    lineageEntity: { entityType: "emission_entry", entityId: "entry" },
    binding: { nomaRole: "emission_entry", intendedTarget: { kind: "explicit", componentId: "component", inputKey: "energy" } },
  });
});

it("loads multiple entries in one manifest-id query", async () => {
  const multiple = structuredClone(contributions);
  multiple.manifest[0].entries.push({ ...multiple.manifest[0].entries[0], entryId: "second-entry", evidenceDocumentIds: ["second-file"] });
  multiple.entrySet.push({ entryId: "second-entry", contentRevision: 3 });
  mocks.documents.mockResolvedValue([{ id: "frozen-file", entityId: "entry", uploadStatus: "uploaded" },
    { id: "second-file", entityId: "second-entry", uploadStatus: "uploaded" }]);
  expect(await collect(multiple)).toHaveLength(2);
  expect(mocks.documents).toHaveBeenCalledExactlyOnceWith(ctx, ["entry", "second-entry"], ["frozen-file", "second-file"]);
});
it("refuses a document belonging to a different manifest entry and logs only identifiers", async () => {
  mocks.documents.mockResolvedValue([{ id: "frozen-file", entityId: "different-entry", uploadStatus: "uploaded" }]);
  await expect(collect()).rejects.toThrow("An emissions entry file is unavailable. Refresh the Removal and submit again.");
  expect(mocks.warn).toHaveBeenCalledWith({ removalId: "removal", documentId: "frozen-file", entryId: "entry",
    targets: [{ componentId: "component", inputKey: "energy" }],
  }, expect.any(String));
});
