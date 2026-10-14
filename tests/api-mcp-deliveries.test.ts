/** Real handlers, credentials and Postgres; run by explicit path only. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, biocharProducts, facilities } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as GET_DELIVERIES } from "@/app/api/v1/deliveries/route";
import { GET as GET_DELIVERY } from "@/app/api/v1/deliveries/[idOrCode]/route";
import { createApiDeliveryWriteFixture, removeApiDeliveryWriteFixture, deliveryInput, postDelivery, patchDelivery, readDelivery,
  deliveryRows, deliveryRecords, deliveryAudits, DELIVERY_TEST_TIMEOUT_MS, DELIVERY_AT, type ApiDeliveryWriteFixture } from "./helpers/api-delivery-write-fixture";
import { archiveReadOrder, readParams, readRequest } from "./helpers/api-order-read-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

let a: ApiDeliveryWriteFixture;
let b: ApiDeliveryWriteFixture;
beforeEach(async () => { a = await createApiDeliveryWriteFixture(); b = await createApiDeliveryWriteFixture(); }, DELIVERY_TEST_TIMEOUT_MS);
afterEach(async () => { for (const f of [a, b]) if (f) await removeApiDeliveryWriteFixture(f); }, DELIVERY_TEST_TIMEOUT_MS);
async function call(name: string, args: Record<string, unknown>, key = a.writeKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
const write = (name: string, args: Record<string, unknown>) => call(name, { requestKey: randomUUID(), ...args });
async function saved() {
  const result = await write("record_delivery", deliveryInput(a));
  expect(result.isError).toBeUndefined();
  return result.structuredContent.data;
}
async function noWrites(f = a) {
  expect(await deliveryRows(f)).toEqual([]);
  expect(await deliveryRecords(f)).toEqual([]);
  expect(await deliveryAudits(f)).toEqual([]);
}
const INVENTORY = ["find_deliveries", "get_delivery", "record_delivery", "update_delivery"];

async function stockState(f: ApiDeliveryWriteFixture) {
  return {
    movements: await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId)),
    products: await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId)),
  };
}

describe("delivery MCP tools", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it("discovers only authorized tools and refuses missing scope before target lookup", async () => {
    const row = await saved();
    const foreignResponse = await postDelivery(b);
    expect(foreignResponse.status).toBe(201);
    const foreign = (await foreignResponse.json()).data;
    for (const [key, names] of [[a.readKey, INVENTORY.slice(0, 2)], [a.writeKey, INVENTORY.slice(2)], [a.missingScopeKey, []]] as const) {
      const { result } = await rpcBody(await MCP(rpc(key, "tools/list")));
      const namesFound = result.tools.map((tool: { name: string }) => tool.name);
      for (const name of INVENTORY) expect(namesFound.includes(name)).toBe((names as readonly string[]).includes(name));
    }
    for (const id of [row.id, foreign.id, randomUUID()]) {
      for (const [name, args, key] of [
        ["get_delivery", { idOrCode: id }, a.writeKey],
        ["find_deliveries", { orderId: b.order.id }, a.writeKey],
        ["record_delivery", { ...deliveryInput(b), requestKey: randomUUID() }, a.readKey],
        ["update_delivery", { deliveryId: id, expectedVersion: row.version, requestKey: randomUUID() }, a.readKey],
      ] as const) {
        const hidden = await rpcBody(await MCP(rpc(key, "tools/call", { name, arguments: args })));
        const unknown = await rpcBody(await MCP(rpc(key, "tools/call", { name: "unknown_tool", arguments: {} })));
        expect(hidden).not.toHaveProperty("result");
        expect(hidden.error).toEqual(unknown.error);
        expect(JSON.stringify(hidden)).not.toContain(foreign.code);
      }
    }
    expect(await deliveryRows(a)).toHaveLength(1);
    expect(await deliveryAudits(a)).toHaveLength(1);
    expect(await deliveryRecords(a)).toHaveLength(1);
  });
  it("reads identical REST envelopes, filters and cursors by UUID and code", async () => {
    const row = await saved(); await saved();
    const filters = { facilityId: a.facility.id, orderId: a.order.id, storageLocationId: a.bin.id, deliveredFrom: "2026-09-14T12:00:00Z", deliveredBefore: "2026-09-15T00:00:00Z", limit: 1 };
    const query = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
    const rest = await GET_DELIVERIES(readRequest(`/deliveries?${query}`, a.readKey));
    const first = (await call("find_deliveries", filters, a.readKey)).structuredContent;
    expect(first).toEqual(await rest.json());
    expect(first.nextCursor).toEqual(expect.any(String));
    query.set("cursor", first.nextCursor);
    const next = await GET_DELIVERIES(readRequest(`/deliveries?${query}`, a.readKey));
    expect((await call("find_deliveries", { ...filters, cursor: first.nextCursor }, a.readKey)).structuredContent).toEqual(await next.json());
    for (const [args, key] of [[{ ...filters, cursor: first.nextCursor, q: "changed" }, a.readKey], [{ cursor: first.nextCursor }, b.readKey]] as const) {
      expect(await call("find_deliveries", args, key)).toMatchObject({ isError: true, structuredContent: { code: "invalid_cursor" } });
    }
    for (const idOrCode of [row.id, row.code]) {
      const detail = await GET_DELIVERY(readRequest(`/deliveries/${idOrCode}`, a.readKey), readParams(idOrCode));
      expect((await call("get_delivery", { idOrCode }, a.readKey)).structuredContent).toEqual(await detail.json());
    }
    const exact = await call("find_deliveries", { q: row.code, code: row.code }, a.readKey);
    expect(exact.structuredContent.data).toEqual([row]);
  });
  it("records and updates metadata, returning current on stale expectedVersion", async () => {
    const row = await saved();
    const changed = await write("update_delivery", { deliveryId: row.id.toUpperCase(), expectedVersion: row.version, driverId: a.driver.id, vehicleId: a.vehicle.id, distanceNote: "Road evidence" });
    expect(changed.isError).toBeUndefined();
    expect(changed.structuredContent.data).toMatchObject({ driverId: a.driver.id, vehicleId: a.vehicle.id, distanceNote: "Road evidence", version: row.version + 1 });
    const current = (await readDelivery(a, row.id)).data;
    expect(changed.structuredContent).toEqual({ data: current });
    expect(await write("update_delivery", { deliveryId: row.id, expectedVersion: row.version })).toMatchObject({ isError: true, structuredContent: { code: "stale_version", current } });
    expect((await deliveryAudits(a)).map(audit => audit.transport)).toEqual(["mcp", "mcp"]);
  });
  it("requires requestKey on real writes and expectedVersion on update", async () => {
    expect(await call("record_delivery", deliveryInput(a))).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required", issues: [{ pointer: "/requestKey" }] } });
    await noWrites();
    const row = await saved();
    expect(await call("update_delivery", { deliveryId: row.id, expectedVersion: row.version })).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_required" } });
    expect(await write("update_delivery", { deliveryId: row.id })).toMatchObject({ isError: true, structuredContent: { code: "validation_failed", issues: expect.arrayContaining([expect.objectContaining({ pointer: "/expectedVersion" })]) } });
    expect((await readDelivery(a, row.id)).data).toEqual(row);
    expect(await deliveryRecords(a)).toHaveLength(1);
  });
  it("previews without claiming a key, shares REST stock effects and allocations, then commits the basis", async () => {
    const rest = await postDelivery(a, deliveryInput(a), randomUUID(), "?dryRun=true");
    expect(rest.status).toBe(200);
    const preview = await rest.json();
    for (const requestKey of [undefined, randomUUID()]) {
      const result = await call("record_delivery", { ...deliveryInput(a), dryRun: true, requestKey });
      expect(result.isError).toBeUndefined();
      for (const key of ["allocations", "stockEffects", "basisFingerprint", "warnings"]) expect(result.structuredContent[key]).toEqual(preview[key]);
      await noWrites();
    }
    const made = await write("record_delivery", deliveryInput(a, { basisFingerprint: preview.basisFingerprint }));
    expect(made.structuredContent.allocations).toEqual(preview.allocations);
    expect(made.structuredContent.warnings).toEqual(preview.warnings);
    expect(made.content[0].text).toContain(preview.warnings[0]);
    const row = made.structuredContent.data;
    const current = await readDelivery(a, row.id);
    const restUpdate = await patchDelivery(a, row.id, { distanceNote: "Preview" }, current.etag, randomUUID(), "?dryRun=true");
    expect(restUpdate.status).toBe(200);
    const restUpdateBody = await restUpdate.json();
    for (const requestKey of [undefined, randomUUID()]) {
      const result = await call("update_delivery", { deliveryId: row.id, expectedVersion: row.version, distanceNote: "Preview", dryRun: true, requestKey });
      expect(result.isError).toBeUndefined();
      expect({ ...result.structuredContent, data: { ...result.structuredContent.data, updatedAt: null } }).toEqual({ ...restUpdateBody, data: { ...restUpdateBody.data, updatedAt: null } });
      expect(result.structuredContent.data).toMatchObject({ ...row, distanceNote: "Preview", version: row.version + 1, updatedAt: expect.any(String) });
    }
    expect(restUpdate.status).toBe(200);
    expect((await readDelivery(a, row.id)).data).toEqual(row);
    expect(await deliveryRecords(a)).toHaveLength(1);
    expect(await deliveryAudits(a)).toHaveLength(1);
  });
  it("replays REST create and update keys over MCP after edits and archive", async () => {
    const key = randomUUID();
    const rest = await postDelivery(a, deliveryInput(a), key);
    expect(rest.status).toBe(201);
    const original = await rest.json();
    const patchKey = randomUUID();
    const patch = await patchDelivery(a, original.data.id, { distanceNote: "First edit" }, rest.headers.get("etag")!, patchKey);
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    await archiveReadOrder(a, a.order.id);
    const replay = await call("record_delivery", { ...Object.fromEntries(Object.entries(deliveryInput(a)).reverse()), requestKey: key });
    expect(replay.structuredContent).toEqual(original);
    expect(replay.content[0].text).toMatch(/^Replayed:/);
    const patchReplay = await call("update_delivery", { deliveryId: original.data.id, expectedVersion: original.data.version, distanceNote: "First edit", requestKey: patchKey });
    expect(patchReplay.structuredContent).toEqual(updated);
    expect(patchReplay.content[0].text).toMatch(/^Replayed:/);
    expect(await call("record_delivery", { ...deliveryInput(a), requestKey: key, dryRun: true })).toMatchObject({ isError: true, structuredContent: { code: "key_already_used" } });
    expect(await deliveryRecords(a)).toHaveLength(2);
    expect(await deliveryAudits(a)).toHaveLength(2);
  });
  it("refuses foreign and unknown references, targets and filters without side effects", async () => {
    const row = await saved();
    const beforeStock = await stockState(a);
    for (const [field, foreign] of Object.entries({ orderId: b.order.id, storageLocationId: b.bin.id, driverId: b.driver.id, vehicleId: b.vehicle.id })) {
      for (const id of [foreign, randomUUID()]) {
        const refusal = { isError: true, structuredContent: { code: "not_found", issues: expect.arrayContaining([expect.objectContaining({ pointer: `/${field}` })]) } };
        expect(await write("record_delivery", deliveryInput(a, { [field]: id }))).toMatchObject(refusal);
        if (field === "driverId" || field === "vehicleId") expect(await write("update_delivery", { deliveryId: row.id, expectedVersion: row.version, [field]: id })).toMatchObject(refusal);
      }
    }
    for (const layerId of [b.product.id, randomUUID()]) expect(await write("record_delivery", deliveryInput(a, { sources: [{ layerId, moisturePercent: 20 }] }))).toMatchObject({ isError: true, structuredContent: { code: "not_found", issues: [{ pointer: "/sources/0/layerId" }] } });
    const foreign = (await (await postDelivery(b)).json()).data;
    for (const id of [foreign.id, randomUUID()]) {
      expect(await call("get_delivery", { idOrCode: id }, a.readKey)).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
      expect(await write("update_delivery", { deliveryId: id, expectedVersion: row.version })).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    }
    for (const args of [{ orderId: b.order.id }, { storageLocationId: b.bin.id }, { facilityId: b.facility.id }]) expect(await call("find_deliveries", args, a.readKey)).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    expect((await readDelivery(a, row.id)).data).toEqual(row);
    expect(await deliveryRows(a)).toHaveLength(1);
    expect(await deliveryRecords(a)).toHaveLength(1);
    expect(await deliveryAudits(a)).toHaveLength(1);
    expect(await stockState(a)).toEqual(beforeStock);
  });
  it("returns REST's fresh stale-basis preview with allocation details", async () => {
    const input = deliveryInput(a, { basisFingerprint: "stale" });
    const rest = await postDelivery(a, input);
    expect(rest.status).toBe(409);
    const problem = await rest.json();
    const result = await write("record_delivery", input);
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "stock_basis_changed", preview: problem.preview, issues: problem.errors } });
    expect(result.structuredContent.preview.allocations).toHaveLength(1);
    expect(result.structuredContent.preview.basisFingerprint).toEqual(expect.any(String));
    await noWrites();
  });
  it("resolves date and time in the order facility zone", async () => {
    await db.update(facilities).set({ timezone: "Europe/Zurich" }).where(and(eq(facilities.organizationId, a.ctx.organizationId), eq(facilities.id, a.facility.id)));
    const result = await write("record_delivery", deliveryInput(a, { deliveredAt: { date: "2026-09-14", time: "14:00" } }));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.data.deliveredAt).toBe(DELIVERY_AT);
    expect((await deliveryRows(a))[0].deliveryDate.toISOString()).toBe(DELIVERY_AT);
  });
});
