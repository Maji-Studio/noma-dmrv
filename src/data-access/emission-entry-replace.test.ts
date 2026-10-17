import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { documents, emissionEntries, emissionEntryValues } from "@/db/schema";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), latest: vi.fn(), previous: vi.fn(), activity: vi.fn(), gate: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./batch-emission-automatic-figures", () => ({ loadBatchAutomaticFigures: vi.fn() }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservation: mocks.latest, getTemplateObservationById: mocks.previous }));
vi.mock("./emission-entry-activity", () => ({ recordEmissionEntryActivity: mocks.activity }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ requireEmissionsEntriesEnabled: mocks.gate }));
import { replaceEmissionEntry } from "./emission-entries";

const ctx = makeTestOrgContext();
const id = "00000000-0000-4000-8000-000000000001";
const shape = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
const original: typeof emissionEntries.$inferSelect = {
  id, organizationId: ctx.organizationId, creditBatchId: "batch", removalTemplateId: "template",
  componentId: "line", inputShape: shape, lineRule: "additive", observationId: "old-observation",
  kind: "value", confirmedForRemovalId: null, occurredOn: "2026-01-02", note: "old note", createdBy: ctx.userId,
  version: 2, contentRevision: 2, deletedAt: null, sentByRemovalId: null, sendReservedBySubmissionId: null,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
};
const previous: EntryObservation & { id: string } = {
  id: "old-observation", externalTemplateId: "template",
  definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "G", description: "", components: [
    { id: "line", displayName: "Line", description: null, blueprintKey: "grid_electricity_use", inputs: shape },
  ] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
};
const input = { id, expectedVersion: 2, note: "new note",
  values: [{ inputKey: "electricity_use", quantityKind: "energy" as const, magnitude: "2.00", unit: "MJ" }] };
const oldValues = [{ id: "old-value", organizationId: ctx.organizationId, entryId: id,
  inputKey: "electricity_use", magnitude: "1", unit: "kWh", massDistanceDetail: null }];
const newValues = [{ ...oldValues[0], id: "new-value", entryId: "replacement", magnitude: "2", unit: "MJ" }];
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
const inserted = vi.fn();
const moved = vi.fn();
function query(result: () => unknown[]) {
  const builder = { from: () => builder, where: () => builder, orderBy: () => builder,
    for: (mode: string) => { locks.push(mode); return builder; }, returning: () => builder,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve().then(result).then(resolve) };
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks();
  locks.length = 0;
  current = { ...previous, id: "current-observation", enrichment: { line: { electricity_use: { unit: "MJ" } } } };
  locked = { ...original };
  saved = { ...original, id: "replacement", observationId: current.id, version: 1, contentRevision: 1 };
  rows = [() => [original], () => oldValues, () => [{ count: 1 }],
    () => [batch], () => [{ archivedAt: null, timezone: "UTC" }], () => [batch], () => [locked],
    () => [locked], () => oldValues, () => [{ count: 1 }],
    () => [], // Active sibling values after the old row was tombstoned.
    () => [saved], () => newValues, () => [{ count: 0 }],
    () => [saved], () => newValues, () => [{ count: 1 }]];
  select.mockImplementation(() => {
    const result = rows.shift();
    if (!result) throw new Error("Unexpected query");
    return query(result);
  });
  update.mockImplementation(table => ({ set: (patch: object) => {
    if (table === documents) moved(patch);
    return query(() => [{ ...locked, deletedAt: new Date(), version: 3, contentRevision: 3 }]);
  } }));
  insert.mockImplementation(table => ({ values: (data: object) => {
    inserted(table, data);
    return query(() => table === emissionEntries ? [saved] : newValues);
  } }));
  const tx = { select, update, insert, delete: () => query(() => []) } as unknown as DbTransaction;
  mocks.transaction.mockImplementation((callback: (tx: DbTransaction) => unknown) => callback(tx));
  mocks.latest.mockImplementation(async () => current);
  mocks.previous.mockResolvedValue(previous);
});

it("replaces in one transaction with ordered locks, current binding, normalized values and moved evidence", async () => {
  expect(await replaceEmissionEntry(ctx, input)).toMatchObject({ id: "replacement", values: newValues, documentCount: 1 });
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(locks).toEqual(["share", "update", "update"]);
  expect(inserted).toHaveBeenCalledWith(emissionEntries, expect.objectContaining({
    organizationId: ctx.organizationId, creditBatchId: original.creditBatchId, componentId: original.componentId,
    observationId: current.id, occurredOn: batch.endDate, note: input.note, createdBy: ctx.userId,
  }));
  expect(inserted).toHaveBeenCalledWith(emissionEntryValues, [expect.objectContaining({ magnitude: "2", entryId: "replacement" })]);
  expect(moved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ entityId: "replacement", version: expect.anything() }));
  expect(mocks.activity.mock.calls.map(call => [call[2], call[4].id])).toEqual([["deleted", id], ["created", "replacement"]]);
  expect(mocks.activity.mock.calls[0][3]).toMatchObject({ ...original, values: oldValues });
  expect(mocks.activity.mock.calls[0][4]).toMatchObject({ deletedAt: expect.any(Date), version: 3, contentRevision: 3 });
});

function singleLine() {
  const inputs = ["initial_readout", "final_readout"].map(key => ({ key, type: "monitored" as const, quantityKind: "energy" as const }));
  current.definition = { groups: [{ ...current.definition.groups[0], components: [{
    ...current.definition.groups[0].components[0], inputs,
  }] }] };
  current.enrichment = { line: { initial_readout: { unit: "MJ" }, final_readout: { unit: "MJ" } } };
  current.lineSources = { line: { scope: "operating", entryPolicy: "single", origin: "reviewed" } };
  return { ...input, values: inputs.map(value => ({ ...input.values[0], inputKey: value.key })) };
}

it("defaults a single line to batch start even when an explicit date is supplied", async () => {
  const single = singleLine();
  await replaceEmissionEntry(ctx, { ...single, occurredOn: "2026-01-20" });
  expect(inserted).toHaveBeenCalledWith(emissionEntries, expect.objectContaining({ occurredOn: batch.startDate, lineRule: "single" }));
});

it.each(["reserved", "sent", "stale", "counts", "zero", "parent-changed", "missing-observation"] as const)("refuses %s before writing", async state => {
  if (state === "reserved") locked.sendReservedBySubmissionId = "submission";
  if (state === "sent") locked.sentByRemovalId = "removal";
  if (state === "stale") locked.version++;
  if (state === "counts") current = previous;
  if (state === "zero") { locked.kind = "zero"; locked.confirmedForRemovalId = "removal"; }
  if (state === "parent-changed") locked.creditBatchId = "other-batch";
  if (state === "missing-observation") mocks.previous.mockResolvedValue(null);
  await expect(replaceEmissionEntry(ctx, input)).rejects.toThrow();
  expect(update).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
});

it("refuses a foreign or missing entry before locking or writing", async () => {
  rows[0] = () => [];
  await expect(replaceEmissionEntry({ ...ctx, organizationId: "foreign" }, input)).rejects.toThrow("not found");
  expect(locks).toEqual([]);
  expect(update).not.toHaveBeenCalled();
});

it("checks organization scope and the feature gate before opening a transaction", async () => {
  await expect(replaceEmissionEntry({ ...ctx, organizationId: "" }, input)).rejects.toThrow("Unauthorized");
  mocks.gate.mockImplementation(() => { throw new Error("Disabled"); });
  await expect(replaceEmissionEntry(ctx, input)).rejects.toThrow("Disabled");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it("applies create's single-line uniqueness check before inserting", async () => {
  const single = singleLine();
  rows[10] = () => [{ id: "sibling" }];
  await expect(replaceEmissionEntry(ctx, single)).rejects.toThrow("already has an entry");
  expect(insert).not.toHaveBeenCalled();
  expect(moved).not.toHaveBeenCalled();
});

it.each([
  { values: [{ ...input.values[0], unit: "kWh" }], message: "supported unit" },
  { values: [{ ...input.values[0], inputKey: "wrong" }], message: "do not match" },
  { occurredOn: "2025-12-31", message: "before the credit batch" },
])("applies create validation: $message", async ({ message, ...patch }) => {
  await expect(replaceEmissionEntry(ctx, { ...input, ...patch })).rejects.toThrow(message);
  expect(insert).not.toHaveBeenCalled();
});
