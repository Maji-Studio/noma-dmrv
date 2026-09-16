/**
 * `updateFeedstock` must never describe a saved feedstock as missing (issue
 * #769). Its enrichment read runs through the transaction that wrote the row,
 * so a read that fails rolls the update back rather than answering "Feedstock
 * not found" for a feedstock that is in fact saved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";

vi.mock("./certification-lineage-guards", () => ({
  assertCanMutateCertifiedLineage: vi.fn(),
}));
vi.mock("./facility-reference-guards", () => ({
  lockActiveFacilityReference: vi.fn(),
}));
vi.mock("./lock-bin-stocks", () => ({ lockBinStocks: vi.fn() }));
vi.mock("./storage-object-deletions", () => ({
  processPendingStorageObjectDeletions: vi.fn(),
}));
vi.mock("./transport-legs", () => ({
  syncFeedstockTransportLeg: vi.fn(),
  deleteTransportLegsForEntity: vi.fn(),
}));
vi.mock("./documents", () => ({ retireDocumentsForEntities: vi.fn() }));

import { updateFeedstock } from "./feedstocks";

const ctx: OrgContext = {
  organizationId: "org",
  userId: "user",
  orgRole: "owner",
  isPlatformAdmin: false,
};

const FEEDSTOCK_ID = "feedstock";
const STORED_ROW = {
  id: FEEDSTOCK_ID,
  status: "available",
  storageLocationId: "bin",
  facilityId: "facility",
  feedstockTypeId: "type",
  supplierId: "supplier",
  massDryKg: 100,
  massWetKg: 120,
};
const ENRICHED_ROW = { ...STORED_ROW, facilityName: "Facility" };
const READ_FAILURE = new Error("connection terminated unexpectedly");

/** A chainable select whose awaited value is `rows`, or a rejection. */
function selectReturning(read: { rows: unknown[] } | { error: Error }) {
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    for: () => query,
    orderBy: () => query,
    then: (resolve: (rows: unknown) => unknown, reject: (e: unknown) => unknown) =>
      "error" in read
        ? Promise.reject(read.error).then(resolve, reject)
        : Promise.resolve(read.rows).then(resolve),
  };
  return query;
}

/**
 * The transaction reads the locked row first and the enriched row second, so a
 * spec injects the failure into the second read only.
 */
function makeTx(enrichment: { rows: unknown[] } | { error: Error }) {
  const reads = [{ rows: [STORED_ROW] }, enrichment];
  const select = vi.fn(() => selectReturning(reads.shift() ?? { rows: [] }));
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  return { select, update } as unknown as DbTransaction & {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function runInTransaction(tx: DbTransaction) {
  vi.spyOn(db, "transaction").mockImplementation(async (callback) =>
    (callback as (t: DbTransaction) => Promise<unknown>)(tx),
  );
  // The pre-check that the feedstock exists is the one read that predates the
  // transaction; everything after it must go through `tx`.
  return vi
    .spyOn(db, "select")
    .mockImplementation(() => selectReturning({ rows: [STORED_ROW] }) as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateFeedstock", () => {
  it("reads the updated feedstock back through its own transaction", async () => {
    const tx = makeTx({ rows: [ENRICHED_ROW] });
    const globalRead = runInTransaction(tx);

    await expect(
      updateFeedstock(ctx, FEEDSTOCK_ID, { notes: "checked" }),
    ).resolves.toEqual(ENRICHED_ROW);
    expect(tx.update).toHaveBeenCalled();
    // Only the existence pre-check may use the pool.
    expect(globalRead).toHaveBeenCalledTimes(1);
  });

  it("does not report a failed read as a feedstock that was not found", async () => {
    const tx = makeTx({ error: READ_FAILURE });
    runInTransaction(tx);

    const result = updateFeedstock(ctx, FEEDSTOCK_ID, { notes: "checked" });

    await expect(result).rejects.toThrow(READ_FAILURE);
    await expect(result).rejects.not.toThrow("Feedstock not found");
  });
});
