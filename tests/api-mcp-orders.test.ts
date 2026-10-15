/** Real handlers, credentials and Postgres. Not run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as GET_CUSTOMERS } from "@/app/api/v1/customers/route";
import { GET as GET_LOCATIONS } from "@/app/api/v1/customers/[idOrCode]/locations/route";
import { GET as GET_ORDERS } from "@/app/api/v1/orders/route";
import { GET as GET_ORDER } from "@/app/api/v1/orders/[idOrCode]/route";
import { GET as GET_BALANCE } from "@/app/api/v1/orders/[idOrCode]/balance/route";
import { orderInput } from "./helpers/order-operation-fixture";
import { archiveReadOrder, insertReadDelivery, readParams, readRequest, removeApiOrderReadFixture } from "./helpers/api-order-read-fixture";
import { createApiOrderWriteFixture, deleteOrder, orderAudits, orderRecords, orderRows, patchOrder, postOrder, readRestOrder, type ApiOrderWriteFixture } from "./helpers/api-order-write-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const TIMEOUT_MS = 60_000;
const DELIVERED_KG = 40;
const UPDATED_KG = 120;
const BELOW_ALLOCATED_KG = 39;
const READ_TOOLS = ["find_customers", "find_customer_locations", "find_orders", "get_order", "get_order_balance"];
const WRITE_TOOLS = ["record_order", "update_order", "delete_order"];
let a: ApiOrderWriteFixture;
let b: ApiOrderWriteFixture;
beforeEach(async () => { a = await createApiOrderWriteFixture(); b = await createApiOrderWriteFixture(); }, TIMEOUT_MS);
afterEach(async () => { await removeApiOrderReadFixture(a); await removeApiOrderReadFixture(b); }, TIMEOUT_MS);
async function call(name: string, args: Record<string, unknown>, key = a.writeOnlyKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
const write = (name: string, args: Record<string, unknown>, key = a.writeOnlyKey) => call(name, { requestKey: randomUUID(), ...args }, key);
async function saved(f = a) {
  const result = await call("record_order", { ...orderInput(f), requestKey: randomUUID() }, f.writeOnlyKey);
  expect(result.isError).toBeUndefined();
  return result.structuredContent.data;
}
async function noWrites(f = a) {
  expect(await orderRows(f)).toEqual([]);
  expect(await orderRecords(f)).toEqual([]);
  expect(await orderAudits(f)).toEqual([]);
}

describe("customer and order MCP tools", { timeout: TIMEOUT_MS }, () => {
  it("discovers only the tools allowed by each scope", async () => {
    for (const [key, names] of [
      [a.key, READ_TOOLS], [a.customerKey, ["find_customers", "find_customer_locations"]],
      [a.orderKey, ["find_orders", "get_order", "get_order_balance"]],
      [a.writeOnlyKey, ["record_order", "update_order"]], [a.deleteKey, ["delete_order"]],
    ] as const) {
      const { result } = await rpcBody(await MCP(rpc(key, "tools/list")));
      const inventory = result.tools.map((tool: { name: string }) => tool.name);
      for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) expect(inventory.includes(name), name).toBe((names as readonly string[]).includes(name));
    }
  });

  it("refuses missing scopes before looking up known, unknown and foreign targets", async () => {
    const foreign = await saved(b);
    for (const id of [foreign.id, randomUUID()]) {
      for (const [name, args, key] of [
        ["get_order", { idOrCode: id }, a.customerKey], ["get_order_balance", { idOrCode: id }, a.customerKey],
        ["find_customer_locations", { idOrCode: id }, a.orderKey],
        ["update_order", { orderId: id, expectedVersion: 1, requestKey: randomUUID() }, a.orderKey],
        ["delete_order", { orderId: id, expectedVersion: 1, requestKey: randomUUID() }, a.writeOnlyKey],
        ["record_order", { ...orderInput(b), requestKey: randomUUID() }, a.orderKey],
      ] as const) {
        const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name, arguments: args })));
        const unknown = await rpcBody(await MCP(rpc(key, "tools/call", { name: "unknown_tool", arguments: {} })));
        expect(hidden, name).not.toHaveProperty("result");
        expect(hidden.error).toEqual(unknown.error);
        expect(JSON.stringify(hidden)).not.toContain(foreign.code);
      }
    }
    for (const name of ["find_customers", "find_orders"]) {
      const hidden = await rpcBody(await MCP(rpc(a.missingScopeKey, "tools/call", { name, arguments: {} })));
      expect(hidden).not.toHaveProperty("result");
    }
    await noWrites();
    expect(await orderRows(b)).toHaveLength(1);
  });

  it("returns exactly the REST read envelopes for every tool, by UUID and exact code", async () => {
    const order = await saved();
    const customers = await GET_CUSTOMERS(readRequest("/customers?limit=1", a.key));
    expect((await call("find_customers", { limit: 1 }, a.key)).structuredContent).toEqual(await customers.json());
    for (const idOrCode of [a.customer.id, a.customer.code]) {
      const locations = await GET_LOCATIONS(readRequest(`/customers/${idOrCode}/locations?limit=1`, a.key), readParams(idOrCode));
      expect((await call("find_customer_locations", { idOrCode, limit: 1 }, a.key)).structuredContent).toEqual(await locations.json());
    }
    const filters = { facilityId: a.facility.id, customerId: a.customer.id, formulationId: a.recipe.id, orderedFrom: "2026-09-01", orderedBefore: "2026-10-01", q: order.code, code: order.code, limit: 1 };
    const list = await GET_ORDERS(readRequest(`/orders?${new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)]))}`, a.key));
    expect((await call("find_orders", filters, a.key)).structuredContent).toEqual(await list.json());
    for (const idOrCode of [order.id, order.code]) {
      for (const [name, handler, suffix] of [["get_order", GET_ORDER, ""], ["get_order_balance", GET_BALANCE, "/balance"]] as const) {
        const response = await handler(readRequest(`/orders/${idOrCode}${suffix}`, a.key), readParams(idOrCode));
        const result = await call(name, { idOrCode }, a.key);
        expect(result.structuredContent, name).toEqual(await response.json());
        expect(result.isError).toBeUndefined();
      }
    }
  });

  it("shares REST cursors and refuses changed filter and organization bindings", async () => {
    await saved(); await saved();
    for (const name of ["find_customers", "find_orders"]) {
      const first = await call(name, { limit: 1 }, a.key);
      expect(first.structuredContent.nextCursor).toEqual(expect.any(String));
      const cursor = first.structuredContent.nextCursor;
      const path = name === "find_customers" ? "/customers" : "/orders";
      const handler = name === "find_customers" ? GET_CUSTOMERS : GET_ORDERS;
      const response = await handler(readRequest(`${path}?limit=1&cursor=${cursor}`, a.key));
      const next = await call(name, { limit: 1, cursor }, a.key);
      expect(next.structuredContent).toEqual(await response.json());
      expect(next.structuredContent.data[0].id).not.toBe(first.structuredContent.data[0].id);
      for (const [args, key] of [[{ cursor, q: "changed" }, a.key], [{ cursor }, b.key]] as const) {
        expect(await call(name, args, key)).toMatchObject({ isError: true, structuredContent: { code: "invalid_cursor" } });
      }
    }
  });

  it("records, updates only present fields, replaces a location, reports stale versions, then deletes", async () => {
    const row = await saved();
    expect(row).toMatchObject({ orderDate: "2026-09-12", quantityKg: 100, packaging: "loose" });
    const changed = await write("update_order", { orderId: row.id.toUpperCase(), expectedVersion: row.version, customerLocationId: a.otherLocation.id, quantityKg: UPDATED_KG });
    expect(changed.isError).toBeUndefined();
    expect(changed.structuredContent.data).toMatchObject({ ...row, version: 2, quantityKg: UPDATED_KG, customerLocationId: a.otherLocation.id, updatedAt: expect.any(String) });
    const current = (await readRestOrder(a, row.id)).row;
    for (const [name, key] of [["update_order", a.writeOnlyKey], ["delete_order", a.deleteKey]] as const) {
      expect(await write(name, { orderId: row.id, expectedVersion: row.version }, key)).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current } });
    }
    const deleted = await write("delete_order", { orderId: row.id, expectedVersion: current.version }, a.deleteKey);
    expect(deleted.structuredContent).toEqual({ deleted: { id: row.id, code: row.code } });
    expect(await orderRows(a)).toEqual([]);
    expect((await orderAudits(a)).map((audit) => [audit.operationId, audit.transport]).sort()).toEqual([
      ["delete_order", "mcp"], ["record_order", "mcp"], ["update_order", "mcp"],
    ]);
  });

  it("refuses a missing create destination and a null update destination with field issues", async () => {
    expect(await write("record_order", orderInput(a, { customerLocationId: undefined }))).toMatchObject({
      isError: true, structuredContent: { code: "validation_failed", issues: [{ pointer: "/customerLocationId", code: "invalid_type" }] },
    });
    await noWrites();
    const row = await saved();
    expect(await write("update_order", { orderId: row.id, expectedVersion: row.version, customerLocationId: null })).toMatchObject({
      isError: true, structuredContent: { code: "validation_failed", issues: [{ pointer: "/customerLocationId", code: "invalid_type" }] },
    });
    expect((await readRestOrder(a, row.id)).row).toEqual(row);
  });

  it("requires requestKey on every real write and expectedVersion on update and delete", async () => {
    const row = await saved();
    const count = (await orderRecords(a)).length;
    for (const [name, args, key] of [
      ["record_order", orderInput(a), a.writeOnlyKey], ["update_order", { orderId: row.id, expectedVersion: 1 }, a.writeOnlyKey],
      ["delete_order", { orderId: row.id, expectedVersion: 1 }, a.deleteKey],
    ] as const) {
      expect(await call(name, args, key)).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required", issues: [{ pointer: "/requestKey" }] } });
      if (name !== "record_order") expect(await write(name, { orderId: row.id }, key)).toMatchObject({ isError: true, structuredContent: { code: "validation_failed", issues: expect.arrayContaining([expect.objectContaining({ pointer: "/expectedVersion" })]) } });
    }
    expect((await readRestOrder(a, row.id)).row).toEqual(row);
    expect(await orderRecords(a)).toHaveLength(count);
    expect(await orderAudits(a)).toHaveLength(count);
  });

  it("previews all writes with or without keys without claiming a key or changing data", async () => {
    for (const requestKey of [undefined, randomUUID()]) {
      expect((await call("record_order", { ...orderInput(a), dryRun: true, requestKey })).isError).toBeUndefined();
      await noWrites();
    }
    const row = await saved();
    const count = (await orderRecords(a)).length;
    for (const [name, key] of [["update_order", a.writeOnlyKey], ["delete_order", a.deleteKey]] as const) {
      for (const requestKey of [undefined, randomUUID()]) {
        const preview = await call(name, { orderId: row.id, expectedVersion: row.version, dryRun: true, requestKey }, key);
        expect(preview.isError).toBeUndefined();
        expect(preview.structuredContent).toEqual({ data: expect.objectContaining({ id: row.id }) });
      }
    }
    expect((await readRestOrder(a, row.id)).row).toEqual(row);
    expect(await orderRecords(a)).toHaveLength(count);
    expect(await orderAudits(a)).toHaveLength(count);
  });

  it("replays REST create, PATCH and DELETE keys over MCP after later changes and deletion", async () => {
    const key = randomUUID();
    const created = await postOrder(a, orderInput(a), key);
    expect(created.status).toBe(201);
    const original = await created.json();
    const row = original.data;
    const patchKey = randomUUID();
    const updated = await patchOrder(a, row.id, { quantityKg: UPDATED_KG }, created.headers.get("etag")!, patchKey);
    expect(updated.status).toBe(200);
    const updateBody = await updated.json();
    await archiveReadOrder(a, row.id);
    const replay = await call("record_order", { ...Object.fromEntries(Object.entries(orderInput(a)).reverse()), requestKey: key });
    expect(replay.structuredContent).toEqual(original);
    expect(replay.content[0].text).toMatch(/^Replayed:/);
    const patchReplay = await call("update_order", { orderId: row.id, expectedVersion: row.version, quantityKg: UPDATED_KG, requestKey: patchKey });
    expect(patchReplay.structuredContent).toEqual(updateBody);
    expect(await call("record_order", { ...orderInput(a), requestKey: key, dryRun: true })).toMatchObject({ isError: true, structuredContent: { code: "key_already_used" } });
    expect(await call("record_order", { ...orderInput(a), quantityKg: UPDATED_KG, requestKey: key })).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_reused" } });
    const deleteKey = randomUUID();
    expect((await deleteOrder(a, row.id, updated.headers.get("etag")!, deleteKey)).status).toBe(204);
    const deleteReplay = await call("delete_order", { orderId: row.id, expectedVersion: updateBody.data.version, requestKey: deleteKey }, a.deleteKey);
    expect(deleteReplay.structuredContent).toEqual({ deleted: { id: row.id, code: row.code } });
    expect(deleteReplay.content[0].text).toMatch(/^Replayed:/);
    expect((await call("record_order", { ...orderInput(a), requestKey: key })).structuredContent).toEqual(original);
    expect((await call("update_order", { orderId: row.id, expectedVersion: row.version, quantityKg: UPDATED_KG, requestKey: patchKey })).structuredContent).toEqual(updateBody);
    expect(await orderRows(a)).toEqual([]);
    expect(await orderAudits(a)).toHaveLength(3);
    expect(await orderRecords(a)).toHaveLength(3);
  });

  it("refuses foreign or unknown arguments and filters without side effects", async () => {
    const row = await saved();
    const foreign = await saved(b);
    const count = (await orderAudits(a)).length;
    for (const [field, id] of Object.entries({ facilityId: b.facility.id, customerId: b.customer.id, customerLocationId: b.location.id, formulationId: b.recipe.id })) {
      for (const reference of [id, randomUUID()]) {
        for (const [name, args] of [["record_order", orderInput(a, { [field]: reference })], ["update_order", { orderId: row.id, expectedVersion: row.version, [field]: reference }]] as const) {
          const refusal = await write(name, args);
          expect(refusal, field).toMatchObject({ isError: true, structuredContent: { code: "not_found", issues: expect.arrayContaining([expect.objectContaining({ pointer: `/${field}`, code: "not_found" })]) } });
        }
      }
    }
    for (const id of [foreign.id, randomUUID()]) {
      for (const [name, args, key] of [["update_order", { orderId: id, expectedVersion: 1 }, a.writeOnlyKey], ["delete_order", { orderId: id, expectedVersion: 1 }, a.deleteKey]] as const) {
        expect(await write(name, args, key)).toMatchObject({ isError: true, structuredContent: { code: "not_found", issues: expect.arrayContaining([expect.objectContaining({ pointer: "/orderId" })]) } });
      }
      for (const name of ["get_order", "get_order_balance"]) expect(await call(name, { idOrCode: id }, a.key)).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    for (const args of [{ facilityId: b.facility.id }, { customerId: b.customer.id }, { formulationId: b.recipe.id }]) {
      expect(await call("find_orders", args, a.key)).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    for (const idOrCode of [b.customer.id, b.customer.code, randomUUID()]) {
      expect(await call("find_customer_locations", { idOrCode }, a.key)).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    expect((await readRestOrder(a, row.id)).row).toEqual(row);
    expect((await readRestOrder(b, foreign.id)).row).toEqual(foreign);
    expect(await orderRows(a)).toHaveLength(1);
    expect(await orderRows(b)).toHaveLength(1);
    expect(await orderAudits(a)).toHaveLength(count);
    expect(await orderRecords(a)).toHaveLength(count);
  });

  it.each([false, true])("refuses deletion and relationship edits with a delivery (archived: %s)", async (archived) => {
    const row = await saved();
    await insertReadDelivery(a, row.id, DELIVERED_KG, archived);
    expect(await write("delete_order", { orderId: row.id, expectedVersion: row.version }, a.deleteKey)).toMatchObject({ isError: true, structuredContent: { code: "conflict", issues: [{ pointer: "/orderId" }] } });
    for (const [field, value] of Object.entries({ facilityId: a.otherFacility.id, customerId: a.otherCustomer.id, formulationId: a.pure.id, customerLocationId: a.otherLocation.id })) {
      expect(await write("update_order", { orderId: row.id, expectedVersion: row.version, [field]: value })).toMatchObject({ isError: true, structuredContent: { code: "conflict", issues: [{ pointer: `/${field}` }] } });
    }
    expect((await readRestOrder(a, row.id)).row).toEqual(row);
    expect(await orderAudits(a)).toHaveLength(1);
  });

  it("reads the changing balance at a stable order version and preserves allocation meta", async () => {
    const row = await saved();
    const before = await call("get_order_balance", { idOrCode: row.id }, a.key);
    expect(before.structuredContent.data).toMatchObject({ deliveredWetMassKg: 0, remainingWetMassKg: row.quantityKg, fulfillmentStatus: "no_deliveries" });
    await insertReadDelivery(a, row.id, DELIVERED_KG);
    const after = await call("get_order_balance", { idOrCode: row.id }, a.key);
    expect(after.structuredContent.data).toEqual({ orderId: row.id, quantityKg: row.quantityKg, deliveredWetMassKg: DELIVERED_KG, remainingWetMassKg: row.quantityKg - DELIVERED_KG, fulfillmentStatus: "partial" });
    expect((await readRestOrder(a, row.id)).row.version).toBe(row.version);
    expect(await write("update_order", { orderId: row.id, expectedVersion: row.version, quantityKg: BELOW_ALLOCATED_KG })).toMatchObject({ isError: true, structuredContent: { code: "validation_failed", issues: [{ code: "validation_failed", pointer: "/quantityKg", meta: { allocatedWetKg: DELIVERED_KG, unit: "kg" } }] } });
    const rest = await GET_BALANCE(readRequest(`/orders/${row.id}/balance`, a.key), readParams(row.id));
    expect(after.structuredContent).toEqual(await rest.json());
  });
});
