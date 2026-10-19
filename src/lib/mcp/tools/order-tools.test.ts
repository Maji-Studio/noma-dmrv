import { beforeEach, expect, it, vi } from "vitest";
import { ORDER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "@/lib/api/etag";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { ORDER_GUIDANCE } from "@/lib/operations/agent-guidance";
import { orderQuantityBelowAllocated } from "@/lib/order-domain-errors";
import { deleteOrderInput, recordOrderInput, updateOrderInput } from "@/schemas/order-input";
import { toolFailure, toolOutputSchema } from "../results";
import { toToolSchema } from "@/lib/operations/mcp-schema";
import { orderWriteTools } from "./order-tools";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/orders", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/organization-settings", () => ({}));
vi.mock("@/data-access/transport-legs", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/read-models/api-orders", () => ({ readApiOrder: mocks.read }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
const MASS_KG = 100;
const row = { id: ID, code: "OR-26-0001", version: 1, facilityId: ID, customerId: ID, customerLocationId: ID,
  formulationId: ID, orderDate: "2026-09-12", quantityKg: MASS_KG, packaging: "bagged", archivedAt: null, createdAt: CLOCK, updatedAt: CLOCK };
const create = { facilityId: ID, customerId: ID, customerLocationId: ID, formulationId: ID, orderDate: row.orderDate, quantityKg: MASS_KG };
const target = { orderId: ID, expectedVersion: row.version };
const context = { ctx: { credentialId: "credential", organizationId: "org", userId: "user" }, deadlineAt: 0,
  requestId: "request", instance: "/api/mcp", headers: new Headers() } as unknown as ApiRouteContext;
const args = (name: string) => name === "record_order" ? create : target;
const schema = (name: string) => name === "record_order" ? recordOrderInput : name === "update_order" ? updateOrderInput : deleteOrderInput;
const tool = (name: string) => orderWriteTools.find((candidate) => candidate.name === name)!;
beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.read.mockResolvedValue(row);
  mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error);
    return { data: operation.id === "delete_order" ? row : { order: row, warnings: [] }, dryRun: options.dryRun, replayed: false };
  });
});

it.each(orderWriteTools)("reuses the operation input, audit and REST replay precondition for $name", async (candidate) => {
  const result = await candidate.execute(context, { ...args(candidate.name), requestKey: "write" });
  const [operation, ctx, input, options] = mocks.run.mock.calls[0];
  expect(operation.input).toBe(schema(candidate.name));
  expect(ctx).toBe(context.ctx);
  expect(input).toEqual(args(candidate.name));
  expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
  expect(options.idempotency).toEqual({ credentialId: "credential", key: "write",
    ...(candidate.name === "record_order" ? {} : { target: ID, precondition: representationEtag(row.version, ORDER_REPRESENTATION_REVISION) }) });
  expect(candidate.output.safeParse(result.body).success).toBe(true);
  expect(candidate.annotations).toEqual({ readOnlyHint: false, openWorldHint: false, idempotentHint: true, destructiveHint: candidate.name !== "record_order" });
  expect(candidate.summarize(result.body, false)).toContain(row.code);
});
it("uses the separate delete scope", () => {
  expect(orderWriteTools.map((candidate) => [candidate.name, candidate.scope])).toEqual([
    ["record_order", "orders:write"], ["update_order", "orders:write"], ["delete_order", "orders:delete"],
  ]);
});
it.each(orderWriteTools)("requires a key for $name, but previews without claiming one", async (candidate) => {
  await expect(candidate.execute(context, args(candidate.name))).rejects.toMatchObject({ code: "idempotency_key_required", issues: [{ path: ["requestKey"] }] });
  expect(mocks.run).not.toHaveBeenCalled();
  const result = await candidate.execute(context, { ...args(candidate.name), dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(result.body).toEqual({ data: row });
  expect(candidate.summarize(result.body, true)).toMatch(/^Dry run: would/);
});
it.each(["update_order", "delete_order"])("requires expectedVersion on %s", async (name) => {
  await expect(tool(name).execute(context, { orderId: ID, requestKey: "write" })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["expectedVersion"] }] });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("publishes calendar dates, required location and the conditional key rule", () => {
  for (const candidate of orderWriteTools) {
    const published = toToolSchema(candidate.input)["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    expect(published.required).not.toContain("requestKey");
    const properties = published.properties as Record<string, { description?: string; type?: string; format?: string }>;
    expect(properties.requestKey.description).toContain("Required unless dryRun is true");
    if (candidate.name !== "delete_order") expect(properties.orderDate).toMatchObject({ type: "string", format: "date" });
    expect(toolOutputSchema(candidate.output)["~standard"].jsonSchema.output({ target: "draft-2020-12" }).type).toBe("object");
  }
  expect(tool("update_order").input.safeParse({ ...target, customerLocationId: null }).success).toBe(false);
  expect(tool("record_order").input.safeParse({ ...create, orderDate: CLOCK }).success).toBe(false);
});
it("refuses unknown fields and invalid calendar dates", async () => {
  await expect(tool("record_order").execute(context, { ...create, requestKey: "write", value: 1 })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["value"], code: "unknown_field" }] });
  await expect(tool("record_order").execute(context, { ...create, requestKey: "write", orderDate: "2026-02-30" })).rejects.toMatchObject({ code: "validation_failed" });
});
it("canonicalizes the target before constructing replay options", async () => {
  await tool("update_order").execute(context, { ...target, orderId: ID.toUpperCase(), requestKey: "write" });
  expect(mocks.run.mock.calls[0][3].idempotency.target).toBe(ID);
});
it.each(["record_order", "update_order"])("returns REST's body and restores its key order on %s replay", async (name) => {
  const original = await tool(name).execute(context, { ...args(name), requestKey: "write" });
  expect(original.body).toEqual({ data: row });
  mocks.run.mockResolvedValueOnce({ data: { order: Object.fromEntries(Object.entries(row).reverse()), warnings: [] }, dryRun: false, replayed: true });
  const replay = await tool(name).execute(context, { ...args(name), requestKey: "write" });
  expect(JSON.stringify(replay.body)).toBe(JSON.stringify(original.body));
});
it("preserves adapter warnings in the body and summary", async () => {
  const warning = "Check the requested quantity.";
  mocks.run.mockResolvedValueOnce({ data: { order: row, warnings: [warning] }, dryRun: false, replayed: false });
  const result = await tool("record_order").execute(context, { ...create, requestKey: "write" });
  expect(result.body).toEqual({ data: row, warnings: [warning] });
  expect(tool("record_order").summarize(result.body, false)).toContain(warning);
});
it("returns deleted identity and exact summaries", async () => {
  const result = await tool("delete_order").execute(context, { ...target, requestKey: "write" });
  expect(result.body).toEqual({ deleted: { id: ID, code: row.code } });
  expect(tool("delete_order").summarize(result.body, false)).toBe(`Deleted order ${row.code}.`);
  expect(tool("record_order").summarize({ data: row }, false)).toBe(`Recorded order ${row.code} (version 1).`);
  expect(tool("update_order").summarize({ data: row }, false)).toBe(`Updated order ${row.code} to version 1.`);
});
it.each(["update_order", "delete_order"])("keeps the current representation on stale %s", async (name) => {
  mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
  let caught: unknown;
  try { await tool(name).execute(context, { ...target, requestKey: "write" }); } catch (error) { caught = error; }
  expect(await toolFailure(caught, context, name)).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current: row } });
});
it("preserves quantity issue codes, pointers and metadata in isError results", async () => {
  const failure = await toolFailure(orderQuantityBelowAllocated(MASS_KG), context, "update_order");
  expect(failure).toMatchObject({ isError: true, structuredContent: { code: "validation_failed", issues: [{ code: "validation_failed", pointer: "/quantityKg", meta: { allocatedWetKg: MASS_KG, unit: "kg" } }] } });
});
it("grounds references and describes wet kg, defaults, calendar date and frozen relationships", () => {
  const record = tool("record_order");
  for (const name of ["find_customers", "find_customer_locations", "find_formulations", "whoami"]) expect(record.description).toContain(name);
  for (const candidate of orderWriteTools.slice(0, 2)) expect(candidate.description).toContain(ORDER_GUIDANCE);
  for (const candidate of orderWriteTools) expect(candidate.description).not.toMatch(/[–—]/);
});

it.each([undefined, null, ""])("refuses a missing delivery site in record_order: %s", async (customerLocationId) => {
  await expect(tool("record_order").execute(context, { ...create, customerLocationId, requestKey: "write" }))
    .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["customerLocationId"] }] });
});
it.each([null, ""])("refuses clearing the delivery site in update_order: %s", async (customerLocationId) => {
  await expect(tool("update_order").execute(context, { ...target, customerLocationId, requestKey: "write" }))
    .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["customerLocationId"] }] });
  expect(mocks.run).not.toHaveBeenCalled();
});
