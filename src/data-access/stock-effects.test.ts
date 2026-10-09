import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { deadlineExceeded } from "@/lib/domain-errors";
import { runOperation, type OperationScope } from "@/lib/operations/runner";
import { readStockBalances } from "./stock-effects";

const { lane, output, warn, owned } = vi.hoisted(() => ({ lane: vi.fn(), output: vi.fn(), warn: vi.fn(), owned: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: lane }));
vi.mock("./output-stock", () => ({ getOutputBinAllLayersDryKg: output }));
vi.mock("./owned-transaction", () => ({ runOwnedTransaction: owned }));
vi.mock("./api-audit-events", () => ({ writeApiAuditEvent: vi.fn() }));
vi.mock("./api-idempotency-records", () => ({ recordIdempotencyOutcome: vi.fn(), claimIdempotencyKey: vi.fn(), assertIdempotencyKeyUnused: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { warn, error: vi.fn() }, sanitizeErrorMessage: () => "sanitized" }));

const ctx = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
const BIN_ID = "11111111-1111-4111-8111-111111111111";
const BEFORE_KG = 100;
const AFTER_KG = 80;
const unknownBalance = { wetKg: null, dryKg: null };

function transaction(type: "feedstock_bin" | "biochar_bin" = "feedstock_bin") {
  let aborted = false;
  const events: string[] = [];
  const metadata = vi.fn(async () => [{ id: BIN_ID, code: "B-1", type }]);
  const tx = {
    select: () => ({ from: () => ({ where: metadata }) }),
    transaction: async (work: (savepoint: DbTransaction) => Promise<unknown>) => {
      events.push("savepoint");
      try {
        const result = await work(tx as unknown as DbTransaction);
        events.push("release");
        return result;
      } catch (error) {
        aborted = false;
        events.push("rollback");
        throw error;
      }
    },
  } as unknown as DbTransaction;
  return { tx, events, metadata, fail: () => { aborted = true; }, assertUsable: () => expect(aborted).toBe(false) };
}

beforeEach(() => vi.resetAllMocks());

describe("stock observations do not refuse a valid dry run", () => {
  it.each([
    ["before", "feedstock_bin"], ["after", "feedstock_bin"],
    ["before", "biochar_bin"], ["after", "biochar_bin"],
  ] as const)("isolates a failed %s observation for %s", async (phase, kind) => {
    const state = transaction(kind);
    const failure = kind === "feedstock_bin"
      ? Object.assign(new Error("private SQL values"), { code: "22003" })
      : new RangeError("private historical solids values");
    let observations = 0;
    const read = async (_ctx: OrgContext, executor: unknown, outputTx?: DbTransaction) => {
      expect(kind === "feedstock_bin" ? executor : outputTx).toBe(state.tx);
      observations++;
      if (observations === (phase === "before" ? 1 : 2)) {
        state.fail();
        throw failure;
      }
      state.assertUsable();
      const mass = observations === 1 ? BEFORE_KG : AFTER_KG;
      return kind === "feedstock_bin" ? [{ feedstockStockWetKg: mass, feedstockEstimatedDryKg: mass }] : mass;
    };
    lane.mockImplementation(read);
    output.mockImplementation(read);
    owned.mockImplementation(async (_ctx, _deadline, work) => {
      try { return { kind: "committed", data: await work(state.tx) }; }
      catch (error) { state.assertUsable(); return { kind: "callback_threw", error }; }
    });
    const execute = vi.fn(async (scope: OperationScope) => {
      await scope.snapshotStock?.(scope.tx, [BIN_ID]);
      state.assertUsable();
      return { saved: true };
    });
    const result = await runOperation({ id: "test_observation", input: z.object({}), supportsDryRun: true, execute }, ctx, {}, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, data: { saved: true }, stockEffects: [{
      storageLocationId: BIN_ID, [phase]: unknownBalance, delta: unknownBalance,
    }] });
    expect(execute).toHaveBeenCalledOnce();
    expect(state.events).toEqual(["savepoint", "release", "savepoint", phase === "before" ? "rollback" : "release",
      "savepoint", "release", "savepoint", phase === "after" ? "rollback" : "release"]);
    expect(warn).toHaveBeenCalledExactlyOnceWith({ errorClass: failure.constructor.name, storageLocationId: BIN_ID }, "Stock observation failed");
  });

  it("recovers from an observation lock timeout before the request deadline", async () => {
    const { tx } = transaction();
    lane.mockRejectedValue(Object.assign(new Error("lock timeout"), { code: "55P03" }));
    await expect(readStockBalances(ctx, tx, [BIN_ID])).resolves.toMatchObject([{ balance: unknownBalance }]);
  });

  it.each([
    deadlineExceeded("during observation"),
    { code: "08006" },
    Object.assign(new Error("query cancelled"), { code: "57014" }),
    Object.assign(new Error("transaction timeout"), { code: "25P04" }),
    Object.assign(new Error("connection failed"), { code: "08006" }),
    Object.assign(new Error("socket failed"), { code: "ECONNRESET" }),
    new Error("Connection terminated unexpectedly"),
  ])("propagates deadline and connection failures: %s", async (failure) => {
    const { tx } = transaction();
    lane.mockRejectedValue(failure);
    await expect(readStockBalances(ctx, tx, [BIN_ID])).rejects.toBe(failure);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not hide a failed savepoint rollback", async () => {
    const state = transaction();
    const disconnect = new Error("rollback connection closed");
    const tx = { ...state.tx, transaction: async () => { throw disconnect; } } as unknown as DbTransaction;
    await expect(readStockBalances(ctx, tx, [BIN_ID])).rejects.toBe(disconnect);
  });
});
