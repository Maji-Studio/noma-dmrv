import { beforeEach, expect, it, vi } from "vitest";
import { loadRemovalCarriedEntries } from "./removal-carried-entries";
import { getCreditBatchesByRemovalId, getCertifierRemovalById } from "./certifier-removals";
import { getSentRemovalForComparison } from "./removal-entry-correction";
import { loadDraftRemovalCarriedEntries } from "./removal-draft-carried-entries";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import { readRecordLockLineage } from "./record-lock-lineage";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ select: vi.fn(), members: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, selectDistinct: mocks.members } }));
vi.mock("./certifier-removals", () => ({ getCertifierRemovalById: vi.fn(), getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("./emission-entry-carry", () => ({ loadFacilityEmissionEntryCarry: vi.fn() }));
vi.mock("./record-lock-lineage", () => ({ readRecordLockLineage: vi.fn() }));
vi.mock("./removal-entry-correction", () => ({ getSentRemovalForComparison: vi.fn() }));
vi.mock("./removal-draft-carried-entries", () => ({ loadDraftRemovalCarriedEntries: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getTemplateObservationById: vi.fn() }));
vi.mock("./removal-codes", () => ({ getRemovalCodes: vi.fn(async () => new Map()) }));
const ctx = makeTestOrgContext();
const query = (rows: object[]) => ({ from: () => ({ where: async () => rows }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([]);
  vi.mocked(loadFacilityEmissionEntryCarry).mockResolvedValue({ entries: [], contenders: [], ownContenders: [], batches: [] });
  mocks.members.mockReturnValue(query([{ id: "member" }]));
  mocks.select.mockReturnValue(query([{ id: "origin", code: "CB-origin" }]));
  vi.mocked(getCertifierRemovalById).mockResolvedValue({ id: "removal", facilityId: "facility" } as never);
  vi.mocked(getSentRemovalForComparison).mockResolvedValue(null);
  vi.mocked(readRecordLockLineage).mockResolvedValue([returnedLineage("FAILED_VERIFICATION")]);
});
function returnedLineage(status: string | null, submittedToVerifier = status === "FAILED_VERIFICATION") {
  return { id: "removal", submissions: [{ id: "sent", externalId: "ext", status: "submitted", submittedAt: "2026-10-01T00:00:00.000Z", inFlight: false }],
    statements: [{ id: "statement", status, submittedToVerifier, fresh: false, removalExternalIds: ["ext"], returnedAt: "2026-10-02T00:00:00.000Z" }] } as never;
}
it("refuses a Removal outside the authenticated organization's visible records", async () => {
  vi.mocked(getCertifierRemovalById).mockResolvedValue(null);
  await expect(loadRemovalCarriedEntries(ctx, "foreign")).rejects.toThrow("Removal was not found.");
  expect(getCertifierRemovalById).toHaveBeenCalledExactlyOnceWith(ctx, "foreign");
  expect(mocks.members).not.toHaveBeenCalled();
  expect(loadDraftRemovalCarriedEntries).not.toHaveBeenCalled();
});
it("uses the entry-only draft selector", async () => {
  vi.mocked(loadDraftRemovalCarriedEntries).mockResolvedValue([]);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual({ facilityId: "facility", carriedEntries: [], lateEntries: [] });
  expect(loadDraftRemovalCarriedEntries).toHaveBeenCalledExactlyOnceWith(ctx, "removal", "facility");
  expect(getCreditBatchesByRemovalId).not.toHaveBeenCalled();
  expect(loadFacilityEmissionEntryCarry).not.toHaveBeenCalled();
});
it("reads exactly the frozen carried list independently of present membership", async () => {
  const entry = { entryId: "carried", creditBatchId: "origin", occurredOn: "2026-10-01", contentRevision: 1,
    kind: "value", value: { magnitude: "12", unit: "kWh" }, evidenceDocumentIds: ["file"] };
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {
    carriedEntries: [{ ...entry, componentId: "line" }],
    entryContributions: [{ componentId: "line", componentDisplayName: "Electricity", inputKey: "energy",
      entries: [entry, { ...entry, entryId: "own", creditBatchId: "member" }] }],
  } } } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual({ facilityId: "facility", lateEntries: [], carriedEntries: [expect.objectContaining({ entryId: "carried",
    creditBatchId: "origin", creditBatchCode: "CB-origin", occurredOn: "2026-10-01", value: entry.value, evidenceDocumentIds: ["file"] })] });
  expect(loadDraftRemovalCarriedEntries).not.toHaveBeenCalled();
});
it("does not silently substitute live entries for a corrupt sent snapshot", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: { carriedEntries: "bad" } } } as never);
  await expect(loadRemovalCarriedEntries(ctx, "removal")).rejects.toThrow("saved emissions entry set");
  expect(loadDraftRemovalCarriedEntries).not.toHaveBeenCalled();
});

it("returns empty for older snapshots without the optional carried list", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {} } } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual({ facilityId: "facility", carriedEntries: [], lateEntries: [] });
});
it("keeps frozen values when display records or optional labels are missing", async () => {
  mocks.select.mockReturnValue(query([]));
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: { carriedEntries: [{
    entryId: "entry", creditBatchId: "gone", componentId: "line", occurredOn: "2026-10-01",
    value: { magnitude: "12", unit: "kWh" }, evidenceDocumentIds: ["frozen-file"],
  }] } } } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual({ facilityId: "facility", lateEntries: [], carriedEntries: [expect.objectContaining({
    creditBatchCode: "gone", value: { magnitude: "12", unit: "kWh" }, evidenceDocumentIds: ["frozen-file"],
  })] });
});

it("reads only member entries assigned to this revision even when the sent carried list is empty", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {} } } as never);
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([{ id: "member" }] as never);
  const entry = { id: "late", creditBatchId: "member", creditBatchCode: "CB-009", componentId: "line",
    occurredOn: "2026-09-14", total: { magnitude: "120", unit: "L" }, values: [{ inputKey: "diesel", magnitude: "120", unit: "L" }], evidenceDocumentIds: ["b", "a"],
    earlierRemovalId: "removal", earlierRemovalCode: "RM-009", revisionOf: { removalId: "removal", removalCode: "RM-009" },
    entryObservation: { enrichment: {}, definition: { groups: [{ components: [{ id: "line", displayName: "Diesel from saved template" }] }] },
      lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } } };
  vi.mocked(loadFacilityEmissionEntryCarry).mockResolvedValue({ entries: [entry,
    { ...entry, id: "other-revision", revisionOf: { removalId: "other", removalCode: "RM-other" } },
    { ...entry, id: "foreign-member", creditBatchId: "other" }, { ...entry, id: "waiting", revisionOf: null },
  ], contenders: [], ownContenders: [], batches: [] } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual({ facilityId: "facility", carriedEntries: [], lateEntries: [{
    entryId: "late", creditBatchId: "member", creditBatchCode: "CB-009", componentId: "line",
    componentName: "Diesel from saved template", occurredOn: "2026-09-14", value: { magnitude: "120", unit: "L" },
    evidenceDocumentIds: ["a", "b"], earlierRemovalId: "removal", earlierRemovalCode: "RM-009",
  }] });
  expect(loadFacilityEmissionEntryCarry).toHaveBeenCalledExactlyOnceWith(ctx, "facility", undefined, undefined, { ownedBatchIds: ["member"] });
  expect(getCreditBatchesByRemovalId).toHaveBeenCalledExactlyOnceWith(ctx, "removal");
  expect(entry.evidenceDocumentIds).toEqual(["b", "a"]);
});

it("lists a paired-input late entry with every value (#1417)", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {} } } as never);
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([{ id: "member" }] as never);
  const entry = { id: "pair", creditBatchId: "member", creditBatchCode: "CB-009", componentId: "line", occurredOn: "2026-09-14",
    total: null, values: [{ inputKey: "volume", magnitude: "40", unit: "L" }, { inputKey: "density", magnitude: "0.85", unit: "kg/L" }],
    evidenceDocumentIds: [], revisionOf: { removalId: "removal", removalCode: "RM-009" },
    entryObservation: { enrichment: {}, definition: { groups: [{ components: [{ id: "line", displayName: "Diesel" }] }] },
      lineSources: { line: { scope: "operating", entryPolicy: "single", origin: "reviewed" } } } };
  vi.mocked(loadFacilityEmissionEntryCarry).mockResolvedValue({ entries: [entry], contenders: [], ownContenders: [], batches: [] } as never);
  const { lateEntries } = await loadRemovalCarriedEntries(ctx, "removal");
  expect(lateEntries).toEqual([expect.objectContaining({ entryId: "pair", value: { magnitude: "40", unit: "L" },
    values: [{ magnitude: "40", unit: "L" }, { magnitude: "0.85", unit: "kg/L" }] })]);
});

it("skips facility discovery for a sent Removal whose statement is not returned", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {} } } as never);
  for (const lineage of [[], [returnedLineage("SUBMITTED")], [returnedLineage("DRAFT")], [returnedLineage(null)]]) {
    vi.mocked(readRecordLockLineage).mockResolvedValueOnce(lineage as never);
    expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual({ facilityId: "facility", carriedEntries: [], lateEntries: [] });
  }
  expect(loadFacilityEmissionEntryCarry).not.toHaveBeenCalled();
  expect(getCreditBatchesByRemovalId).not.toHaveBeenCalled();
});
