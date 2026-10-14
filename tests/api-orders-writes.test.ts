/** Real routes and Postgres. Not run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditEvents, apiIdempotencyRecords, organizationSettings, orders } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { POST } from "@/app/api/v1/orders/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/orders/[idOrCode]/route";
import { orderRepresentationSchema } from "@/lib/representations/orders";
import { orderInput } from "./helpers/order-operation-fixture";
import { createApiOrderReadFixture, removeApiOrderReadFixture, readParams, readRequest, insertReadDelivery, archiveReadOrder } from "./helpers/api-order-read-fixture";
import { certifyOutputLineage, cleanupCertifiedOutputLineage } from "./helpers/certified-output-lineage";
import { uppercaseUuids } from "./helpers/uppercase-uuids";

const TIMEOUT_MS = 60_000;
const ALLOCATED_KG = 50;
const BELOW_ALLOCATED_KG = 49;
const UPDATED_KG = 120;
const LATER_KG = 130;
const INITIAL_ETAG = '"1.1"';
const NEXT_ETAG = '"2.1"';
type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
async function fixture() {
  const f = await createApiOrderReadFixture();
  const deleteKey = (await createApiKey(f.ctx, { name: "Order delete fixture", scopes: ["orders:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  const secondWriteKey = (await createApiKey(f.ctx, { name: "Order second writer", scopes: ["orders:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  const secondDeleteKey = (await createApiKey(f.ctx, { name: "Order second deleter", scopes: ["orders:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, deleteKey, secondWriteKey, secondDeleteKey };
}
beforeEach(async () => { a = await fixture(); b = await fixture(); }, TIMEOUT_MS);
afterEach(async () => {
  for (const f of [a, b]) { await cleanupCertifiedOutputLineage(f.ctx.organizationId); await removeApiOrderReadFixture(f); }
}, TIMEOUT_MS);
function request(method: string, path: string, credential: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3100/api/v1${path}`, { method,
    headers: { authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
function post(f: Fixture, body: unknown = orderInput(f), key: string | null = randomUUID(), query = "", credential = f.writeOnlyKey) {
  return POST(request("POST", `/orders${query}`, credential, body, key ? { "idempotency-key": key } : {}));
}
function patch(f: Fixture, id: string, body: unknown, etag?: string, key?: string, query = "", credential = f.writeOnlyKey) {
  return PATCH(request("PATCH", `/orders/${id}${query}`, credential, body,
    { ...(etag ? { "if-match": etag } : {}), ...(key ? { "idempotency-key": key } : {}) }), readParams(id));
}
function remove(f: Fixture, id: string, etag?: string, key?: string, query = "", body?: unknown, credential = f.deleteKey) {
  return DELETE(request("DELETE", `/orders/${id}${query}`, credential, body,
    { ...(etag ? { "if-match": etag } : {}), ...(key ? { "idempotency-key": key } : {}) }), readParams(id));
}
async function read(f: Fixture, id: string) {
  const response = await GET(readRequest(`/orders/${id}`, f.orderKey), readParams(id));
  expect(response.status).toBe(200);
  return { data: (await response.json()).data, etag: response.headers.get("etag") };
}
async function saved(f = a) {
  const response = await post(f);
  expect(response.status).toBe(201);
  return (await response.json()).data;
}
async function problem(response: Response, status: number, code: string, pointer?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = await response.json();
  expect(body.code).toBe(code);
  if (pointer) expect(body.errors).toContainEqual(expect.objectContaining({ pointer }));
  return body;
}
const rows = (f: Fixture) => db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId));
const records = (f: Fixture) => db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
const audits = (f: Fixture) => db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId));

describe("order POST", { timeout: TIMEOUT_MS }, () => {
  it("returns the stored representation, Location and the GET ETag, using the organization packaging default", async () => {
    await db.insert(organizationSettings).values({ organizationId: a.ctx.organizationId, defaultPackaging: "bagged" });
    const response = await post(a);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body).not.toHaveProperty("warnings");
    expect(orderRepresentationSchema.parse(body.data)).toEqual(body.data);
    expect(body.data.packaging).toBe("bagged");
    expect(response.headers.get("location")).toBe(`/api/v1/orders/${body.data.id}`);
    expect(response.headers.get("etag")).toBe(INITIAL_ETAG);
    expect(await read(a, body.data.id)).toEqual({ data: body.data, etag: INITIAL_ETAG });
    expect(await audits(a)).toMatchObject([{ operationId: "record_order", outcomeCode: "created", transport: "rest" }]);
  });
  it("requires a key even for dry runs, and never claims a preview key or saves a row", async () => {
    for (const query of ["", "?dryRun=true"]) await problem(await post(a, orderInput(a), null, query), 400, "idempotency_key_required");
    const key = randomUUID();
    const preview = await post(a, orderInput(a), key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    expect(await rows(a)).toEqual([]);
    expect(await records(a)).toEqual([]);
    expect(await audits(a)).toEqual([]);
    expect((await post(a, orderInput(a), key)).status).toBe(201);
    await problem(await post(a, orderInput(a), key, "?dryRun=true"), 409, "key_already_used");
  });
  it("replays reordered bodies and refuses changed payloads, with keys isolated by credential", async () => {
    const key = randomUUID();
    const input = orderInput(a);
    const original = await post(a, input, key);
    const originalText = await original.text();
    const replay = await post(a, Object.fromEntries(Object.entries(input).reverse()), key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(originalText);
    expect(replay.headers.get("etag")).toBe(original.headers.get("etag"));
    expect(replay.headers.get("location")).toBe(original.headers.get("location"));
    await problem(await post(a, orderInput(a, { quantityKg: UPDATED_KG }), key), 422, "idempotency_key_reused");
    expect((await post(a, input, key, "", a.secondWriteKey)).status).toBe(201);
    expect(await rows(a)).toHaveLength(2);
    expect(await records(a)).toHaveLength(2);
    expect(await audits(a)).toHaveLength(2);
  });
});

describe("order PATCH", { timeout: TIMEOUT_MS }, () => {
  it.each(["orderId", "expectedVersion", "bogus"])("refuses %s as an unknown field", async (field) => {
    const order = await saved();
    const refusal = await problem(await patch(a, order.id, { [field]: 1 }, INITIAL_ETAG), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${field}`, code: "unknown_field" }));
    expect((await read(a, order.id)).data).toEqual(order);
  });
  it("refuses duplicate codes with a code pointer", async () => {
    const first = await saved();
    const second = await saved();
    await problem(await patch(a, second.id, { code: first.code }, INITIAL_ETAG), 409, "conflict", "/code");
    expect((await read(a, second.id)).data).toEqual(second);
  });
  it("refuses a delete-only credential before checking target or version", async () => {
    const order = await saved();
    for (const id of [order.id, randomUUID()]) {
      await problem(await patch(a, id, {}, NEXT_ETAG, undefined, "", a.deleteKey), 403, "missing_scope");
    }
    expect((await read(a, order.id)).data).toEqual(order);
  });
  it("refuses a key reused with another target or If-Match", async () => {
    const first = await saved();
    const second = await saved();
    const key = randomUUID();
    const body = { quantityKg: UPDATED_KG };
    expect((await patch(a, first.id, body, INITIAL_ETAG, key)).status).toBe(200);
    await problem(await patch(a, second.id, body, INITIAL_ETAG, key), 422, "idempotency_key_reused");
    await problem(await patch(a, first.id, body, NEXT_ETAG, key), 422, "idempotency_key_reused");
    expect((await read(a, second.id)).data).toEqual(second);
    expect((await audits(a)).filter((row) => row.operationId === "update_order")).toHaveLength(1);
  });
  it("isolates keys across organizations and credentials", async () => {
    const first = await saved();
    const foreign = await saved(b);
    const key = randomUUID();
    for (const response of [
      await patch(a, first.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG, key),
      await patch(a, first.id, { quantityKg: LATER_KG }, NEXT_ETAG, key, "", a.secondWriteKey),
      await patch(b, foreign.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG, key),
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.has("idempotent-replayed")).toBe(false);
    }
    expect((await read(a, first.id)).data).toMatchObject({ quantityKg: LATER_KG, version: 3 });
    expect((await read(b, foreign.id)).data).toMatchObject({ quantityKg: UPDATED_KG, version: 2 });
    expect((await audits(a)).filter((row) => row.operationId === "update_order")).toHaveLength(2);
    expect((await audits(b)).filter((row) => row.operationId === "update_order")).toHaveLength(1);
  });
  it("requires If-Match, bumps the tag, preserves omitted fields, clears a null location and returns current for stale tags", async () => {
    const order = await saved();
    await problem(await patch(a, order.id, {}), 428, "precondition_required");
    const response = await patch(a, order.id, { customerLocationId: null }, INITIAL_ETAG);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(NEXT_ETAG);
    const body = await response.json();
    expect(body).not.toHaveProperty("warnings");
    const current = body.data;
    expect(current).toMatchObject({ ...order, customerLocationId: null, version: 2, updatedAt: expect.any(String) });
    expect(await read(a, order.id)).toEqual({ data: current, etag: NEXT_ETAG });
    expect((await audits(a)).filter((row) => row.operationId === "update_order")).toMatchObject([{
      changedFields: ["customerLocationId"], versionBefore: 1, versionAfter: 2,
    }]);
    for (const tag of [INITIAL_ETAG, '"2.99"']) {
      expect((await problem(await patch(a, order.id, { quantityKg: UPDATED_KG }, tag), 412, "stale_version")).current).toEqual(current);
    }
  });
  it("rolls back previews and never claims their keys", async () => {
    const order = await saved();
    const count = (await records(a)).length;
    const response = await patch(a, order.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG, randomUUID(), "?dryRun=true");
    expect(response.status).toBe(200);
    expect(response.headers.get("dry-run")).toBe("true");
    expect(response.headers.has("etag")).toBe(false);
    expect((await response.json()).data.quantityKg).toBe(UPDATED_KG);
    expect((await read(a, order.id)).data).toEqual(order);
    expect(await records(a)).toHaveLength(count);
  });
  it.each([false, true])("freezes every relationship once a delivery exists (archived: %s)", async (archived) => {
    const order = await saved();
    await insertReadDelivery(a, order.id, ALLOCATED_KG, archived);
    for (const [field, value] of Object.entries({ facilityId: a.otherFacility.id, customerId: a.otherCustomer.id, customerLocationId: null, formulationId: a.pure.id })) {
      await problem(await patch(a, order.id, { [field]: value }, INITIAL_ETAG), 409, "conflict", `/${field}`);
    }
    expect((await read(a, order.id)).data).toEqual(order);
  });
  it("returns allocation metadata on a quantity below delivered wet kg", async () => {
    const order = await saved();
    await insertReadDelivery(a, order.id, ALLOCATED_KG);
    const refusal = await problem(await patch(a, order.id, { quantityKg: BELOW_ALLOCATED_KG }, INITIAL_ETAG), 422, "validation_failed", "/quantityKg");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/quantityKg", meta: { allocatedWetKg: ALLOCATED_KG, unit: "kg" } }));
    expect((await read(a, order.id)).data).toEqual(order);
  });
  it("refuses archived updates and codes in the path", async () => {
    const order = await saved();
    await problem(await patch(a, order.code, {}, INITIAL_ETAG), 404, "not_found");
    await archiveReadOrder(a, order.id);
    await problem(await patch(a, order.id, {}, INITIAL_ETAG), 404, "not_found", "/orderId");
  });
  it("replays after another edit and archive, and refuses changed keyed payloads", async () => {
    const order = await saved();
    const key = randomUUID();
    const first = await patch(a, order.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG, key);
    const original = await first.text();
    expect((await patch(a, order.id, { quantityKg: LATER_KG }, NEXT_ETAG)).status).toBe(200);
    await archiveReadOrder(a, order.id);
    const replay = await patch(a, order.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(NEXT_ETAG);
    expect(await replay.text()).toBe(original);
    await problem(await patch(a, order.id, { quantityKg: LATER_KG }, INITIAL_ETAG, key), 422, "idempotency_key_reused");
    expect((await read(a, order.id)).data.quantityKg).toBe(LATER_KG);
    expect(await audits(a)).toHaveLength(3);
  });
});

describe("order DELETE", { timeout: TIMEOUT_MS }, () => {
  it("refuses a key reused with another target or If-Match", async () => {
    const first = await saved();
    const second = await saved();
    const key = randomUUID();
    expect((await remove(a, first.id, INITIAL_ETAG, key)).status).toBe(204);
    await problem(await remove(a, second.id, INITIAL_ETAG, key), 422, "idempotency_key_reused");
    await problem(await remove(a, first.id, NEXT_ETAG, key), 422, "idempotency_key_reused");
    expect((await read(a, second.id)).data).toEqual(second);
    expect((await audits(a)).filter((row) => row.operationId === "delete_order")).toHaveLength(1);
  });
  it("isolates keys across organizations and credentials", async () => {
    const first = await saved();
    const second = await saved();
    const foreign = await saved(b);
    const key = randomUUID();
    for (const response of [
      await remove(a, first.id, INITIAL_ETAG, key),
      await remove(a, second.id, INITIAL_ETAG, key, "", undefined, a.secondDeleteKey),
      await remove(b, foreign.id, INITIAL_ETAG, key),
    ]) {
      expect(response.status).toBe(204);
      expect(response.headers.has("idempotent-replayed")).toBe(false);
    }
    expect(await rows(a)).toEqual([]);
    expect(await rows(b)).toEqual([]);
    expect((await audits(a)).filter((row) => row.operationId === "delete_order")).toHaveLength(2);
    expect((await audits(b)).filter((row) => row.operationId === "delete_order")).toHaveLength(1);
  });
  it("requires the separate scope and If-Match, validates the body, then deletes and replays as 204", async () => {
    const order = await saved();
    await problem(await remove(a, order.id, INITIAL_ETAG, undefined, "", undefined, a.writeOnlyKey), 403, "missing_scope");
    await problem(await remove(a, order.id), 428, "precondition_required");
    for (const body of [{ force: true }, null, [], "", 1]) await problem(await remove(a, order.id, INITIAL_ETAG, undefined, "", body), 422, "validation_failed");
    const key = randomUUID();
    expect((await remove(a, order.id, INITIAL_ETAG, key, "", {})).status).toBe(204);
    const replay = await remove(a, order.id, INITIAL_ETAG, key);
    expect(replay.status).toBe(204);
    expect(await replay.text()).toBe("");
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await rows(a)).toEqual([]);
    expect(await audits(a)).toHaveLength(2);
  });
  it.each([false, true])("refuses orders with a delivery (archived: %s)", async (archived) => {
    const order = await saved();
    await insertReadDelivery(a, order.id, ALLOCATED_KG, archived);
    await problem(await remove(a, order.id, INITIAL_ETAG), 409, "conflict");
    expect(await rows(a)).toHaveLength(1);
  });
  it("previews an archived order without deleting it, then allows a committed deletion", async () => {
    const order = await saved();
    await archiveReadOrder(a, order.id);
    const current = (await read(a, order.id)).data;
    const key = randomUUID();
    const preview = await remove(a, order.id, INITIAL_ETAG, key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect((await preview.json()).data).toEqual(current);
    expect(await rows(a)).toHaveLength(1);
    expect(await records(a)).toHaveLength(1);
    expect((await remove(a, order.id, INITIAL_ETAG, key)).status).toBe(204);
  });
  it("returns current on a stale version or representation revision", async () => {
    const order = await saved();
    await patch(a, order.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG);
    const current = (await read(a, order.id)).data;
    for (const tag of [INITIAL_ETAG, '"2.99"']) expect((await problem(await remove(a, order.id, tag), 412, "stale_version")).current).toEqual(current);
  });
});

describe("order write BOLA", { timeout: TIMEOUT_MS }, () => {
  it("refuses foreign and unknown body references with pointers and no side effects", async () => {
    const order = await saved();
    for (const [field, foreign] of Object.entries({ facilityId: b.facility.id, customerId: b.customer.id, customerLocationId: b.location.id, formulationId: b.recipe.id })) {
      for (const id of [foreign, randomUUID()]) {
        await problem(await post(a, orderInput(a, { [field]: id })), 404, "not_found", `/${field}`);
        await problem(await patch(a, order.id, { [field]: id }, INITIAL_ETAG), 404, "not_found", `/${field}`);
      }
    }
    expect((await read(a, order.id)).data).toEqual(order);
    expect(await rows(a)).toHaveLength(1);
    expect(await rows(b)).toEqual([]);
    expect(await records(a)).toHaveLength(1);
    expect(await audits(a)).toHaveLength(1);
  });
  it("refuses foreign targets and codes, and checks scopes before existence", async () => {
    const foreign = await saved(b);
    for (const id of [foreign.id, randomUUID()]) {
      await problem(await patch(a, id, {}, INITIAL_ETAG), 404, "not_found", "/orderId");
      await problem(await remove(a, id, INITIAL_ETAG), 404, "not_found", "/orderId");
      await problem(await patch(a, id, {}, INITIAL_ETAG, undefined, "", a.orderKey), 403, "missing_scope");
      await problem(await remove(a, id, INITIAL_ETAG, undefined, "", undefined, a.writeOnlyKey), 403, "missing_scope");
    }
    await problem(await remove(a, foreign.code, INITIAL_ETAG), 404, "not_found");
    await problem(await post(a, orderInput(b), randomUUID(), "", a.orderKey), 403, "missing_scope");
    expect((await read(b, foreign.id)).data).toEqual(foreign);
    expect(await rows(a)).toEqual([]);
    expect(await audits(a)).toEqual([]);
  });
  it("canonicalizes uppercase UUIDs in the body and path, including keyed replay", async () => {
    const key = randomUUID();
    const created = await post(a, uppercaseUuids(orderInput(a)), key);
    expect(created.status).toBe(201);
    const order = (await created.json()).data;
    expect(order).toMatchObject({ facilityId: a.facility.id, customerId: a.customer.id, customerLocationId: a.location.id, formulationId: a.recipe.id });
    expect((await post(a, orderInput(a), key)).headers.get("idempotent-replayed")).toBe("true");
    const patchKey = randomUUID();
    expect((await patch(a, order.id.toUpperCase(), { formulationId: a.recipe.id.toUpperCase() }, INITIAL_ETAG, patchKey)).status).toBe(200);
    expect((await patch(a, order.id, { formulationId: a.recipe.id }, INITIAL_ETAG, patchKey)).headers.get("idempotent-replayed")).toBe("true");
    expect((await remove(a, order.id.toUpperCase(), NEXT_ETAG)).status).toBe(204);
  });
  it("refuses a same-organization location belonging to a different customer", async () => {
    await problem(await post(a, orderInput(a, { customerId: a.otherCustomer.id })), 422, "validation_failed", "/customerLocationId");
    const order = await saved();
    await problem(await patch(a, order.id, { customerId: a.otherCustomer.id }, INITIAL_ETAG), 422, "validation_failed", "/customerLocationId");
    expect((await read(a, order.id)).data).toEqual(order);
  });
});

describe("order certification errors", { timeout: TIMEOUT_MS }, () => {
  it("maps the existing lineage lock to 409 with the order pointer", async () => {
    await certifyOutputLineage(a, { runId: a.runs[0].id, submitted: true });
    const [order] = await rows(a);
    await problem(await patch(a, order.id, { quantityKg: UPDATED_KG }, INITIAL_ETAG), 409, "certification_locked", "/orderId");
    await problem(await remove(a, order.id, INITIAL_ETAG), 409, "certification_locked", "/orderId");
    expect(await rows(a)).toEqual([order]);
    expect(await audits(a)).toEqual([]);
  });
});
