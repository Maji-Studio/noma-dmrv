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
