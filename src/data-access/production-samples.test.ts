/**
 * The in-process measurement writers must never describe a saved row as
 * missing (issue #769). Both create and update read the row back through the
 * transaction that wrote it, so a failed enrichment read rolls the write back
 * instead of answering "In-process measurement not found." for a row that is
 * in fact there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  createProductionSample,
  updateProductionSample,
} from "./production-samples";

const ctx: OrgContext = {
  organizationId: "org",
  userId: "user",
  orgRole: "owner",
  isPlatformAdmin: false,
};

const SAMPLE_ROW = { id: "sample", operatorName: "Operator" };
const READ_FAILURE = new Error("connection terminated unexpectedly");

/**
 * A transaction whose reads either resolve to `rows` or reject with the given
 * error, so a spec can inject an enrichment-read failure.
 */
function makeTx(read: { rows: unknown[] } | { error: Error }) {
  const select = vi.fn(() => {
    const query = {
      from: () => query,
      leftJoin: () => query,
      where: () => query,
      orderBy: () => query,
      then: (resolve: (rows: unknown) => unknown, reject: (e: unknown) => unknown) =>
        "error" in read
          ? Promise.reject(read.error).then(resolve, reject)
          : Promise.resolve(read.rows).then(resolve),
    };
    return query;
  });
  const insert = vi.fn(() => ({
    values: () => ({ returning: async () => [{ id: SAMPLE_ROW.id }] }),
  }));
  const update = vi.fn(() => ({
    set: () => ({ where: async () => undefined }),
  }));
  return { select, insert, update } as unknown as DbTransaction & {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function runInTransaction(tx: DbTransaction) {
  vi.spyOn(db, "transaction").mockImplementation(async (callback) =>
    (callback as (t: DbTransaction) => Promise<unknown>)(tx),
  );
  return vi.spyOn(db, "select").mockImplementation(() => {
    throw new Error("The global pool must not serve a writer's own read.");
  });
}

const createInput = {
  productionRunId: "run",
  timestamp: new Date("2026-09-16T00:00:00.000Z"),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createProductionSample", () => {
  it("reads the new measurement back through its own transaction", async () => {
    const tx = makeTx({ rows: [SAMPLE_ROW] });
    const globalRead = runInTransaction(tx);

    await expect(createProductionSample(ctx, createInput)).resolves.toEqual(
      SAMPLE_ROW,
    );
    expect(tx.select).toHaveBeenCalled();
    expect(globalRead).not.toHaveBeenCalled();
  });

  it("does not report a failed read as a measurement that was never created", async () => {
    const tx = makeTx({ error: READ_FAILURE });
    runInTransaction(tx);

    // The read fails inside the transaction, so the insert never commits and
    // the failure is the read's own. What it must never be is the "not found"
    // answer a post-commit read would have produced for a saved row.
    await expect(createProductionSample(ctx, createInput)).rejects.toThrow(
      READ_FAILURE,
    );
    expect(tx.insert).toHaveBeenCalled();
  });
});

describe("updateProductionSample", () => {
  it("reads the updated measurement back through its own transaction", async () => {
    const tx = makeTx({ rows: [SAMPLE_ROW] });
    const globalRead = runInTransaction(tx);

    await expect(
      updateProductionSample(ctx, "sample", { notes: "checked" }),
    ).resolves.toEqual(SAMPLE_ROW);
    expect(tx.update).toHaveBeenCalled();
    expect(globalRead).not.toHaveBeenCalled();
  });

  it("does not report a failed read as a measurement that was not saved", async () => {
    const tx = makeTx({ error: READ_FAILURE });
    runInTransaction(tx);

    await expect(
      updateProductionSample(ctx, "sample", { notes: "checked" }),
    ).rejects.toThrow(READ_FAILURE);
  });
});
