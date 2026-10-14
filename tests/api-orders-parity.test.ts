/** Real actions, REST, MCP, credentials and Postgres. Not run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as MCP } from "@/app/api/mcp/route";
import { createOrderFn, deleteOrderFn, updateOrderFn } from "@/fn/orders";
import { jsonPointer } from "@/lib/api/problem";
import { representOrder } from "@/lib/representations/orders";
import { createOrderSchema, updateOrderSchema } from "@/schemas/orders";
import { orderInput } from "./helpers/order-operation-fixture";
import { archiveReadOrder, insertReadDelivery, removeApiOrderReadFixture } from "./helpers/api-order-read-fixture";
import { createApiOrderWriteFixture, deleteOrder, orderAudits, orderRecords, orderRows, patchOrder, postOrder, readRestOrder, type ApiOrderWriteFixture } from "./helpers/api-order-write-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 90_000;
const UPDATED_KG = 120;
const DELIVERED_KG = 40;
const BELOW_ALLOCATED_KG = 39;
const TRANSPORTS = ["action", "rest", "mcp"] as const;
type Transport = typeof TRANSPORTS[number];
const fixtures = new Map<Transport, ApiOrderWriteFixture>();
beforeEach(async () => {
  for (const transport of TRANSPORTS) fixtures.set(transport, await createApiOrderWriteFixture());
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of fixtures.values()) await removeApiOrderReadFixture(f);
  fixtures.clear();
  auth.requireOrgContext.mockReset();
}, TIMEOUT_MS);

async function mcp(f: ApiOrderWriteFixture, name: string, args: Record<string, unknown>, key = f.writeOnlyKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: { ...args, requestKey: randomUUID() } }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
/** The form always supplies packaging; use the same explicit value in every transport. */
const body = (f: ApiOrderWriteFixture, changes: Record<string, unknown> = {}) => orderInput(f, { packaging: "bagged", ...changes });

/** Keep every stored value except generated identities and timestamps, replacing fixture references with labels. */
function scrub(value: unknown, f: ApiOrderWriteFixture): unknown {
  const dropped = new Set(["id", "code", "createdAt", "updatedAt", "cursorCreatedAt"]);
  const labels = [
    [f.ctx.organizationId, "org"], [f.ctx.userId, "user"], [f.facility.id, "facility"], [f.otherFacility.id, "other-facility"],
    [f.customer.id, "customer"], [f.otherCustomer.id, "other-customer"], [f.location.id, "location"], [f.recipe.id, "formulation"], [f.pure.id, "pure"],
  ];
  let text = JSON.stringify(value, (key, v) => dropped.has(key) ? undefined : v);
  for (const [id, label] of labels) text = text.replaceAll(id, `<${label}>`);
  return JSON.parse(text);
}
async function create(transport: Transport, f: ApiOrderWriteFixture) {
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await createOrderFn(createOrderSchema.parse(body(f)));
    if (!result.success) throw new Error(`Create refused: ${result.error}`);
    return { data: representOrder(result.data), warnings: result.warning ? [result.warning] : [] };
  }
  if (transport === "rest") {
    const response = await postOrder(f, body(f));
    expect(response.status).toBe(201);
    const output = await response.json();
    return { data: output.data, warnings: output.warnings ?? [] };
  }
  const result = await mcp(f, "record_order", body(f));
  expect(result.isError).toBeUndefined();
  return { data: result.structuredContent.data, warnings: result.structuredContent.warnings ?? [] };
}
async function update(transport: Transport, f: ApiOrderWriteFixture, id: string, changes: Record<string, unknown>) {
  const current = await readRestOrder(f, id);
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await updateOrderFn(updateOrderSchema.parse({ orderId: id, expectedVersion: current.row.version, ...changes }));
    if (!result.success) throw new Error(`Update refused: ${result.error}`);
    return { data: representOrder(result.data), warnings: result.warning ? [result.warning] : [] };
  }
  if (transport === "rest") {
    const response = await patchOrder(f, id, changes, current.etag);
    expect(response.status).toBe(200);
    const output = await response.json();
    return { data: output.data, warnings: output.warnings ?? [] };
  }
  const result = await mcp(f, "update_order", { orderId: id, expectedVersion: current.row.version, ...changes });
  expect(result.isError).toBeUndefined();
  return { data: result.structuredContent.data, warnings: result.structuredContent.warnings ?? [] };
}
async function outcomes(ids: Map<Transport, string | null>, outputs: Map<Transport, unknown>) {
  const result = new Map<Transport, unknown>();
  for (const transport of TRANSPORTS) {
    const f = fixtures.get(transport)!;
    const id = ids.get(transport);
    result.set(transport, scrub({ rows: await orderRows(f), representation: id ? (await readRestOrder(f, id)).row : null, output: outputs.get(transport) }, f));
  }
  expect(result.get("rest")).toEqual(result.get("action"));
  expect(result.get("mcp")).toEqual(result.get("action"));
}

interface Refusal { code?: string; issues: { pointer: string; code: string; meta?: Record<string, unknown> }[] }
/** Compare domain issue codes, paths and metadata without transport-only fields or prose containing generated codes. */
const apiRefusal = (output: { code: string; errors?: Refusal["issues"]; issues?: Refusal["issues"] }): Refusal => ({
  code: output.code, issues: (output.errors ?? output.issues ?? []).map(({ pointer, code, meta }) => ({ pointer, code, ...(meta ? { meta } : {}) })),
});
async function refuse(transport: Transport, f: ApiOrderWriteFixture, operation: "create" | "update" | "delete", id: string, changes: Record<string, unknown>): Promise<Refusal> {
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = operation === "create" ? await createOrderFn(createOrderSchema.parse(body(f, changes)))
      : operation === "update" ? await updateOrderFn(updateOrderSchema.parse({ orderId: id, expectedVersion: 1, ...changes }))
      : await deleteOrderFn({ orderId: id, expectedVersion: 1 });
    if (result.success) throw new Error("Expected an action refusal.");
    return { code: result.code, issues: (result.issues ?? []).map(({ path, code, meta }) => ({ pointer: jsonPointer(path), code, ...(meta ? { meta } : {}) })) };
  }
  if (transport === "rest") {
    const current = operation === "create" ? null : await readRestOrder(f, id);
    const response = operation === "create" ? await postOrder(f, body(f, changes))
      : operation === "update" ? await patchOrder(f, id, changes, current!.etag)
      : await deleteOrder(f, id, current!.etag);
    expect(response.status).toBeGreaterThanOrEqual(400);
    return apiRefusal(await response.json());
  }
  const result = await mcp(f, `${operation === "create" ? "record" : operation}_order`, operation === "create" ? body(f, changes) : { orderId: id, expectedVersion: 1, ...changes }, operation === "delete" ? f.deleteKey : f.writeOnlyKey);
  expect(result.isError).toBe(true);
  return apiRefusal(result.structuredContent);
}

describe("three-way order parity", { timeout: TIMEOUT_MS }, () => {
  it("creates the same stored row, representation and warnings", async () => {
    const ids = new Map<Transport, string | null>();
    const outputs = new Map<Transport, unknown>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const output = await create(transport, f);
      expect(output.warnings).toEqual([]);
      expect(output.data.orderDate).toBe("2026-09-12");
      outputs.set(transport, output); ids.set(transport, output.data.id);
      expect((await readRestOrder(f, output.data.id)).row).toEqual(output.data);
    }
    await outcomes(ids, outputs);
  });

  it("updates the same stored row, representation and warnings, preserving omission and clearing null", async () => {
    const ids = new Map<Transport, string | null>();
    const outputs = new Map<Transport, unknown>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const made = await create(transport, f);
      const changed = await update(transport, f, made.data.id, { quantityKg: UPDATED_KG, customerLocationId: null, orderDate: "2026-10-13", code: "E2E-PARITY-EDIT" });
      expect(changed.warnings).toEqual([]);
      expect(changed.data).toMatchObject({ version: 2, customerLocationId: null, packaging: "bagged", formulationId: made.data.formulationId, quantityKg: UPDATED_KG, orderDate: "2026-10-13", code: "E2E-PARITY-EDIT" });
      expect((await readRestOrder(f, made.data.id)).row).toEqual(changed.data);
      ids.set(transport, made.data.id); outputs.set(transport, changed);
    }
    await outcomes(ids, outputs);
  });

  it("deletes the same row and previews the same representation, with no warnings", async () => {
    const ids = new Map<Transport, string | null>();
    const outputs = new Map<Transport, unknown>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const made = await create(transport, f);
      const current = await readRestOrder(f, made.data.id);
      const restPreview = await deleteOrder(f, made.data.id, current.etag, randomUUID(), "?dryRun=true");
      expect(restPreview.status).toBe(200);
      const mcpPreview = await mcp(f, "delete_order", { orderId: made.data.id, expectedVersion: made.data.version, dryRun: true }, f.deleteKey);
      expect(mcpPreview.structuredContent).toEqual(await restPreview.json());
      expect(mcpPreview.structuredContent).toEqual({ data: made.data });
      if (transport === "action") {
        auth.requireOrgContext.mockResolvedValue(f.ctx);
        const result = await deleteOrderFn({ orderId: made.data.id, expectedVersion: made.data.version });
        expect(result).toEqual({ success: true, data: undefined });
      } else if (transport === "rest") expect((await deleteOrder(f, made.data.id, current.etag)).status).toBe(204);
      else {
        const deleted = await mcp(f, "delete_order", { orderId: made.data.id, expectedVersion: made.data.version }, f.deleteKey);
        expect(deleted.structuredContent).toEqual({ deleted: { id: made.data.id, code: made.data.code } });
      }
      outputs.set(transport, { warnings: [] }); ids.set(transport, null);
      expect(await orderRows(f)).toEqual([]);
      const audits = await orderAudits(f);
      if (transport === "action") expect(audits).toEqual([]);
      else expect(audits.map((audit) => [audit.operationId, audit.transport]).sort()).toEqual([["delete_order", transport], ["record_order", transport]]);
    }
    await outcomes(ids, outputs);
  });

  const refusalCases = [
    { name: "foreign reference on create", operation: "create", setup: "foreign", code: "not_found", pointer: "/customerId" },
    { name: "foreign reference on update", operation: "update", setup: "foreign", code: "not_found", pointer: "/customerId" },
    { name: "another customer's location on create", operation: "create", setup: "location", code: "validation_failed", pointer: "/customerLocationId" },
    { name: "another customer's location on update", operation: "update", setup: "location", code: "validation_failed", pointer: "/customerLocationId" },
    ...["facilityId", "customerId", "customerLocationId", "formulationId"].map((field) => ({ name: `frozen ${field}`, operation: "update", setup: field, code: "conflict", pointer: `/${field}` })),
    { name: "quantity below allocated wet kg", operation: "update", setup: "quantity", code: "validation_failed", pointer: "/quantityKg" },
    { name: "archived order", operation: "update", setup: "archive", code: "not_found", pointer: "/orderId" },
    { name: "delete with a delivery", operation: "delete", setup: "delivery", code: "conflict", pointer: "/orderId" },
  ] as const;
  it.each(refusalCases)("returns the same codes, issue paths and metadata for $name with no side effect", async ({ operation, setup, code, pointer }) => {
    const failures = new Map<Transport, Refusal>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const made = operation === "create" ? null : await create(transport, f);
      const id = made?.data.id ?? randomUUID();
      let changes: Record<string, unknown> = {};
      if (setup === "foreign") changes = { customerId: fixtures.get(transport === "action" ? "rest" : "action")!.customer.id };
      else if (setup === "location") changes = { customerId: f.otherCustomer.id };
      else if (setup === "archive") await archiveReadOrder(f, id);
      else {
        await insertReadDelivery(f, id, DELIVERED_KG);
        if (setup === "quantity") changes = { quantityKg: BELOW_ALLOCATED_KG };
        else if (setup !== "delivery") changes = { [setup]: ({ facilityId: f.otherFacility.id, customerId: f.otherCustomer.id, customerLocationId: null, formulationId: f.pure.id })[setup] };
      }
      const beforeRows = await orderRows(f);
      const beforeAudits = await orderAudits(f);
      const beforeRecords = await orderRecords(f);
      const failure = await refuse(transport, f, operation as "create" | "update" | "delete", id, changes);
      expect(failure).toMatchObject({ code, issues: [{ code, pointer }] });
      if (setup === "quantity") expect(failure.issues[0].meta).toEqual({ allocatedWetKg: DELIVERED_KG, unit: "kg" });
      failures.set(transport, failure);
      expect(await orderRows(f)).toEqual(beforeRows);
      expect(await orderAudits(f)).toEqual(beforeAudits);
      expect(await orderRecords(f)).toEqual(beforeRecords);
    }
    expect(failures.get("rest")).toEqual(failures.get("action"));
    expect(failures.get("mcp")).toEqual(failures.get("action"));
  });
});
