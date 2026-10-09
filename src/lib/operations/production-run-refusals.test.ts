import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { productionRuns } from "@/db/schema";
import { withAutoCodes, withUniqueCodeGuard, CODE_CONFLICT_MESSAGES } from "@/data-access/code-generator";
import { assertProductionRunStockSnapshot } from "@/data-access/production-run-stock-locks";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { toActionFailure } from "@/fn/action-errors";
import { actionFailureResponse } from "@/lib/api/problem";
import { toolFailure } from "@/lib/mcp/results";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

vi.mock("@/db", () => ({ db: {} }));
const ctx = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false } as const;
const context = { instance: "/api/v1/production-runs", requestId: "request" } as ApiRouteContext;
const collision = { cause: { code: "23505", constraint: "production_runs_organization_id_code_unique" } };

async function transportErrors(work: () => Promise<unknown>) {
  const error = await withProductionRunErrors(work).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(DomainError);
  const failure = toActionFailure(error, { fallbackMessage: "Failed", log: { message: "Test" }, logUnexpected: false });
  const rest = actionFailureResponse(failure, context.instance, context.requestId);
  const mcp = await toolFailure(error, context, "update_production_run");
  return { status: rest.status, rest: await rest.json(), mcp };
}

it.each(["update", "create"])("returns a code conflict through REST and MCP for %s", async (kind) => {
  const tx = {
    select: () => ({ from: () => ({ where: async () => [{ maxSuffix: 0 }] }) }),
    transaction: async (work: (tx: DbTransaction) => Promise<unknown>) => work(tx as unknown as DbTransaction),
  };
  const fail = async () => { throw collision; };
  const result = await transportErrors(() => kind === "update"
    ? withUniqueCodeGuard(ctx, productionRuns, productionRuns.code, CODE_CONFLICT_MESSAGES.productionRun, fail)
    : withAutoCodes(ctx, tx as unknown as DbTransaction, "PR", productionRuns, productionRuns.code, 1, fail, CODE_CONFLICT_MESSAGES.productionRun));
  const issue = { pointer: "/code", code: "conflict", detail: expect.any(String) };
  expect(result.status).toBe(409);
  expect(result.rest).toMatchObject({ code: "conflict", errors: [issue] });
  expect(result.mcp).toMatchObject({ isError: true, structuredContent: { code: "conflict", issues: [issue] } });
});

it.each([
  { feedstockStorageLocationIds: ["new-source"], biocharStorageLocationId: "output" },
  { feedstockStorageLocationIds: ["source"], biocharStorageLocationId: "new-output" },
])("returns retryable 409 when discovery no longer matches the locked stock snapshot: %j", async (locked) => {
  const discovered = { feedstockStorageLocationIds: ["source"], biocharStorageLocationId: "output" };
  const patch = { status: "complete" };
  expect(() => assertProductionRunStockSnapshot(discovered, discovered, patch)).not.toThrow();
  const result = await transportErrors(async () => assertProductionRunStockSnapshot(discovered, locked, patch));
  expect(result.status).toBe(409);
  expect(result.rest).toMatchObject({ code: "concurrent_write_retry", retryable: true });
  expect(result.mcp).toMatchObject({ isError: true, structuredContent: { code: "concurrent_write_retry", retryable: true } });
});

it("preserves typed refusals and keeps ordinary validation errors non-retryable", async () => {
  const typed = new DomainError("conflict", "Conflict", { issues: [{ path: ["code"], code: "conflict", message: "Conflict" }] });
  await expect(withProductionRunErrors(async () => { throw typed; })).rejects.toBe(typed);
  const result = await transportErrors(async () => { throw new SafeError("Invalid run"); });
  expect(result.status).toBe(422);
  expect(result.rest).toMatchObject({ code: "validation_failed", retryable: false });
});

it("does not turn unrelated unique constraints into code conflicts", async () => {
  const unrelated = { cause: { code: "23505", constraint: "production_runs_reactor_start_unique_idx" } };
  await expect(withUniqueCodeGuard(ctx, productionRuns, productionRuns.code, CODE_CONFLICT_MESSAGES.productionRun,
    async () => { throw unrelated; })).rejects.toBe(unrelated);
});
