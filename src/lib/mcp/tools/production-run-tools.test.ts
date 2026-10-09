import { beforeEach, expect, it, vi } from "vitest";
import { productionRunRepresentationSchema } from "@/lib/representations/production-runs";
import { createProductionRunInput, updateProductionRunInput } from "@/schemas/production-run-input";
import { deleteProductionRunSchema } from "@/schemas/production-runs";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { PRODUCTION_RUN_GUIDANCE } from "@/lib/operations/agent-guidance";
import { productionRunWriteTools } from "./production-run-tools";
import { readTools } from "./read-tools";
import { mcpRequestAccess } from "../server";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), start: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/operations/production-runs", async () => {
  const { createProductionRunInput: input, updateProductionRunInput: update } = await import("@/schemas/production-run-input");
  const { deleteProductionRunSchema: remove } = await import("@/schemas/production-runs");
  const describe = vi.fn();
  return {
    startProductionRun: { id: "start_production_run", input, execute: mocks.start, describe, supportsDryRun: true },
    updateProductionRun: { id: "update_production_run", input: update, execute: mocks.update, describe, supportsDryRun: true },
    deleteProductionRun: { id: "delete_production_run", input: remove, execute: mocks.remove, describe, supportsDryRun: true },
  };
});
vi.mock("@/lib/read-models/api-production-runs", () => ({ readApiProductionRun: mocks.read, readApiProductionRunList: vi.fn() }));
vi.mock("@/lib/read-models/api-reactors", () => ({ readApiReactorList: vi.fn(), readApiReactor: vi.fn() }));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstock: mocks.read, readApiFeedstockList: vi.fn() }));
vi.mock("@/data-access/feedstocks", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
const row = productionRunRepresentationSchema.parse({
  id: ID, code: "PR-26-0001", version: 1, facilityId: ID, reactorId: ID,
  status: "running", startTime: CLOCK, feedstockDraws: [], createdAt: CLOCK, updatedAt: CLOCK,
  ...Object.fromEntries(["cancellationReason", "endTime", "operatorId", "feedstockMoisturePercent", "feedingRateKgHr", "residenceTimeMinutes",
    "dieselOperationLiters", "dieselGensetLiters", "preprocessingFuelLiters", "electricityKwh", "biocharOutputKg", "biocharMoisturePercent",
    "biocharStorageLocationId"].map((key) => [key, null])),
});
const context = {
  ctx: { userId: "user", credentialId: "credential", organizationId: "org", orgRole: "admin", scopes: ["production-runs:write", "production-runs:read", "production-runs:delete", "reactors:read"] },
  deadlineAt: 0, requestId: "request", instance: "/api/mcp", headers: new Headers(),
} as unknown as ApiRouteContext;
const create = { facilityId: ID, reactorId: ID, startTime: CLOCK, status: "running" };
const target = { productionRunId: ID, expectedVersion: 1 };
const args = (name: string) => name === "start_production_run" ? create : target;
beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.read.mockResolvedValue(row);
  mocks.start.mockResolvedValue(row);
  mocks.update.mockResolvedValue(row);
  mocks.run.mockResolvedValue({ data: row, dryRun: false, replayed: false, stockEffects: [] });
});
it.each(productionRunWriteTools)("runs $name with shared input, scopes, replay options and summaries", async (tool) => {
  const result = await tool.execute(context, { ...args(tool.name), requestKey: "one-write" });
  const [operation, ctx, input, options] = mocks.run.mock.calls[0];
  expect(ctx).toBe(context.ctx);
  expect(operation.input).toBe(tool.name === "start_production_run" ? createProductionRunInput : tool.name === "update_production_run" ? updateProductionRunInput : deleteProductionRunSchema);
  expect(input).toEqual(args(tool.name));
  expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
  expect(options.idempotency).toEqual({ credentialId: "credential", key: "one-write", ...(tool.name === "start_production_run" ? {} : { target: ID, precondition: '"1.2"' }) });
  expect(tool.output.safeParse(result.body).success).toBe(true);
  expect(tool.summarize(result.body, false)).toContain(row.code);
  expect(tool.description).toContain(PRODUCTION_RUN_GUIDANCE);
  expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: tool.name !== "start_production_run" });
});
it.each(productionRunWriteTools)("requires a requestKey for $name and allows key-free dry runs", async (tool) => {
  await expect(tool.execute(context, args(tool.name))).rejects.toMatchObject({ code: "idempotency_key_required" });
  expect(mocks.run).not.toHaveBeenCalled();
  const result = await tool.execute(context, { ...args(tool.name), dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(result.body.stockEffects).toEqual([]);
  expect(tool.summarize(result.body, true)).toMatch(/^Dry run: would/);
});
it("uses the same representation enrichment in the operation transaction for creates and updates", async () => {
  for (const tool of productionRunWriteTools.slice(0, 2)) {
    await tool.execute(context, { ...args(tool.name), requestKey: "write" });
    const operation = mocks.run.mock.calls.at(-1)![0];
    const scope = { ctx: context.ctx, tx: {}, afterCommit: vi.fn() };
    expect(await operation.execute(scope, operation.input.parse(args(tool.name)))).toEqual(row);
    expect(mocks.read).toHaveBeenLastCalledWith(context.ctx, { id: ID }, scope.tx);
  }
});
it("registers production read tools and classifies admitted writes by scope", () => {
  for (const [name, scope] of [["find_production_runs", "production-runs:read"], ["get_production_run", "production-runs:read"], ["find_reactors", "reactors:read"]]) {
    expect(readTools.find((tool) => tool.name === name)).toMatchObject({ kind: "read", scope });
  }
  for (const tool of productionRunWriteTools) {
    const request = { method: "tools/call", params: { name: tool.name } };
    expect(mcpRequestAccess(context.ctx, request)).toBe("write");
    expect(mcpRequestAccess({ ...context.ctx, scopes: ["production-runs:read"] }, request)).toBe("read");
  }
});
it("returns current on stale and rejects nested unknown fields", async () => {
  mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
  await expect(productionRunWriteTools[1].execute(context, { ...target, requestKey: "write" }))
    .rejects.toMatchObject({ status: 412, current: row });
  await expect(productionRunWriteTools[0].execute(context, { ...create, requestKey: "write", feedstockDraws: [{ storageLocationId: ID, wetMassKg: 100, guessed: true }] }))
    .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["feedstockDraws", 0, "guessed"] }] });
});

it.each(productionRunWriteTools.slice(0, 2))("re-renders JSONB key order for $name replays", async (tool) => {
  const original = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
  const reordered = Object.fromEntries(Object.entries(row).reverse());
  mocks.run.mockResolvedValueOnce({ data: reordered, dryRun: false, replayed: true });
  const replay = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
  expect(JSON.stringify(replay.body)).toBe(JSON.stringify(original.body));
});

it.each(["get_production_run", "get_feedstock"])("answers not_found for a control character in %s idOrCode, as REST does", async (name) => {
  const tool = readTools.find((candidate) => candidate.name === name)!;
  mocks.read.mockClear();
  for (const control of ["\u0000", "\n", "\u007f", "\u0085"]) {
    await expect(tool.execute(context.ctx, { idOrCode: `PR-${control}` })).rejects.toMatchObject({ code: "not_found" });
  }
  expect(mocks.read).not.toHaveBeenCalled();
});

it("still rejects control characters in the list filters q, code and cursor", async () => {
  const list = readTools.find((candidate) => candidate.name === "find_production_runs")!;
  for (const field of ["q", "code", "cursor"]) {
    await expect(async () => list.execute(context.ctx, { [field]: "bad\u0001value" })).rejects.toMatchObject({ status: 400, code: "invalid_query" });
  }
});
