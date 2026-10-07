/**
 * `updateFeedstockInTransaction` must never describe a saved feedstock as missing (issue
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
// The post-write lane check (issue #767) runs its own aggregate reads through
// the same transaction. Those reads are not what this spec is about, and
// leaving them live would consume the scripted reads below.
vi.mock("./feedstock-bin-stock-integrity", () => ({
  assertFeedstockBinLanesNotNegative: vi.fn(),
}));
vi.mock("./storage-object-deletions", () => ({
  processPendingStorageObjectDeletions: vi.fn(),
}));
vi.mock("./transport-legs", () => ({
  syncFeedstockTransportLeg: vi.fn(),
  deleteTransportLegsForEntity: vi.fn(),
}));
vi.mock("./documents", () => ({ retireDocumentsForEntities: vi.fn() }));

import { updateFeedstockInTransaction } from "./feedstocks";

const ctx: OrgContext = {
  organizationId: "org",
  userId: "user",
  orgRole: "owner",
  isPlatformAdmin: false,
};

const FEEDSTOCK_ID = "feedstock";
const STORED_ROW = {
  id: FEEDSTOCK_ID,
  version: 1,
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

function watchGlobalReads() {
  return vi.spyOn(db, "select").mockImplementation(() => {
    throw new Error("Feedstock writers must read through tx");
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateFeedstockInTransaction", () => {
  it("reads the updated feedstock back through its own transaction", async () => {
    const tx = makeTx({ rows: [ENRICHED_ROW] });
    const globalRead = watchGlobalReads();

    await expect(
      updateFeedstockInTransaction(ctx, tx, FEEDSTOCK_ID, { expectedVersion: 1, notes: "checked" }),
    ).resolves.toEqual(ENRICHED_ROW);
    expect(tx.update).toHaveBeenCalled();
    // Every read, including the locked existence check, stays on tx.
    expect(globalRead).not.toHaveBeenCalled();
  });

  it("does not report a failed read as a feedstock that was not found", async () => {
    const tx = makeTx({ error: READ_FAILURE });
    watchGlobalReads();

    const result = updateFeedstockInTransaction(ctx, tx, FEEDSTOCK_ID, { expectedVersion: 1, notes: "checked" });

    await expect(result).rejects.toThrow(READ_FAILURE);
    await expect(result).rejects.not.toThrow("Feedstock not found");
  });
});
