import { OPERATION_MAX_ATTEMPTS, OPERATION_RETRY_MAX_DELAY_MS } from "@/config/operations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { toActionFailure } from "@/fn/action-errors";
import { runOperation, runOperationInProcess, type Operation, type OperationScope, type RunOptions } from "./runner";

const { owned, record, claim, warn, balances } = vi.hoisted(() => ({ owned: vi.fn(), record: vi.fn(), claim: vi.fn(), warn: vi.fn(), balances: vi.fn() }));
vi.mock("@/data-access/stock-effects", () => ({ readStockBalances: balances }));
vi.mock("@/data-access/api-audit-events", () => ({ writeApiAuditEvent: vi.fn() }));
vi.mock("@/data-access/owned-transaction", () => ({ runOwnedTransaction: owned }));
vi.mock("@/data-access/api-idempotency-records", () => ({ recordIdempotencyOutcome: record, claimIdempotencyKey: claim, assertIdempotencyKeyUnused: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { warn, error: vi.fn() }, sanitizeErrorMessage: () => "sanitized" }));
const ctx = { userId: "user-id", organizationId: "org-id", orgRole: "admin", isPlatformAdmin: false } satisfies OrgContext;
const tx = {} as OperationScope["tx"];
const saved = new Date("2026-10-06T00:00:00Z");
const operation: Operation<z.ZodObject<{ amount: z.ZodNumber }>, { date: Date; amount: number }> = {
  id: "test_native", input: z.object({ amount: z.number().positive() }), supportsDryRun: true,
  execute: async (_scope, input) => ({ date: saved, amount: input.amount }),
};
beforeEach(() => {
  vi.clearAllMocks();
  owned.mockImplementation(async (_ctx, _deadline, callback) => {
    try { return { kind: "committed", data: await callback(tx) }; }
    catch (error) { return { kind: "callback_threw", error }; }
  });
});
describe("shared operation runner", () => {
  it("snapshots through the writer transaction only on dry runs", async () => {
    const bin = { storageLocationId: "bin", storageLocationCode: "B-1", stockKind: "feedstock_bin", balance: { wetKg: 100, dryKg: 70 } };
    const savepoint = {} as OperationScope["tx"];
    const stockOperation = { ...operation, execute: async (scope: OperationScope, input: { amount: number }) => {
      await scope.snapshotStock?.(savepoint, ["bin"]);
      return operation.execute(scope, input);
    } };
    balances.mockResolvedValueOnce([bin]).mockResolvedValueOnce([{ ...bin, balance: { wetKg: 50, dryKg: 35 } }]);
    const result = await runOperation(stockOperation, ctx, { amount: 1 }, { dryRun: true });
    expect(balances).toHaveBeenNthCalledWith(1, ctx, savepoint, ["bin"]);
    expect(balances).toHaveBeenNthCalledWith(2, ctx, tx, ["bin"]);
    expect(result.stockEffects).toMatchObject([{ delta: { wetKg: -50, dryKg: -35 } }]);
    balances.mockClear();
    expect(await runOperation(stockOperation, ctx, { amount: 1 })).not.toHaveProperty("stockEffects");
    await runOperationInProcess(stockOperation, ctx, { amount: 1 });
    expect(balances).not.toHaveBeenCalled();
  });

  it("gives in-process unknown outcomes operator copy while keeping the API retry contract", async () => {
    const apiError = new DomainError(
      "outcome_unknown",
      "The connection failed while saving, so it is not known whether the change was saved. Retry with the same idempotency key.",
      { retryable: true, cause: new Error("Lost commit acknowledgement") },
    );
    owned.mockRejectedValue(apiError);
    let inProcessError: unknown;
    try {
      await runOperationInProcess(operation, ctx, { amount: 1 });
      expect.unreachable("Expected an unknown outcome");
    } catch (error) {
      inProcessError = error;
    }
    expect(inProcessError).toBeInstanceOf(DomainError);
    expect(inProcessError).toMatchObject({ cause: apiError, retryable: false });
    expect(toActionFailure(inProcessError, {
      fallbackMessage: "The action could not be completed.",
      log: { message: "operation failed" },
    })).toEqual({
      success: false,
      code: "outcome_unknown",
      error: "It is not known whether this change was saved. Check the list before trying again.",
    });
    await expect(runOperation(operation, ctx, { amount: 1 }, {
      idempotency: { credentialId: "credential-id", key: "key" },
    })).rejects.toBe(apiError);
    expect(apiError.retryable).toBe(true);
    expect(apiError.message).toContain("Retry with the same idempotency key.");
  });

  it("keeps native Dates for in-process results and JSON Dates for API responses and replays", async () => {
    expect((await runOperationInProcess(operation, ctx, { amount: 1 })).date).toBe(saved);
    claim.mockResolvedValueOnce({ kind: "claimed", recordId: "record-id" });
    const options = { idempotency: { credentialId: "credential-id", key: "key" } };
    const first = await runOperation(operation, ctx, { amount: 1 }, options);
    expect(first.data.date).toBe(saved.toISOString());
    expect(record).toHaveBeenCalledWith(ctx, tx, "record-id", first.data, undefined);
    claim.mockResolvedValueOnce({ kind: "replay", outcome: first.data });
    expect((await runOperation(operation, ctx, { amount: 1 }, options)).data).toEqual(first.data);
  });

  it("refuses dry run and idempotency at runtime on the native seam", async () => {
    for (const options of [{ dryRun: true }, { dryRun: false }, { idempotency: { credentialId: "id", key: "key" } }] satisfies RunOptions[]) {
      // @ts-expect-error The type contract also refuses these options.
      await expect(runOperationInProcess(operation, ctx, { amount: 1 }, options)).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect(owned).not.toHaveBeenCalled();
  });

  it("shares decode, deadlines, transaction identity, hooks and rollback behavior", async () => {
    const events: string[] = [];
    const execute = vi.fn(async (scope) => {
      expect(scope.tx).toBe(tx);
      expect(scope.ctx).toBe(ctx);
      scope.afterCommit(() => { events.push("hook"); });
      return saved;
    });
    const op = { ...operation, describe: undefined, execute };
    const deadlineMs = 1000;
    const started = Date.now();
    await runOperationInProcess(op, ctx, { amount: 1 }, { deadlineMs });
    expect(owned.mock.calls[0][1]).toBeGreaterThanOrEqual(started + deadlineMs);
    expect(events).toEqual(["hook"]);
    await runOperation(op, ctx, { amount: 1 }, { dryRun: true });
    expect(events).toEqual(["hook"]);
    await expect(runOperationInProcess(op, ctx, { amount: -1 })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["amount"] }] });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("keeps undefined native for void actions", async () => {
    expect(await runOperationInProcess({ ...operation, describe: undefined, execute: async () => undefined }, ctx, { amount: 1 })).toBeUndefined();
  });
});

describe("transaction retries", () => {
  it.each(["40P01", "40001", "55P03"])("restarts the claim and execution after %s and keeps only committed hooks", async (code) => {
    const hook = vi.fn();
    const transactions: OperationScope["tx"][] = [];
    owned.mockImplementation(async (_ctx, _deadline, callback) => {
      const fresh = {} as OperationScope["tx"];
      transactions.push(fresh);
      try { return { kind: "committed", data: await callback(fresh) }; }
      catch (error) { return { kind: "callback_threw", error }; }
    });
    claim.mockResolvedValue({ kind: "claimed", recordId: "record" });
    const execute = vi.fn(async (scope: OperationScope, input: { amount: number }) => {
      scope.afterCommit(hook);
      if (transactions.length === 1) throw new Error("wrapped", { cause: { code } });
      return operation.execute(scope, input);
    });
    const result = await runOperation({ ...operation, execute }, ctx, { amount: 1 }, {
      idempotency: { credentialId: "credential", key: "retry" },
    });
    expect(result).toMatchObject({ data: { amount: 1 }, replayed: false });
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).not.toBe(transactions[1]);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({ operationId: operation.id, attempt: 2, sqlstate: code }, "operation transaction retry");
  });

  it.each(["40P01", "40001", "55P03"].flatMap((code) => [false, true].map((dryRun) => ({ code, dryRun }))))("bounds $code retries and returns a retryable refusal (dry run: $dryRun)", async ({ code, dryRun }) => {
    owned.mockResolvedValue({ kind: "callback_threw", error: { code } });
    await expect(runOperation(operation, ctx, { amount: 1 }, { dryRun }))
      .rejects.toMatchObject({ code: "concurrent_write_retry", retryable: true });
    expect(owned).toHaveBeenCalledTimes(OPERATION_MAX_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(OPERATION_MAX_ATTEMPTS - 1);
  });

  it("does not retry a claim-lock 55P03 mapped to idempotency_in_progress", async () => {
    const failure = new DomainError("idempotency_in_progress", "Still running.", {
      retryable: true, cause: new Error("wrapped", { cause: { code: "55P03" } }),
    });
    claim.mockRejectedValueOnce(failure);
    const execute = vi.fn(operation.execute);
    await expect(runOperation({ ...operation, execute }, ctx, { amount: 1 }, {
      idempotency: { credentialId: "credential", key: "claim-timeout" },
    })).rejects.toBe(failure);
    expect(claim).toHaveBeenCalledOnce();
    expect(owned).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["55P03", "57014"])("maps operation %s past the deadline to deadline_exceeded", async (code) => {
    const budget = OPERATION_RETRY_MAX_DELAY_MS * 2;
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const execute = vi.fn(async () => {
      now.mockReturnValue(start + budget + 1);
      throw new Error("wrapped", { cause: { code } });
    });
    await expect(runOperation({ ...operation, execute }, ctx, { amount: 1 }, { deadlineMs: budget }))
      .rejects.toMatchObject({ code: "deadline_exceeded", retryable: true });
    expect(owned).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries a dry run, returns its preview and never runs hooks", async () => {
    const hook = vi.fn();
    let attempts = 0;
    const execute = async (scope: OperationScope, input: { amount: number }) => {
      scope.afterCommit(hook);
      if (++attempts === 1) throw { code: "40001" };
      return operation.execute(scope, input);
    };
    await expect(runOperation({ ...operation, execute }, ctx, { amount: 1 }, { dryRun: true }))
      .resolves.toMatchObject({ data: { amount: 1 }, dryRun: true });
    expect(owned).toHaveBeenCalledTimes(2);
    expect(hook).not.toHaveBeenCalled();
  });

  it.each(["40P01", "40001", "55P03"])("does not retry commit-sent failures with %s in their cause", async (code) => {
    owned.mockRejectedValue(new DomainError("outcome_unknown", "Unknown.", { retryable: true, cause: { code } }));
    await expect(runOperation(operation, ctx, { amount: 1 })).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(owned).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["23505", "40P01", "40001"])("rethrows proven rollback at COMMIT without retrying %s", async (code) => {
    const failure = Object.assign(new Error("COMMIT refused"), { code });
    owned.mockRejectedValue(failure);
    await expect(runOperation(operation, ctx, { amount: 1 })).rejects.toBe(failure);
    expect(owned).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["expired", "backoff", "overslept"])("does not start another attempt when the budget is %s", async (scenario) => {
    const budget = OPERATION_RETRY_MAX_DELAY_MS * 2;
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    owned.mockImplementation(async () => {
      now.mockReturnValue(scenario === "expired" ? start + budget : scenario === "backoff" ? start + budget - 1 : start);
      if (scenario === "overslept") {
        // The first budget read permits the backoff, but its timer wakes too late.
        now.mockReturnValue(start + budget).mockReturnValueOnce(start).mockReturnValueOnce(start);
      }
      return { kind: "callback_threw", error: { code: "40P01" } };
    });
    await expect(runOperation(operation, ctx, { amount: 1 }, { deadlineMs: budget }))
      .rejects.toMatchObject({ code: "deadline_exceeded", retryable: true });
    expect(owned).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });
});
