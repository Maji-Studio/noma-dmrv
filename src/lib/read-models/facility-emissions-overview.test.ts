import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";

vi.mock("@/data-access/facility-emissions-overview", () => ({ loadFacilityEmissionsOverviewScope: vi.fn() }));
vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservations: vi.fn(), getTemplateObservationsByIds: vi.fn() }));
vi.mock("@/data-access/batch-emission-automatic-figures", () => ({ loadBatchesEmissionAutomaticFacts: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn() }));
// Prevent importing the detail loader's unused database dependencies in this unit suite.
vi.mock("@/data-access/emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
import { loadFacilityEmissionsOverviewScope } from "@/data-access/facility-emissions-overview";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { loadFacilityEmissionsOverview } from "./facility-emissions-overview";

const ctx = makeTestOrgContext();
const observation: EntryObservation & { id: string } = {
  id: "current", externalTemplateId: "template",
  definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "G", description: "", components:
    ["empty", "file", "review", "zero", "recorded", "setup"].map((id) => ({
      id, displayName: id, description: "Description", blueprintKey: "grid_electricity_use",
      inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
    })),
  }] },
  enrichment: Object.fromEntries(["empty", "file", "review", "zero", "recorded", "setup"].map((id) => [id, { electricity_use: { unit: "kWh" } }])),
  lineSources: Object.fromEntries(["empty", "file", "review", "zero", "recorded", "setup"].map((id) => [id, {
    scope: id === "setup" ? "forbidden" : "operating", origin: "reviewed", entryPolicy: id === "setup" ? "none" : "additive",
  }])),
};
const batch = { id: "new", code: "CB-2", startDate: "2026-10-01", endDate: null, status: "open", removalTemplateId: "template" };
function entry(componentId: string, overrides = {}) {
  return { id: componentId, creditBatchId: "new", componentId, observationId: "current", kind: "value",
    confirmedForRemovalId: null, documentCount: 1, occurredOn: "2026-10-15", createdAt: new Date("2026-11-01T02:00:00Z"),
    values: [{ inputKey: "electricity_use", magnitude: "1", unit: "kWh" }], ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  // It is still October in Los Angeles, even though UTC has crossed into November.
  vi.setSystemTime(new Date("2026-11-01T03:00:00Z"));
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(true);
  vi.mocked(loadFacilityEmissionsOverviewScope).mockResolvedValue({ timezone: "America/Los_Angeles", batches: [batch, { ...batch, id: "old", code: "CB-1", startDate: "2026-09-01" }] } as never);
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([observation] as never);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([]);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ new: { automaticFigures: {} }, old: { automaticFigures: {} } });
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([
    entry("file", { documentCount: 0 }), entry("review", { observationId: "missing" }),
    entry("zero", { kind: "zero", confirmedForRemovalId: "removal", values: [] }), entry("recorded"),
    // Removal-owned zeros affect display state but do not count as operator entries this month.
    entry("empty", { kind: "zero", confirmedForRemovalId: "removal", values: [], occurredOn: "2026-10-16" }),
    entry("recorded", { id: "prior-month", createdAt: new Date("2026-10-01T02:00:00Z") }),
  ] as never);
});

afterEach(() => vi.useRealTimers());

it("derives all six states, facility-month counts and last occurrence with bulk calls", async () => {
  const result = await loadFacilityEmissionsOverview(ctx, "facility");
  expect(result.batches.map((row) => row.creditBatchId)).toEqual(["new", "old"]);
  expect(result.batches[0]).toMatchObject({ status: "open", templateName: null, entriesThisMonth: 3,
    lastEntryOn: "2026-10-16", lineCounts: { total: 6, open: 3, fileMissing: 1, needsReview: 1,
      notRecorded: 0, needsSetup: 1, recorded: 3 } });
  expect(result.batches[1]).toMatchObject({ entriesThisMonth: 0, lastEntryOn: null,
    lineCounts: { total: 6, open: 6, notRecorded: 5, needsSetup: 1 } });
  expect(getLatestTemplateObservations).toHaveBeenCalledExactlyOnceWith(ctx, "isometric", ["template"]);
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, ["missing"]);
  expect(listEmissionEntriesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["new", "old"]);
  expect(loadBatchesEmissionAutomaticFacts).toHaveBeenCalledExactlyOnceWith(ctx, ["new", "old"]);
});

it("ignores entries behind the disabled flag and keeps the overview shape", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  const result = await loadFacilityEmissionsOverview(ctx, "facility");
  expect(result.batches[0]).toMatchObject({ entriesThisMonth: 0, lastEntryOn: null,
    lineCounts: { total: 6, open: 6, notRecorded: 5, needsSetup: 1 } });
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
});

it("shows one setup item for an unpinned or unread template without failing other batches", async () => {
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([]);
  const result = await loadFacilityEmissionsOverview(ctx, "facility");
  expect(result.batches[0].lineCounts).toMatchObject({ total: 1, open: 1, needsSetup: 1 });
});

it("authorizes the facility even when there are no batches and avoids other reads", async () => {
  vi.mocked(loadFacilityEmissionsOverviewScope).mockResolvedValue({ timezone: "UTC", batches: [] });
  expect(await loadFacilityEmissionsOverview(ctx, "facility")).toEqual({ batches: [] });
  expect(loadFacilityEmissionsOverviewScope).toHaveBeenCalledWith(ctx, "facility");
  expect(getLatestTemplateObservations).not.toHaveBeenCalled();
  vi.mocked(loadFacilityEmissionsOverviewScope).mockRejectedValue(new Error("Facility not found"));
  await expect(loadFacilityEmissionsOverview(ctx, "foreign")).rejects.toThrow("Facility not found");
});
