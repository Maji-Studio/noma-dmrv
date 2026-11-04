import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn(), lockBatch: vi.fn(), lockEntry: vi.fn(), carried: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("./emission-entry-lock", () => ({
  lockEmissionEntryBatch: mocks.lockBatch, lockWritableEmissionEntry: mocks.lockEntry,
}));
vi.mock("./emission-entry-corrections", () => ({
  isCarriedEmissionCorrection: mocks.carried,
}));
vi.mock("./removal-template-observations", () => ({
  getLatestTemplateObservation: vi.fn(async () => ({ id: "observation" })),
}));
import { listEmissionEntries, replaceEmissionEntry } from "./emission-entries";

beforeEach(() => vi.clearAllMocks());

it("assembles multiple entries with three queries and no per-entry re-read", async () => {
  const entries = [{ id: "first" }, { id: "second" }, { id: "empty" }];
  const values = [
    { entryId: "second", inputKey: "b" },
    { entryId: "first", inputKey: "a" },
  ];
  const results = [entries, values, [{ entryId: "second", count: 2 }]];
  mocks.select.mockImplementation(() => {
    const rows = results.shift();
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(async () => rows),
      groupBy: vi.fn(async () => rows),
    };
    return query;
  });
  expect(await listEmissionEntries(makeTestOrgContext(), "batch")).toEqual([
    { id: "first", values: [values[1]], documentCount: 0, evidenceDocumentIds: [], heldForRemovalId: null },
    { id: "second", values: [values[0]], documentCount: 2, evidenceDocumentIds: [], heldForRemovalId: null },
    { id: "empty", values: [], documentCount: 0, evidenceDocumentIds: [], heldForRemovalId: null },
  ]);
  expect(mocks.select).toHaveBeenCalledTimes(3);
});


it.each(["sent", "held"])("refuses Enter again for a %s carried entry before writing", async (holding) => {
  const id = "00000000-0000-4000-8000-000000000001";
  const ctx = makeTestOrgContext();
  const entry = { id, creditBatchId: "origin", kind: "value", version: 1,
    sentByRemovalId: holding === "sent" ? "receiver" : null,
    heldForRemovalId: holding === "held" ? "receiver" : null };
  const results = [[entry], [], [{ count: 0 }], [entry], [], [{ count: 0 }]];
  const update = vi.fn();
  const tx = { select: () => {
    const rows = results.shift();
    return { from: () => ({ where: () => Object.assign(Promise.resolve(rows), { orderBy: async () => rows }) }) };
  }, update };
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.lockBatch.mockResolvedValue({ batch: { id: "origin", removalTemplateId: "template" }, facility: {} });
  mocks.lockEntry.mockResolvedValue(entry);
  mocks.carried.mockReturnValue(true);
  await expect(replaceEmissionEntry(ctx, { id, expectedVersion: 1, occurredOn: "2026-06-10",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "125", unit: "kWh" }],
  })).rejects.toThrow("This entry was carried into a later Removal, so it cannot be entered again.");
  expect(mocks.carried).toHaveBeenCalledWith(ctx, tx, "origin", "receiver");
  expect(update).not.toHaveBeenCalled();
  expect(results).toEqual([]);
});
