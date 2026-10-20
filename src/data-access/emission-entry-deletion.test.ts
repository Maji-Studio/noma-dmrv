import { creditBatches, creditBatchApplications, emissionEntries } from "@/db/schema";
import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ activity: vi.fn() }));
vi.mock("./emission-entry-activity", () => ({ recordEmissionEntryActivity: mocks.activity }));
import { releaseDeletedRemovalEntries } from "./emission-entry-deletion";
it.each([null, new Date("2026-01-01")])("records deletion only for a live zero (%s)", async (deletedAt) => {
  mocks.activity.mockClear();
  const row = { id: "zero", kind: "zero", confirmedForRemovalId: "removal", deletedAt };
  const query = (rows: unknown[]) => {
    const q = { from: () => q, where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const update = vi.fn(() => ({ set: () => query([{ ...row, deletedAt: new Date() }]) }));
  const remove = vi.fn(() => query([]));
  const tx = { select: () => query([row]), update, delete: remove } as unknown as DbTransaction;
  await releaseDeletedRemovalEntries(makeTestOrgContext(), tx, "removal", []);
  expect(remove).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledTimes(deletedAt ? 0 : 1);
  expect(mocks.activity).toHaveBeenCalledTimes(deletedAt ? 0 : 1);
});

it("records claim release activity for value entries on draft deletion", async () => {
  mocks.activity.mockClear();
  const before = { id: "value", kind: "value", sendReservedBySubmissionId: "attempt" };
  const after = { ...before, sendReservedBySubmissionId: null };
  const query = (rows: unknown[]) => {
    const q = { from: () => q, where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const tx = { select: () => query([before]), update: () => ({ set: () => query([after]) }) as never } as unknown as DbTransaction;
  const ctx = makeTestOrgContext();
  await releaseDeletedRemovalEntries(ctx, tx, "removal", ["attempt"]);
  expect(mocks.activity).toHaveBeenCalledExactlyOnceWith(ctx, tx, "updated", { ...before, values: [] }, { ...after, values: [] }, { skipEmpty: true });
});

it("locks member batches before matched entries even without production claims", async () => {
  const locks: unknown[] = [];
  const query = (table: unknown) => {
    const rows = table === creditBatchApplications ? [{ creditBatchId: "member" }] : [];
    const q = { where: () => q, orderBy: () => q, for: () => { locks.push(table); return q; },
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const tx = { select: () => ({ from: query }) } as unknown as DbTransaction;
  await releaseDeletedRemovalEntries(makeTestOrgContext(), tx, "follow-up", []);
  expect(locks).toEqual([creditBatches, emissionEntries]);
});
