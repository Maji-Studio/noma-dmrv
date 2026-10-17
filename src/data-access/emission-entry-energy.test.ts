import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadFacilityEmissionEntryFlows } from "./emission-entry-energy";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { requireOrgFacility } from "./utils";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "./removal-template-observations";
import { listEmissionEntriesForBatches } from "./emission-entries";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";

const mocks = vi.hoisted(() => ({ where: vi.fn(), select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./utils", () => ({ requireOrgScope: vi.fn(), requireOrgFacility: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservations: vi.fn(), getTemplateObservationsByIds: vi.fn() }));
vi.mock("./emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn(() => true) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(true);
  mocks.where.mockResolvedValue([]);
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([observation] as never);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([]);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([]);
});
it("performs no entry query with the flag off", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  expect(await loadFacilityEmissionEntryFlows(makeTestOrgContext(), "facility")).toEqual([]);
  expect(mocks.select).not.toHaveBeenCalled();
  expect(getLatestTemplateObservations).not.toHaveBeenCalled();
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
});
it("filters the facility's batches by organization and archive state", async () => {
  const ctx = makeTestOrgContext();
  expect(await loadFacilityEmissionEntryFlows(ctx, "facility")).toEqual([]);
  expect(requireOrgFacility).toHaveBeenCalledWith(ctx, "facility");
  const predicate = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(predicate.sql).toContain('"credit_batches"."organization_id" =');
  expect(predicate.sql).toContain('"credit_batches"."facility_id" =');
  expect(predicate.sql).toContain('"credit_batches"."archived_at" is null');
  expect(predicate.params).toEqual([ctx.organizationId, "facility"]);
});

const observation: EntryObservation & { id: string } = {
  id: "current", externalTemplateId: "template",
  definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Pyrolysis", description: "", components: [{
    id: "grid", displayName: "Grid electricity", description: null, blueprintKey: "grid_electricity_use",
    inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
  }] }] },
  enrichment: { grid: { electricity_use: { unit: "kWh" } } },
  lineSources: { grid: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: "run-electricity" } },
};
function entry(creditBatchId: string, overrides = {}) {
  return { id: creditBatchId, creditBatchId, componentId: "grid", observationId: "current", kind: "value",
    deletedAt: null, confirmedForRemovalId: null, documentCount: 1, occurredOn: "2026-10-15",
    values: [{ inputKey: "electricity_use", magnitude: "2", unit: "kWh" }], ...overrides };
}

it.each([1, 100])("uses a fixed number of bulk loads for %s batches sharing a template", async (count) => {
  const ctx = makeTestOrgContext();
  const batches = Array.from({ length: count }, (_, index) => ({ id: `batch-${index}`, removalTemplateId: "template" }));
  mocks.where.mockResolvedValue(batches);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue(batches.map(batch => entry(batch.id, { observationId: "previous" })) as never);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([{ ...observation, id: "previous" }] as never);
  expect(await loadFacilityEmissionEntryFlows(ctx, "facility")).toEqual(batches.map(batch => ({
    source: "grid", creditBatchId: batch.id, day: "2026-10-15", activity: 2,
  })));
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(getLatestTemplateObservations).toHaveBeenCalledExactlyOnceWith(ctx, "isometric", ["template"]);
  expect(listEmissionEntriesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, batches.map(batch => batch.id));
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, ["previous"]);
});

it("groups entries by batch and uses each live pin while excluding stale, mismatched and zero entries", async () => {
  const diesel: EntryObservation & { id: string } = {
    ...observation, id: "diesel", externalTemplateId: "diesel-template",
    definition: { groups: [{ ...observation.definition.groups[0], components: [{
      ...observation.definition.groups[0].components[0], blueprintKey: "fuel_usage_by_volume",
      inputs: [{ key: "volume_of_fuel", type: "monitored", quantityKind: "volume" }],
    }] }] },
    enrichment: { grid: { volume_of_fuel: { unit: "L" } } },
    lineSources: { grid: { ...observation.lineSources.grid, automaticSource: "run-genset-diesel" } },
  };
  const stale = { ...observation, id: "stale", lineSources: {
    grid: { ...observation.lineSources.grid, automaticSource: undefined },
  } };
  mocks.where.mockResolvedValue([
    { id: "grid-batch", removalTemplateId: "template" }, { id: "diesel-batch", removalTemplateId: "diesel-template" },
    { id: "unpinned", removalTemplateId: null }, { id: "unread", removalTemplateId: "unread" },
  ]);
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([observation, diesel] as never);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([stale] as never);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([
    entry("diesel-batch", { observationId: "diesel", values: [{ inputKey: "volume_of_fuel", magnitude: "3", unit: "L" }] }),
    entry("grid-batch", { documentCount: 0 }),
    entry("grid-batch", { observationId: "stale" }),
    entry("grid-batch", { values: [{ inputKey: "electricity_use", magnitude: "5", unit: "Wh" }] }),
    entry("grid-batch", { kind: "zero", confirmedForRemovalId: "removal", values: [] }),
    entry("grid-batch", { observationId: "missing-history" }),
    entry("grid-batch", { deletedAt: new Date() }),
  ] as never);
  const ctx = makeTestOrgContext();
  expect(await loadFacilityEmissionEntryFlows(ctx, "facility")).toEqual([
    { source: "grid", creditBatchId: "grid-batch", day: "2026-10-15", activity: 2 },
    { source: "genset", creditBatchId: "diesel-batch", day: "2026-10-15", activity: 3 },
  ]);
  expect(listEmissionEntriesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["grid-batch", "diesel-batch"]);
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, ["stale", "missing-history"]);
});

it("skips entry reads for facilities with no readable pins", async () => {
  mocks.where.mockResolvedValue([{ id: "unpinned", removalTemplateId: null }]);
  expect(await loadFacilityEmissionEntryFlows(makeTestOrgContext(), "facility")).toEqual([]);
  expect(getLatestTemplateObservations).not.toHaveBeenCalled();
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
});

it("refuses an unauthorized facility before reading batches", async () => {
  vi.mocked(requireOrgFacility).mockRejectedValueOnce(new Error("Facility not found"));
  await expect(loadFacilityEmissionEntryFlows(makeTestOrgContext(), "foreign")).rejects.toThrow("Facility not found");
  expect(mocks.select).not.toHaveBeenCalled();
});
