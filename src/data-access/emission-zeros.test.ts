import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), batch: vi.fn(), facts: vi.fn(), contenders: vi.fn(), reservations: vi.fn(), activity: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./emission-entries", () => ({ lockedBatch: mocks.batch }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: mocks.facts }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: mocks.contenders, loadEmissionEntryReservations: mocks.reservations }));
vi.mock("./emission-entry-activity", () => ({ recordEmissionEntryActivity: mocks.activity }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ requireEmissionsEntriesEnabled: vi.fn() }));
import { recordEmissionZeros, undoEmissionZeros } from "./emission-zeros";
const ctx = makeTestOrgContext();
const removalId = "00000000-0000-4000-8000-000000000001";
const creditBatchId = "00000000-0000-4000-8000-000000000002";
const input = { removalId, creditBatchId, componentIds: ["line"], note: "  no emissions  " };
const shape = [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }];
const observation = { id: "observation", externalTemplateId: "template", definition: { groups: [{ id: "g", key: "pyrolysis", components: [
  { id: "line", displayName: "Electricity", blueprintKey: "grid_electricity_use", inputs: shape },
] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } },
lineSources: { line: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } } };
let rows: unknown[][];
const insert = vi.fn();
const update = vi.fn();
function query(result: unknown[]) {
  const q = { from: () => q, where: () => q, for: () => q, orderBy: () => q, returning: () => q,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  rows = [[{ id: removalId, updatedAt: new Date("2026-01-01"), metadata: null }], [{ id: "member" }], []];
  const tx = { select: () => query(rows.shift()!), insert: () => ({ values: insert }), update: () => ({ set: update }) };
  insert.mockImplementation((values) => query([{ ...values, id: "zero" }]));
  update.mockImplementation((values) => query([{ ...values, id: "zero", creditBatchId, kind: "zero", confirmedForRemovalId: removalId }]));
  mocks.transaction.mockImplementation((fn) => fn(tx));
  mocks.batch.mockResolvedValue({ batch: { id: creditBatchId, startDate: "2026-01-01" }, observation: structuredClone(observation) });
  mocks.facts.mockResolvedValue({ entries: [] });
  mocks.contenders.mockResolvedValue([{ contenderKind: "draft", removalId, creditBatchIds: [creditBatchId], createdAt: "2026-01-01", window: { start: "2026-01-01", end: "2026-02-01" } }]);
  mocks.reservations.mockResolvedValue([]);
});
it("records a zero with the pinned binding and trimmed note, capturing the persisted row", async () => {
  expect(await recordEmissionZeros(ctx, input)).toEqual({ entryIds: ["zero"] });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ctx.organizationId, confirmedForRemovalId: removalId,
    observationId: "observation", occurredOn: "2026-01-01", inputShape: shape, lineRule: "additive", note: "no emissions" }));
  expect(mocks.activity).toHaveBeenCalledWith(ctx, expect.anything(), "created", null, expect.objectContaining({ id: "zero", values: [] }));
});
it("refuses a nonmember batch", async () => {
  rows[1] = [];
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("not on an editable Removal");
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a submitted Removal", async () => {
  rows[2] = [{ submittedAt: new Date(), status: "submitted" }];
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("unsubmitted");
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a non-entry-capable line", async () => {
  await expect(recordEmissionZeros(ctx, { ...input, componentIds: ["missing"] })).rejects.toThrow("does not allow entries");
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a counted value that this Removal owns", async () => {
  mocks.facts.mockResolvedValue({ entries: [{ id: "value", componentId: "line", kind: "value", counts: true, creditBatchId, occurredOn: "2026-01-02" }] });
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("already has a value");
  expect(insert).not.toHaveBeenCalled();
});
it("is idempotent for a duplicate zero", async () => {
  mocks.facts.mockResolvedValue({ entries: [{ id: "existing", componentId: "line", kind: "zero", confirmedForRemovalId: removalId }] });
  expect(await recordEmissionZeros(ctx, input)).toEqual({ entryIds: ["existing"] });
  expect(insert).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
});
it("tombstones unclaimed zeros and captures their persisted before/after rows", async () => {
  rows.push([{ id: "zero", kind: "zero", creditBatchId, confirmedForRemovalId: removalId }]);
  await undoEmissionZeros(ctx, input);
  expect(mocks.activity).toHaveBeenCalledWith(ctx, expect.anything(), "deleted", expect.objectContaining({ id: "zero", values: [] }), expect.objectContaining({ id: "zero", values: [] }));
});
it("refuses undo when a zero is reserved", async () => {
  rows.push([{ id: "zero", sendReservedBySubmissionId: "attempt" }]);
  await expect(undoEmissionZeros(ctx, input)).rejects.toThrow("reserved or sent");
  expect(update).not.toHaveBeenCalled();
});
it("refuses a stale optional Removal review token", async () => {
  await expect(recordEmissionZeros(ctx, { ...input, expectedRemovalVersion: 1 })).rejects.toThrow();
  expect(insert).not.toHaveBeenCalled();
});
