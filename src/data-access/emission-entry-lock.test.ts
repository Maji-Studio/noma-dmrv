vi.mock("./emission-entry-corrections", () => ({ lockEmissionCorrectionScope: vi.fn(), revalidateEmissionCorrectionScope: vi.fn(), emissionCorrectionWindow: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { creditBatches, emissionEntries, facilities } from "@/db/schema";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { assertEmissionEntryDocumentWritable, lockEmissionCommentBatch, lockEmissionEntryBatch, lockEmissionEntryDocumentOwner } from "./emission-entry-lock";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({
  requireEmissionsEntriesEnabled: vi.fn(),
}));
const ctx = makeTestOrgContext();
const locks: unknown[][] = [];
function transaction(results: unknown[][]) {
  return {
    select: () => {
      const rows = results.shift();
      let table: unknown;
      const query = {
        from: (value: unknown) => { table = value; return query; },
        where: () => query,
        for: async (mode: string) => { locks.push([table, mode]); return rows; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return query;
    },
  } as unknown as DbTransaction;
}
beforeEach(() => { locks.length = 0; });
it("locks facility, batch and entry in ancestor order for evidence", async () => {
  const entry = { id: "entry", creditBatchId: "batch" };
  const batch = { id: "batch", facilityId: "facility", archivedAt: null };
  const tx = transaction([[entry], [batch], [{ archivedAt: null }], [batch], [entry]]);
  expect(await lockEmissionEntryDocumentOwner(ctx, tx, "entry")).toMatchObject({ archived: false });
  expect(locks).toEqual([[facilities, "share"], [creditBatches, "update"], [emissionEntries, "update"]]);
});
it("returns a retryable conflict when the facility changed before locking the batch", async () => {
  const tx = transaction([[{ facilityId: "old" }], [{}], [{ facilityId: "new" }]]);
  await expect(lockEmissionEntryBatch(ctx, tx, "batch")).rejects.toMatchObject({
    code: "conflict", retryable: true,
  });
  expect(locks).toEqual([[facilities, "share"], [creditBatches, "update"]]);
});
it("returns a retryable conflict when the entry changed batch", async () => {
  const batch = { facilityId: "facility", archivedAt: null };
  const tx = transaction([
    [{ creditBatchId: "old" }], [batch], [{ archivedAt: null }], [batch], [{ creditBatchId: "new" }],
  ]);
  await expect(lockEmissionEntryDocumentOwner(ctx, tx, "entry")).rejects.toMatchObject({
    code: "conflict", retryable: true,
  });
});

it("refuses files on recorded zeros", async () => {
  const entry = { id: "entry", creditBatchId: "batch", kind: "zero" };
  const batch = { id: "batch", facilityId: "facility", archivedAt: null };
  const tx = transaction([[entry], [batch], [{ archivedAt: null }], [batch], [entry]]);
  await expect(assertEmissionEntryDocumentWritable(ctx, "entry", tx)).rejects.toThrow("Recorded zeros cannot have files.");
});

it("locks comment ancestors without any correction scope or statement reads", async () => {
  const { lockEmissionCorrectionScope, revalidateEmissionCorrectionScope } = await import("./emission-entry-corrections");
  vi.mocked(lockEmissionCorrectionScope).mockClear();
  vi.mocked(revalidateEmissionCorrectionScope).mockClear();
  const batch = { id: "batch", facilityId: "facility" };
  await lockEmissionCommentBatch(ctx, transaction([[batch], [{}], [batch]]), "batch");
  expect(locks).toEqual([[facilities, "share"], [creditBatches, "update"]]);
  expect(lockEmissionCorrectionScope).not.toHaveBeenCalled();
  expect(revalidateEmissionCorrectionScope).not.toHaveBeenCalled();
});
