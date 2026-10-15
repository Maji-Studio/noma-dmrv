/** Real routes, API credentials and Postgres; run by explicit path only. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiIdempotencyRecords, deliveries } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { rpc, rpcBody } from "./helpers/mcp";
import { guardApiMethod } from "@/lib/api/method-not-allowed";
import { deliveryRepresentationSchema } from "@/lib/representations/deliveries";
import { createApiDeliveryWriteFixture, removeApiDeliveryWriteFixture, postDelivery as post, patchDelivery as patch, readDelivery as read,
  deliveryInput, deliveryProblem as problem, deliveryRows as rows, deliveryRecords as records, deliveryAudits as audits,
  DELIVERY_TEST_TIMEOUT_MS, type ApiDeliveryWriteFixture } from "./helpers/api-delivery-write-fixture";
import { uppercaseUuids } from "./helpers/uppercase-uuids";
import { archiveReadOrder, READ_ARCHIVE_AT } from "./helpers/api-order-read-fixture";

let a: ApiDeliveryWriteFixture;
let b: ApiDeliveryWriteFixture;
beforeEach(async () => { a = await createApiDeliveryWriteFixture(); b = await createApiDeliveryWriteFixture(); }, DELIVERY_TEST_TIMEOUT_MS);
afterEach(async () => { for (const f of [a, b]) if (f) await removeApiDeliveryWriteFixture(f); }, DELIVERY_TEST_TIMEOUT_MS);
async function saved(f = a, extra: Record<string, unknown> = {}) {
  const response = await post(f, deliveryInput(f, extra));
  expect(response.status).toBe(201);
  return { data: (await response.json()).data, etag: response.headers.get("etag")! };
}
const archive = (f: ApiDeliveryWriteFixture, id: string) => db.update(deliveries).set({ archivedAt: READ_ARCHIVE_AT })
  .where(and(eq(deliveries.organizationId, f.ctx.organizationId), eq(deliveries.id, id)));

it("creates a delivery with allocations, an upload warning, Location and the GET ETag", async () => {
  const response = await post(a);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(deliveryRepresentationSchema.parse(body.data)).toEqual(body.data);
  expect(body.allocations).toMatchObject([{ layerId: a.product.id, code: a.product.code, policy: "pro_rata", wetKg: 100, moisturePercent: 20 }]);
  expect(body.warnings).toEqual(["No bill of lading is uploaded. Upload the bill of lading in the app."]);
  expect(response.headers.get("location")).toBe(`/api/v1/deliveries/${body.data.id}`);
  expect(await read(a, body.data.id)).toEqual({ data: body.data, etag: response.headers.get("etag") });
  expect(body.data).not.toHaveProperty("savedProducts");
  expect(body).not.toHaveProperty("stockEffects");
  expect(body).not.toHaveProperty("basisFingerprint");
  expect(await audits(a)).toMatchObject([{ operationId: "record_delivery", outcomeCode: "created", transport: "rest" }]);
}, DELIVERY_TEST_TIMEOUT_MS);

describe("delivery create idempotency", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it.each(["code", "idempotencyKey", "facilityId", "status", "customerLocationId", "correctsMovementId"])("refuses POST unknown key %s without saving or claiming its key", async field => {
    const key = randomUUID();
    const refusal = await problem(await post(a, deliveryInput(a, { [field]: "unexpected" }), key), 422, "validation_failed", `/${field}`);
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${field}`, code: "unknown_field" }));
    expect(await rows(a)).toEqual([]);
    expect(await records(a)).toEqual([]);
    expect(await audits(a)).toEqual([]);
    expect((await post(a, deliveryInput(a), key)).status).toBe(201);
  });
  it("requires a key including dry runs; previews write no row, claim no key and match committed allocations", async () => {
    for (const query of ["", "?dryRun=true"]) await problem(await post(a, deliveryInput(a), null, query), 400, "idempotency_key_required");
    const key = randomUUID();
    const preview = await post(a, deliveryInput(a), key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("location")).toBe(false);
    expect(preview.headers.has("etag")).toBe(false);
    const body = await preview.json();
    expect(body.basisFingerprint).toEqual(expect.any(String));
    expect(body.stockEffects).toContainEqual(expect.objectContaining({ storageLocationId: a.bin.id, stockKind: "product_bin", delta: { wetKg: null, dryKg: -72 } }));
    expect(await rows(a)).toEqual([]);
    expect(await records(a)).toEqual([]);
    expect(await audits(a)).toEqual([]);
    const committed = await post(a, deliveryInput(a, { basisFingerprint: body.basisFingerprint }), key);
    expect(committed.status).toBe(201);
    expect((await committed.json()).allocations).toEqual(body.allocations);
    await problem(await post(a, deliveryInput(a), key, "?dryRun=true"), 409, "key_already_used");
  });
  it("replays reordered input byte for byte, refuses changes and isolates keys per credential and organization", async () => {
    const key = randomUUID();
    const input = deliveryInput(a);
    const first = await post(a, input, key);
    expect(first.status).toBe(201);
    const original = await first.text();
    const replay = await post(a, Object.fromEntries(Object.entries(input).reverse()), key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(replay.headers.get("location")).toBe(first.headers.get("location"));
    expect(await replay.text()).toBe(original);
    await problem(await post(a, deliveryInput(a, { deliveredWetMassKg: 101 }), key), 422, "idempotency_key_reused");
    expect((await post(a, input, key, "", a.secondWriteKey)).status).toBe(201);
    expect((await post(b, deliveryInput(b), key)).status).toBe(201);
    expect(await rows(a)).toHaveLength(2);
    expect(await records(a)).toHaveLength(2);
    expect(await audits(a)).toHaveLength(2);
    expect(await rows(b)).toHaveLength(1);
  });
  it("replays the original success after its order is archived", async () => {
    const key = randomUUID();
    const first = await post(a, deliveryInput(a), key);
    expect(first.status).toBe(201);
    const text = await first.text();
    await archiveReadOrder(a, a.order.id);
    const replay = await post(a, deliveryInput(a), key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(text);
    await problem(await post(a), 404, "not_found", "/orderId");
    expect(await rows(a)).toHaveLength(1);
  });
});

describe("delivery metadata PATCH", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it("refuses an archived delivery before an obsolete representation revision, after keyed replay", async () => {
    const first = await saved();
    const key = randomUUID();
    const body = { distanceNote: "Before archive" };
    const response = await patch(a, first.data.id, body, first.etag, key);
    expect(response.status).toBe(200);
    const original = await response.text();
    await archive(a, first.data.id);
    const replay = await patch(a, first.data.id, body, first.etag, key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe(original);
    const current = await read(a, first.data.id);
    const refusal = await problem(await patch(a, first.data.id, {}, `"${current.data.version}.99"`), 404, "not_found", "/deliveryId");
    expect(refusal).not.toHaveProperty("current");
    expect(await read(a, first.data.id)).toEqual(current);
    expect(await records(a)).toHaveLength(2);
    expect(await audits(a)).toHaveLength(2);
  });
  it("requires If-Match, bumps the ETag and returns current on stale versions or revisions", async () => {
    const first = await saved();
    await problem(await patch(a, first.data.id, {}), 428, "precondition_required");
    const updated = await patch(a, first.data.id, { distanceNote: "Road evidence" }, first.etag);
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).not.toBe(first.etag);
    const body = await updated.json();
    expect(body).not.toHaveProperty("warnings");
    expect(body.data.version).toBe(first.data.version + 1);
    expect(await read(a, first.data.id)).toEqual({ data: body.data, etag: updated.headers.get("etag") });
    for (const tag of [first.etag, `"${body.data.version}.99"`]) {
      expect((await problem(await patch(a, first.data.id, {}, tag), 412, "stale_version")).current).toEqual(body.data);
    }
  });
  it.each(["deliveredWetMassKg", "moisturePercent", "moistureContentPercent", "deliveredAt", "orderId", "storageLocationId", "sources", "deliveryId", "expectedVersion", "facilityId"])("refuses %s as an unknown key", async field => {
    const first = await saved();
    const body = await problem(await patch(a, first.data.id, { [field]: 1 }, first.etag), 422, "validation_failed", `/${field}`);
    expect(body.errors).toContainEqual(expect.objectContaining({ pointer: `/${field}`, code: "unknown_field" }));
    expect(await read(a, first.data.id)).toEqual(first);
  });
  it("preserves omitted distance and note, accepts positive and source-only patches, and clears a null override", async () => {
    let current = await saved(a, { distanceKmOverride: 25, distanceSource: "manual", distanceNote: "Keep this note" });
    const apply = async (body: object) => {
      const response = await patch(a, current.data.id, body, current.etag);
      expect(response.status).toBe(200);
      current = { data: (await response.json()).data, etag: response.headers.get("etag")! };
      return current.data;
    };
    expect(await apply({ driverId: a.driver.id, vehicleId: a.vehicle.id })).toMatchObject({ distanceKmOverride: 25, distanceSource: "manual", distanceNote: "Keep this note" });
    expect(await apply({ distanceSource: "document" })).toMatchObject({ distanceKmOverride: 25, distanceSource: "document" });
    expect(await apply({ distanceKmOverride: 30 })).toMatchObject({ distanceKmOverride: 30, distanceSource: "manual", distanceNote: "Keep this note" });
    expect(await apply({ distanceKmOverride: null })).toMatchObject({ distanceKmOverride: null, distanceSource: null });
    expect(await apply({ distanceSource: "document" })).toMatchObject({ distanceKmOverride: null, distanceSource: "document" });
    await problem(await patch(a, current.data.id, { distanceKmOverride: 0 }, current.etag), 422, "validation_failed", "/distanceKmOverride");
    expect(await read(a, current.data.id)).toEqual(current);
    expect(await apply({ driverId: null, vehicleId: null, distanceNote: null })).toMatchObject({ driverId: null, vehicleId: null, distanceNote: null });
  });
  it("rejects non-object bodies and duplicate codes without changing either delivery", async () => {
    const first = await saved();
    const second = await saved();
    for (const body of [null, [], "", 1]) await problem(await patch(a, first.data.id, body, first.etag), 422, "validation_failed");
    await problem(await patch(a, second.data.id, { code: first.data.code }, second.etag), 409, "conflict", "/code");
    expect(await read(a, first.data.id)).toEqual(first);
    expect(await read(a, second.data.id)).toEqual(second);
  });
  it("refuses codes and archived deliveries, but replays after a later edit and archive", async () => {
    const first = await saved();
    await problem(await patch(a, first.data.code, {}, first.etag), 404, "not_found");
    const key = randomUUID();
    const response = await patch(a, first.data.id, { distanceNote: "First edit" }, first.etag, key);
    expect(response.status).toBe(200);
    const original = await response.text();
    const later = await patch(a, first.data.id, { distanceNote: "Later edit" }, response.headers.get("etag")!);
    expect(later.status).toBe(200);
    await archive(a, first.data.id);
    const replay = await patch(a, first.data.id, { distanceNote: "First edit" }, first.etag, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(response.headers.get("etag"));
    expect(await replay.text()).toBe(original);
    await problem(await patch(a, first.data.id, { distanceNote: "Changed" }, first.etag, key), 422, "idempotency_key_reused");
    await problem(await patch(a, first.data.id, {}, later.headers.get("etag")!), 404, "not_found", "/deliveryId");
    expect(await audits(a)).toHaveLength(3);
  });
  it("binds keys to target and If-Match and isolates them per credential", async () => {
    const first = await saved();
    const second = await saved();
    const key = randomUUID();
    const body = { distanceNote: "Keyed edit" };
    const updated = await patch(a, first.data.id, body, first.etag, key);
    expect(updated.status).toBe(200);
    await problem(await patch(a, second.data.id, body, second.etag, key), 422, "idempotency_key_reused");
    await problem(await patch(a, first.data.id, body, updated.headers.get("etag")!, key), 422, "idempotency_key_reused");
    expect((await patch(a, first.data.id, body, updated.headers.get("etag")!, key, "", a.secondWriteKey)).status).toBe(200);
    expect(await read(a, second.data.id)).toEqual(second);
  });
  it("rolls back a dry run without claiming its key or changing the ETag", async () => {
    const first = await saved();
    const key = randomUUID();
    const response = await patch(a, first.data.id, { distanceNote: "Preview" }, first.etag, key, "?dryRun=true");
    expect(response.status).toBe(200);
    expect(response.headers.get("dry-run")).toBe("true");
    expect(response.headers.has("etag")).toBe(false);
    expect((await response.json()).data.distanceNote).toBe("Preview");
    expect(await read(a, first.data.id)).toEqual(first);
    expect(await records(a)).toHaveLength(1);
    expect(await audits(a)).toHaveLength(1);
    expect((await patch(a, first.data.id, { distanceNote: "Preview" }, first.etag, key)).status).toBe(200);
    await problem(await patch(a, first.data.id, { distanceNote: "Preview" }, first.etag, key, "?dryRun=true"), 409, "key_already_used");
  });
});

describe("delivery write tenant boundaries", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it("hides foreign and unknown body references with pointers and no side effects", async () => {
    const first = await saved();
    for (const [field, foreign] of Object.entries({ orderId: b.order.id, storageLocationId: b.bin.id, driverId: b.driver.id, vehicleId: b.vehicle.id })) {
      for (const id of [foreign, randomUUID()]) {
        await problem(await post(a, deliveryInput(a, { [field]: id })), 404, "not_found", `/${field}`);
        if (field === "driverId" || field === "vehicleId") await problem(await patch(a, first.data.id, { [field]: id }, first.etag), 404, "not_found", `/${field}`);
      }
    }
    for (const layerId of [b.product.id, randomUUID()]) {
      await problem(await post(a, deliveryInput(a, { sources: [{ layerId, moisturePercent: 20 }] })), 404, "not_found", "/sources/0/layerId");
    }
    expect(await read(a, first.data.id)).toEqual(first);
    expect(await rows(a)).toHaveLength(1);
    expect(await records(a)).toHaveLength(1);
    expect(await audits(a)).toHaveLength(1);
    expect(await rows(b)).toEqual([]);
  });
  it("checks scope before foreign target or body existence", async () => {
    const foreign = await saved(b);
    for (const id of [foreign.data.id, randomUUID()]) {
      await problem(await patch(a, id, {}, foreign.etag), 404, "not_found", "/deliveryId");
      for (const credential of [a.readKey, a.missingScopeKey]) {
        await problem(await patch(a, id, {}, foreign.etag, null, "", credential), 403, "missing_scope");
        await problem(await post(a, deliveryInput(b), randomUUID(), "", credential), 403, "missing_scope");
      }
    }
    expect(await rows(a)).toEqual([]);
    expect(await read(b, foreign.data.id)).toEqual(foreign);
  });
  it("canonicalizes uppercase body and path UUIDs, including keyed replay", async () => {
    const input = deliveryInput(a, { driverId: a.driver.id, vehicleId: a.vehicle.id });
    const key = randomUUID();
    const response = await post(a, uppercaseUuids(input), key);
    expect(response.status).toBe(201);
    const data = (await response.json()).data;
    expect(data).toMatchObject({ orderId: a.order.id, storageLocationId: a.bin.id, driverId: a.driver.id, vehicleId: a.vehicle.id });
    expect((await post(a, input, key)).headers.get("idempotent-replayed")).toBe("true");
    const patchKey = randomUUID();
    const tag = response.headers.get("etag")!;
    expect((await patch(a, data.id.toUpperCase(), { driverId: a.driver.id.toUpperCase() }, tag, patchKey)).status).toBe(200);
    expect((await patch(a, data.id, { driverId: a.driver.id }, tag, patchKey)).headers.get("idempotent-replayed")).toBe("true");
  });
  it("returns 405 and Allow for DELETE and every other unpublished delivery method", async () => {
    const first = await saved();
    for (const [path, methods] of [["/deliveries", ["DELETE", "PATCH", "PUT", "PROPFIND"]], [`/deliveries/${first.data.id}`, ["DELETE", "POST", "PUT", "PROPFIND"]]] as const) {
      for (const method of methods) {
        const response = await guardApiMethod(new Request(`http://localhost:3100/api/v1${path}`, { method, headers: { authorization: `Bearer ${a.writeKey}` } }));
        expect(response?.status).toBe(405);
        expect(response?.headers.get("allow")).toBe(path === "/deliveries" ? "GET, HEAD, OPTIONS, POST" : "GET, HEAD, OPTIONS, PATCH");
        expect((await response!.json()).code).toBe("method_not_allowed");
      }
    }
    expect(await read(a, first.data.id)).toEqual(first);
  });
});


it.each(["create", "update"] as const)("replays a pre-revision-bump %s outcome with its original ETag", async operation => {
  const key = randomUUID();
  const input = deliveryInput(a);
  const first = await saved();
  const changes = { distanceNote: "Original edit" };
  const send = () => operation === "create" ? post(a, input, key) : patch(a, first.data.id, changes, first.etag, key);
  const response = await send();
  expect(response.status).toBe(operation === "create" ? 201 : 200);
  const body = await response.json();
  const record = (await records(a)).find(row => row.idempotencyKey === key)!;
  const outcome = record.outcome as { kind: string; data: { representationRevision?: number; delivery: Record<string, unknown> } };
  expect(outcome.data.representationRevision).toBe(2);
  delete outcome.data.representationRevision;
  outcome.data.delivery.destinationCustomerLocationId = null;
  await db.update(apiIdempotencyRecords).set({ outcome }).where(and(
    eq(apiIdempotencyRecords.organizationId, a.ctx.organizationId), eq(apiIdempotencyRecords.id, record.id),
  ));
  const replay = await send();
  expect(replay.status).toBe(response.status);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect(replay.headers.get("etag")).toBe(`"${body.data.version}.1"`);
  const legacyBody = { ...body, data: { ...body.data, destinationCustomerLocationId: null } };
  expect(await replay.json()).toEqual(legacyBody);
  const mcpReplay = await rpcBody(await MCP(rpc(a.writeKey, "tools/call", {
    name: operation === "create" ? "record_delivery" : "update_delivery",
    arguments: { ...(operation === "create" ? input : { ...changes, deliveryId: first.data.id, expectedVersion: first.data.version }), requestKey: key },
  })));
  expect(mcpReplay.result.isError).toBeUndefined();
  expect(mcpReplay.result.structuredContent).toEqual(legacyBody);
  const current = await read(a, body.data.id);
  expect(current.etag).toBe(`"${body.data.version}.2"`);
  expect(current.data.destinationCustomerLocationId).not.toBeNull();
  expect(await records(a)).toHaveLength(2);
  expect(await audits(a)).toHaveLength(2);
}, DELIVERY_TEST_TIMEOUT_MS);
