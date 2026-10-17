import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), latest: vi.fn(), activity: vi.fn(), gate: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./emission-entry-lock", () => ({ lockEmissionEntryBatch: mocks.lock }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservation: mocks.latest }));
vi.mock("./activity-events", () => ({ recordActivityChange: mocks.activity }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ requireEmissionsEntriesEnabled: mocks.gate }));
import { setEmissionLineComment, deleteEmissionLineComment } from "./emission-line-comments";

const ctx = makeTestOrgContext();
const id = "00000000-0000-4000-8000-000000000001";
const facilityId = "00000000-0000-4000-8000-000000000002";
const creditBatchId = "00000000-0000-4000-8000-000000000003";
const input = { facilityId, creditBatchId, componentId: "line", body: "  New wording  " };
const before = { id, organizationId: ctx.organizationId, creditBatchId, componentId: "line",
  body: "Old wording", createdBy: ctx.userId, updatedBy: ctx.userId, version: 2,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
const after = { ...before, body: "New wording", version: 3, updatedAt: new Date("2026-01-02") };
const select = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const inserted = vi.fn();
const updated = vi.fn();
let selected: unknown[][];
const locks: string[] = [];
let tx: DbTransaction;
function query(rows: unknown[]) {
  const builder = { from: () => builder, where: () => builder, returning: () => builder,
    for: (mode: string) => { locks.push(mode); return builder; },
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks();
  selected = [[before]];
  locks.length = 0;
  select.mockImplementation(() => query(selected.shift() ?? []));
  insert.mockImplementation(() => ({ values: (data: object) => { inserted(data); return query([{ ...after, version: 1 }]); } }));
  update.mockImplementation(() => ({ set: (data: object) => { updated(data); return query([after]); } }));
  remove.mockImplementation(() => query([]));
  tx = { select, insert, update, delete: remove } as unknown as DbTransaction;
  mocks.transaction.mockImplementation((callback: (tx: DbTransaction) => unknown) => callback(tx));
  mocks.lock.mockResolvedValue({ batch: { id: creditBatchId, facilityId, archivedAt: null, removalTemplateId: "template" }, facility: { archivedAt: null } });
  // Missing contract and enrichment cannot block a noma-only comment.
  mocks.latest.mockResolvedValue({ definition: { groups: [{ components: [{ id: "line" }] }] } });
});

it("creates under the batch lock with server attribution and a persisted snapshot", async () => {
  selected = [[]];
  const result = await setEmissionLineComment(ctx, input);
  expect(inserted).toHaveBeenCalledExactlyOnceWith({ organizationId: ctx.organizationId, creditBatchId,
    componentId: "line", body: "New wording", createdBy: ctx.userId, updatedBy: ctx.userId });
  expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(ctx, tx, creditBatchId);
  expect(mocks.latest).toHaveBeenCalledExactlyOnceWith(ctx, "isometric", "template", tx);
  expect(mocks.activity).toHaveBeenCalledExactlyOnceWith(ctx, tx,
    { entityType: "emission_line_comment", entityId: id, creditBatchId, action: "created", source: "form" }, null, result);
});

it("edits with a loaded version and captures the stored before and after rows", async () => {
  expect(await setEmissionLineComment(ctx, { ...input, expectedVersion: before.version })).toEqual(after);
  expect(locks).toEqual(["update"]);
  expect(updated).toHaveBeenCalledExactlyOnceWith({ body: "New wording", updatedBy: ctx.userId,
    updatedAt: expect.any(Date), version: expect.anything() });
  expect(mocks.activity).toHaveBeenCalledExactlyOnceWith(ctx, tx,
    { entityType: "emission_line_comment", entityId: id, creditBatchId, action: "updated", source: "form" }, before, after);
});

it.each([undefined, 1])("refuses duplicate creation or a stale edit (%s) before changing a row", async (expectedVersion) => {
  await expect(setEmissionLineComment(ctx, { ...input, expectedVersion }))
    .rejects.toMatchObject({ code: expectedVersion === undefined ? "conflict" : "stale_version" });
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
});

it("refuses to recreate a deleted comment from a stale edit", async () => {
  selected = [[]];
  await expect(setEmissionLineComment(ctx, { ...input, expectedVersion: 2 })).rejects.toMatchObject({ code: "stale_version" });
  expect(insert).not.toHaveBeenCalled();
});

it("returns a validation error for a component outside the current observation", async () => {
  await expect(setEmissionLineComment(ctx, { ...input, componentId: "unknown" })).rejects.toMatchObject({ code: "validation_failed" });
  expect(select).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
});

it("hard deletes after checking the version and captures the stored before row", async () => {
  selected = [[before], [before]];
  expect(await deleteEmissionLineComment(ctx, { facilityId, id, expectedVersion: before.version })).toEqual({ id });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(mocks.activity).toHaveBeenCalledExactlyOnceWith(ctx, tx,
    { entityType: "emission_line_comment", entityId: id, creditBatchId, action: "deleted", source: "form" }, before, null);
  expect(mocks.latest).not.toHaveBeenCalled();
});

it("refuses a stale delete without deleting or recording activity", async () => {
  selected = [[before], [before]];
  await expect(deleteEmissionLineComment(ctx, { id, expectedVersion: 1 })).rejects.toMatchObject({ code: "stale_version" });
  expect(remove).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
});

it("validates facility context and refuses a missing scoped comment", async () => {
  await expect(setEmissionLineComment(ctx, { ...input, facilityId: id })).rejects.toMatchObject({ code: "not_found" });
  selected = [[]];
  await expect(deleteEmissionLineComment(ctx, { id, expectedVersion: 2 })).rejects.toMatchObject({ code: "not_found" });
  expect(remove).not.toHaveBeenCalled();
});

it("checks org scope and the feature flag before opening a transaction", async () => {
  await expect(setEmissionLineComment({ ...ctx, organizationId: "" }, input)).rejects.toThrow("Unauthorized");
  mocks.gate.mockImplementation(() => { throw new Error("Disabled"); });
  await expect(setEmissionLineComment(ctx, input)).rejects.toThrow("Disabled");
  await expect(deleteEmissionLineComment(ctx, { id, expectedVersion: 2 })).rejects.toThrow("Disabled");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
