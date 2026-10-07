import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { runOperation, runOperationInProcess, type Operation, type OperationScope, type RunOptions } from "./runner";

const { owned, record, claim, warn } = vi.hoisted(() => ({ owned: vi.fn(), record: vi.fn(), claim: vi.fn(), warn: vi.fn() }));
vi.mock("@/data-access/owned-transaction", () => ({ runOwnedTransaction: owned }));
vi.mock("@/data-access/api-idempotency-records", () => ({ recordIdempotencyOutcome: record, claimIdempotencyKey: claim, assertIdempotencyKeyUnused: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { warn }, sanitizeErrorMessage: () => "sanitized" }));
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
  it("keeps native Dates for in-process results and JSON Dates for API responses and replays", async () => {
    expect((await runOperationInProcess(operation, ctx, { amount: 1 })).date).toBe(saved);
    claim.mockResolvedValueOnce({ kind: "claimed", recordId: "record-id" });
    const options = { idempotency: { credentialId: "credential-id", key: "key" } };
    const first = await runOperation(operation, ctx, { amount: 1 }, options);
    expect(first.data.date).toBe(saved.toISOString());
    expect(record).toHaveBeenCalledWith(ctx, tx, "record-id", first.data);
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
    const op = { ...operation, execute };
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
    expect(await runOperationInProcess({ ...operation, execute: async () => undefined }, ctx, { amount: 1 })).toBeUndefined();
  });
});
