import { beforeEach, expect, it, vi } from "vitest";
import { loadRemovalCarriedEntries } from "./removal-carried-entries";
import { getCertifierRemovalById } from "./certifier-removals";
import { getSentRemovalForComparison } from "./removal-entry-correction";
import { loadDraftRemovalCarriedEntries } from "./removal-draft-carried-entries";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ select: vi.fn(), members: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, selectDistinct: mocks.members } }));
vi.mock("./certifier-removals", () => ({ getCertifierRemovalById: vi.fn() }));
vi.mock("./removal-entry-correction", () => ({ getSentRemovalForComparison: vi.fn() }));
vi.mock("./removal-draft-carried-entries", () => ({ loadDraftRemovalCarriedEntries: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getTemplateObservationById: vi.fn() }));
vi.mock("./removal-codes", () => ({ getRemovalCodes: vi.fn(async () => new Map()) }));
const ctx = makeTestOrgContext();
const query = (rows: object[]) => ({ from: () => ({ where: async () => rows }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.members.mockReturnValue(query([{ id: "member" }]));
  mocks.select.mockReturnValue(query([{ id: "origin", code: "CB-origin" }]));
  vi.mocked(getCertifierRemovalById).mockResolvedValue({ id: "removal", facilityId: "facility" } as never);
  vi.mocked(getSentRemovalForComparison).mockResolvedValue(null);
});
it("refuses a Removal outside the authenticated organization's visible records", async () => {
  vi.mocked(getCertifierRemovalById).mockResolvedValue(null);
  await expect(loadRemovalCarriedEntries(ctx, "foreign")).rejects.toThrow("Removal was not found.");
  expect(getCertifierRemovalById).toHaveBeenCalledExactlyOnceWith(ctx, "foreign");
  expect(mocks.members).not.toHaveBeenCalled();
  expect(loadDraftRemovalCarriedEntries).not.toHaveBeenCalled();
});
it("uses the entry-only draft selector", async () => {
  vi.mocked(loadDraftRemovalCarriedEntries).mockResolvedValue([]);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual([]);
  expect(loadDraftRemovalCarriedEntries).toHaveBeenCalledExactlyOnceWith(ctx, "removal", "facility");
});
it("reads exactly the frozen carried list independently of present membership", async () => {
  const entry = { entryId: "carried", creditBatchId: "origin", occurredOn: "2026-10-01", contentRevision: 1,
    kind: "value", value: { magnitude: "12", unit: "kWh" }, evidenceDocumentIds: ["file"] };
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {
    carriedEntries: [{ ...entry, componentId: "line" }],
    entryContributions: [{ componentId: "line", componentDisplayName: "Electricity", inputKey: "energy",
      entries: [entry, { ...entry, entryId: "own", creditBatchId: "member" }] }],
  } } } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual([expect.objectContaining({ entryId: "carried",
    creditBatchId: "origin", creditBatchCode: "CB-origin", occurredOn: "2026-10-01", value: entry.value, evidenceDocumentIds: ["file"] })]);
  expect(loadDraftRemovalCarriedEntries).not.toHaveBeenCalled();
});
it("does not silently substitute live entries for a corrupt sent snapshot", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: { carriedEntries: "bad" } } } as never);
  await expect(loadRemovalCarriedEntries(ctx, "removal")).rejects.toThrow("saved emissions entry set");
  expect(loadDraftRemovalCarriedEntries).not.toHaveBeenCalled();
});

it("returns empty for older snapshots without the optional carried list", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: {} } } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual([]);
});
it("keeps frozen values when display records or optional labels are missing", async () => {
  mocks.select.mockReturnValue(query([]));
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic: { carriedEntries: [{
    entryId: "entry", creditBatchId: "gone", componentId: "line", occurredOn: "2026-10-01",
    value: { magnitude: "12", unit: "kWh" }, evidenceDocumentIds: ["frozen-file"],
  }] } } } as never);
  expect(await loadRemovalCarriedEntries(ctx, "removal")).toEqual([expect.objectContaining({
    creditBatchCode: "gone", value: { magnitude: "12", unit: "kWh" }, evidenceDocumentIds: ["frozen-file"],
  })]);
});
