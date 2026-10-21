import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { emissionEntries } from "@/db/schema";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), latest: vi.fn(), previous: vi.fn(), activity: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./batch-emission-automatic-figures", () => ({ loadBatchAutomaticFigures: vi.fn() }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservation: mocks.latest, getTemplateObservationById: mocks.previous }));
vi.mock("./emission-entry-activity", () => ({ recordEmissionEntryActivity: mocks.activity }));
// These fixtures have no returned lineage. Correction authorization is tested separately.
vi.mock("./emission-entry-corrections", () => ({ lockEmissionCorrectionScope: vi.fn(), revalidateEmissionCorrectionScope: vi.fn(), emissionCorrectionWindow: () => undefined }));
import { updateEmissionEntry, confirmEmissionEntry } from "./emission-entries";

const ctx = makeTestOrgContext();
const id = "00000000-0000-4000-8000-000000000001";
const shape = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
const original: typeof emissionEntries.$inferSelect = {
  id, organizationId: ctx.organizationId, creditBatchId: "batch", removalTemplateId: "template",
  componentId: "line", inputShape: shape, lineRule: "additive", observationId: "old-observation",
  kind: "value", confirmedForRemovalId: null, occurredOn: "2026-01-02", note: "old note", createdBy: ctx.userId,
  version: 2, contentRevision: 2, deletedAt: null, sentByRemovalId: null, replacesEntryId: null, sendReservedBySubmissionId: null,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
};
const previous: EntryObservation & { id: string } = {
  id: "old-observation", externalTemplateId: "template",
  definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "G", description: "", components: [
    { id: "line", displayName: "Line", description: null, blueprintKey: "grid_electricity_use", inputs: shape },
  ] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
};
const oldValues = [{ id: "old-value", organizationId: ctx.organizationId, entryId: id,
  inputKey: "electricity_use", magnitude: "1", unit: "kWh", massDistanceDetail: null }];

const batch = { id: "batch", facilityId: "facility", removalTemplateId: "template", archivedAt: null,
  startDate: "2026-01-01", endDate: "2026-01-31" };
let current: typeof previous;
let locked: typeof original;
let saved: typeof original;
let rows: (() => unknown[])[];
const locks: string[] = [];
const select = vi.fn();
const update = vi.fn();
const insert = vi.fn();

function query(result: () => unknown[]) {
  const builder = { from: () => builder, where: () => builder, orderBy: () => builder,
    for: (mode: string) => { locks.push(mode); return builder; }, returning: () => builder,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve().then(result).then(resolve) };
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks();
  locks.length = 0;
  current = { ...previous, id: "current-observation" };
  locked = { ...original };
  saved = { ...original, version: 3 };
  rows = [() => [original], () => oldValues, () => [{ count: 1 }],
    () => [batch], () => [{ archivedAt: null, timezone: "UTC" }], () => [batch], () => [locked],
    () => [locked], () => oldValues, () => [{ count: 1 }],
    () => [saved], () => oldValues, () => [{ count: 1 }]];
  select.mockImplementation(() => {
    const result = rows.shift();
    if (!result) throw new Error("Unexpected query");
    return query(result);
  });
  update.mockImplementation(() => ({ set: () => query(() => [saved]) }));
  insert.mockImplementation(() => ({ values: () => query(() => oldValues) }));
  const tx = { select, update, insert, delete: () => query(() => []) } as unknown as DbTransaction;
  mocks.transaction.mockImplementation((callback: (tx: DbTransaction) => unknown) => callback(tx));
  mocks.latest.mockImplementation(async () => current);
  mocks.previous.mockResolvedValue(previous);
});

it.each([false, true])("preserves other drafts' zeros for a note edit, including unchanged submitted values (%s)", async (includeValues) => {
  await updateEmissionEntry(ctx, { id, expectedVersion: original.version, note: "revised note",
    ...(includeValues ? { values: oldValues.map((value) => ({ ...value, quantityKind: "energy" as const })) } : {}) });
  expect(rows).toHaveLength(0);
  expect(update).toHaveBeenCalledTimes(1);
  expect(locks).toEqual(["share", "update", "update"]);
});
it("tombstones zeros when a value's date changes", async () => {
  rows.splice(10, 0, () => []);
  await updateEmissionEntry(ctx, { id, expectedVersion: original.version, occurredOn: "2026-01-03" });
  expect(rows).toHaveLength(0);
  expect(locks).toEqual(["share", "update", "update", "update"]);
});
it.each([false, true])("tombstones on confirmation only when the entry starts counting (%s)", async (changed) => {
  if (changed) {
    current = structuredClone(current);
    current.lineSources.line = { ...current.lineSources.line, automaticSource: "run-electricity" };
    rows.splice(10, 0, () => []);
  }
  await confirmEmissionEntry(ctx, id, original.version);
  expect(rows).toHaveLength(0);
  expect(locks).toHaveLength(changed ? 4 : 3);
});
