import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { formulationLineInUse } from "@/lib/formulation-domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { toolFailure } from "../results";
import type { ApiRouteContext } from "@/lib/api/route";
import { formulationWriteTools } from "./formulation-tools";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/read-models/api-formulations", () => ({ readApiFormulation: mocks.read }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
const row = { id: ID, code: "BCF-0001", name: "Blend", version: 1, biocharRatio: 0.7, description: null,
  lines: [], archivedAt: null, createdAt: CLOCK, updatedAt: CLOCK };
const context = { ctx: { credentialId: "credential", organizationId: "org", userId: "user" }, deadlineAt: 0,
  requestId: "request", instance: "/api/mcp", headers: new Headers() } as unknown as ApiRouteContext;
const args = (name: string) => name === "create_formulation" ? { name: "Blend", biocharRatio: 0.7 } : { formulationId: ID, expectedVersion: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.read.mockResolvedValue(row);
  mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error);
    return { data: operation.id === "delete_formulation" ? row : { formulation: row }, dryRun: options.dryRun, replayed: false };
  });
});
it.each(["create_formulation", "update_formulation", "delete_formulation", "archive_formulation", "restore_formulation"])("requires a key and supports keyless previews for %s", async name => {
  const tool = formulationWriteTools.find(candidate => candidate.name === name)!;
  await expect(tool.execute(context, args(name))).rejects.toMatchObject({ code: "idempotency_key_required" });
  expect(mocks.run).not.toHaveBeenCalled();
  const preview = await tool.execute(context, { ...args(name), dryRun: true });
  expect(preview.body).toEqual({ data: row });
  expect(tool.output.safeParse(preview.body).success).toBe(true);
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
});

it.each(formulationWriteTools)("shares REST replay identity and audit on $name", async tool => {
  const result = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
  const [operation, ctx, input, options] = mocks.run.mock.calls[0];
  expect(operation.id).toBe(tool.name);
  expect(ctx).toBe(context.ctx);
  expect(input).toEqual(args(tool.name));
  expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
  expect(options.idempotency).toEqual({ credentialId: "credential", key: "write",
    ...(tool.name === "create_formulation" ? {} : { target: ID, precondition: '"1.2"' }) });
  expect(result.body).toEqual(tool.name === "delete_formulation" ? { deleted: { id: ID, code: row.code } } : { data: row });
  expect(tool.output.safeParse(result.body).success).toBe(true);
  expect(tool.summarize(result.body, false)).toContain(row.code);
});
it.each(formulationWriteTools.filter(tool => tool.name !== "create_formulation"))("requires a version and canonicalizes the UUID on $name", async tool => {
  await expect(tool.execute(context, { formulationId: ID, requestKey: "write" }))
    .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["expectedVersion"] }] });
  expect(mocks.run).not.toHaveBeenCalled();
  await tool.execute(context, { formulationId: ID.toUpperCase(), expectedVersion: 1, requestKey: "write" });
  expect(mocks.run.mock.calls[0][3].idempotency.target).toBe(ID);
});
it.each(formulationWriteTools)("rejects extra fields on $name", async tool => {
  await expect(tool.execute(context, { ...args(tool.name), requestKey: "write", extra: true }))
    .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["extra"], code: "unknown_field" }] });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("publishes solid blend guidance and strict ratio constraints without expanding server instructions", async () => {
  const { mcpInstructions } = await import("../instructions");
  const MAX_INSTRUCTION_CHARS = 2000;
  expect(mcpInstructions.length).toBeLessThanOrEqual(MAX_INSTRUCTION_CHARS);
  for (const tool of formulationWriteTools) {
    expect(tool.description).not.toMatch(/[–—]/);
    expect(tool.description.includes("Restore before editing.")).toBe(tool.name === "update_formulation");
    if (tool.name !== "create_formulation") expect(tool.description).toContain("find_formulations (formulations:read)");
    expect(tool.description).toContain("Required unless dryRun is true");
    if (tool.name === "create_formulation" || tool.name === "update_formulation") {
      expect(tool.description).toContain("find_feedstock_types (feedstock-types:read)");
      expect(tool.description).toContain("at most 6 decimals");
      expect(tool.input.safeParse({ ...args(tool.name), biocharRatio: 0.3333333 }).success).toBe(false);
      expect(tool.input.safeParse({ ...args(tool.name), biocharRatio: 0.8, lines: [{ feedstockTypeId: ID, ratio: 0.3 }] }).success).toBe(false);
    } else expect(tool.description).toContain("archived: true");
  }
});


it.each(formulationWriteTools.filter(tool => tool.name !== "create_formulation"))("returns the current representation on stale $name", async tool => {
  mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
  const failure = await tool.execute(context, { ...args(tool.name), requestKey: "write" })
    .catch(error => toolFailure(error, context, tool.name));
  expect(failure).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: row } });
});
it("preserves the refusal code, pointer and blocker metadata in an isError result", async () => {
  const tool = formulationWriteTools.find(candidate => candidate.name === "update_formulation")!;
  mocks.run.mockRejectedValueOnce(formulationLineInUse(ID, ID, ["BC-0001"]));
  const failure = await tool.execute(context, { ...args(tool.name), lines: [], requestKey: "write" })
    .catch(error => toolFailure(error, context, tool.name));
  expect(failure).toMatchObject({ isError: true, structuredContent: { code: "conflict", issues: [{ code: "conflict", pointer: "/lines",
    meta: { formulationIngredientId: ID, feedstockTypeId: ID, productCodes: ["BC-0001"] } }] } });
});
it.each(formulationWriteTools)("restores the response property order on $name replay", async tool => {
  const original = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
  const reversed = Object.fromEntries(Object.entries(row).reverse());
  mocks.run.mockResolvedValueOnce({ data: tool.name === "delete_formulation" ? reversed : { formulation: reversed }, dryRun: false, replayed: true });
  const replay = await tool.execute(context, { ...args(tool.name), requestKey: "write" });
  expect(replay.replayed).toBe(true);
  expect(JSON.stringify(replay.body)).toBe(JSON.stringify(original.body));
});
