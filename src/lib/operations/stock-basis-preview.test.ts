import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import type { OrgContext } from "@/lib/auth/server";
import type { Operation, OperationResult, RunOptions } from "./runner";

const runner = vi.hoisted(() => ({ runOperation: vi.fn() }));
vi.mock("./runner", () => ({ runOperation: runner.runOperation }));
import { runWithStockBasisPreview } from "./stock-basis-preview";

const NOW = 1_000_000;
const DEADLINE_MS = 10_000;
const ctx = { organizationId: "org", userId: "user", credentialId: "credential" } as unknown as OrgContext;
const operation = { id: "test_op", input: z.object({}), supportsDryRun: true, execute: vi.fn() } as unknown as Operation<z.ZodType, { basisFingerprint: string }>;
const stale = () => new DomainError("stock_basis_changed", "Stock changed.", { conflict: { entity: "storageLocation", id: "bin", code: conflictCode("B1") } });
const effects = [{ storageLocationId: "bin" }] as unknown as OperationResult<{ basisFingerprint: string }>["stockEffects"];
const fresh = (overrides: Partial<OperationResult<{ basisFingerprint: string }>> = {}) =>
  ({ data: { basisFingerprint: "fresh" }, stockEffects: effects, dryRun: true, replayed: false, ...overrides });
const options = (extra: Partial<RunOptions> = {}) => ({
  deadlineAt: NOW + DEADLINE_MS, audit: { transport: "rest" as const, requestId: "request", credentialId: "credential" },
  idempotency: { credentialId: "credential", key: "key" }, ...extra,
});
const basisOf = (data: { basisFingerprint: string }) => data.basisFingerprint;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); runner.runOperation.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("runWithStockBasisPreview", () => {
  it("returns the result of a write that succeeds, with the remaining deadline and no extra run", async () => {
    const result = { data: { basisFingerprint: "a" }, dryRun: false, replayed: false };
    runner.runOperation.mockResolvedValueOnce(result);
    expect(await runWithStockBasisPreview(operation, ctx, { basisFingerprint: "old" }, options(), basisOf)).toBe(result);
    expect(runner.runOperation).toHaveBeenCalledTimes(1);
    expect(runner.runOperation.mock.calls[0][3]).toMatchObject({ deadlineMs: DEADLINE_MS, idempotency: { key: "key" } });
  });

  it("answers a stale basis with a fresh dry run that has no fingerprint, key, audit or second budget", async () => {
    runner.runOperation.mockRejectedValueOnce(stale());
    runner.runOperation.mockImplementationOnce(async () => { vi.setSystemTime(NOW + 4_000); return fresh(); });
    const failure = await runWithStockBasisPreview(operation, ctx, { a: 1, basisFingerprint: "old" }, options(), basisOf).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({ code: "stock_basis_changed", message: "Stock changed.", conflict: { id: "bin" }, preview: { basisFingerprint: "fresh", stockEffects: effects } });
    expect(runner.runOperation).toHaveBeenCalledTimes(2);
    const [, , input, preview] = runner.runOperation.mock.calls[1];
    expect(input).toEqual({ a: 1 });
    expect(preview).toEqual({ dryRun: true, deadlineMs: DEADLINE_MS, pool: undefined });
    expect(preview).not.toHaveProperty("idempotency");
    expect(preview).not.toHaveProperty("audit");
  });

  it("gives the fallback only the time the original deadline has left", async () => {
    runner.runOperation.mockImplementationOnce(async () => { vi.setSystemTime(NOW + 7_500); throw stale(); });
    runner.runOperation.mockResolvedValueOnce(fresh());
    await expect(runWithStockBasisPreview(operation, ctx, {}, options(), basisOf)).rejects.toMatchObject({ preview: expect.anything() });
    expect(runner.runOperation.mock.calls[1][3].deadlineMs).toBe(DEADLINE_MS - 7_500);
  });

  it("returns the original conflict, with no preview and no second run, once the deadline is spent", async () => {
    runner.runOperation.mockImplementationOnce(async () => { vi.setSystemTime(NOW + DEADLINE_MS); throw stale(); });
    const failure = await runWithStockBasisPreview(operation, ctx, {}, options(), basisOf).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "stock_basis_changed" });
    expect(failure).not.toHaveProperty("preview");
    expect(runner.runOperation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the preview fails", () => runner.runOperation.mockRejectedValueOnce(new DomainError("insufficient_stock", "Short."))],
    ["the preview has no fingerprint", () => runner.runOperation.mockResolvedValueOnce(fresh({ data: { basisFingerprint: "" } }))],
    ["the preview has no stock effects", () => runner.runOperation.mockResolvedValueOnce(fresh({ stockEffects: undefined }))],
  ])("returns the original conflict without preview when %s", async (_name, arrange) => {
    runner.runOperation.mockRejectedValueOnce(stale());
    arrange();
    const failure = await runWithStockBasisPreview(operation, ctx, {}, options(), basisOf).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "stock_basis_changed", message: "Stock changed.", conflict: { id: "bin" } });
    expect(failure).not.toHaveProperty("preview");
  });

  it("rethrows every other failure without a preview run", async () => {
    runner.runOperation.mockRejectedValueOnce(new DomainError("insufficient_stock", "Short."));
    await expect(runWithStockBasisPreview(operation, ctx, {}, options(), basisOf)).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(runner.runOperation).toHaveBeenCalledTimes(1);
  });

  it("refuses to start with the deadline already spent", async () => {
    await expect(runWithStockBasisPreview(operation, ctx, {}, { ...options(), deadlineAt: NOW }, basisOf)).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(runner.runOperation).not.toHaveBeenCalled();
  });
});
