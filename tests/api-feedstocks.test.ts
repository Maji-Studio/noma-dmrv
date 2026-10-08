/** Real handlers and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditEvents, organizationApiAccess, apiIdempotencyRecords, feedstocks, members, storageLocations, users } from "@/db/schema";
import { API_BODY_MAX_BYTES, API_FEEDSTOCK_MAX_ALLOCATIONS } from "@/config/api-rest";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { GET as LIST, POST } from "@/app/api/v1/feedstocks/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/feedstocks/[idOrCode]/route";
import { createIntakeFixture, feedstockCount, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";

const mocks = vi.hoisted(() => ({ env: { API_WRITES_DISABLED: false } }));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return { ...actual, env: { ...actual.env, get API_WRITES_DISABLED() { return mocks.env.API_WRITES_DISABLED; } } };
});

const SUITE_TIMEOUT_MS = 30_000;
let a: IntakeFixture;
let b: IntakeFixture;
let keyA: string;
let credentialIdA: string;
let keyB: string;
let readOnly: string;
const scopes = ["feedstocks:read", "feedstocks:write", "feedstocks:delete"];

beforeEach(async () => {
  mocks.env.API_WRITES_DISABLED = false;
  a = await createIntakeFixture(`rest-a-${randomUUID()}`);
  b = await createIntakeFixture(`rest-b-${randomUUID()}`);
  for (const fixture of [a, b]) {
    await db.insert(users).values({ id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`, name: "REST fixture", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: fixture.ctx.organizationId, userId: fixture.ctx.userId, role: "owner" });
    await db.update(storageLocations).set({ feedstockTypeId: fixture.feedstockTypeId }).where(eq(storageLocations.id, fixture.binId));
  }
  const credential = await createApiKey(a.ctx, { name: "Intake A", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  keyA = credential.key;
  credentialIdA = credential.id;
  keyB = (await createApiKey(b.ctx, { name: "Intake B", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  readOnly = (await createApiKey(a.ctx, { name: "Read only", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
});
afterEach(async () => {
  mocks.env.API_WRITES_DISABLED = false;
  await removeIntakeFixture(a);
  await removeIntakeFixture(b);
  await db.delete(users).where(inArray(users.id, [a.ctx.userId, b.ctx.userId]));
});

function request(method: string, path = "", body?: unknown, headers: Record<string, string> = {}, key = keyA) {
  return new Request(`http://localhost:3100/api/v1/feedstocks${path}`, {
    method, headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ idOrCode: id }) });
async function create(body = a.input(), key = randomUUID()) {
  const response = await POST(request("POST", "", body, { "idempotency-key": key }));
  expect(response.status).toBe(201);
  const text = await response.text();
  const data = JSON.parse(text).data;
  return { response, text, data, row: data[0], key, body, etag: response.headers.get("etag")! };
}
async function problem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBeTruthy();
  const body = await response.json();
  expect(body.code).toBe(code);
  return body;
}
const patch = (id: string, body: unknown, tag?: string, key = keyA, extras: Record<string, string> = {}) =>
  PATCH(request("PATCH", `/${id}`, body, { ...(tag ? { "if-match": tag } : {}), ...extras }, key), params(id));
const stock = (fixture = a) => deriveFeedstockWetStockKg(fixture.ctx, db, fixture.binId);

describe("feedstock REST contract", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("creates one stock addition, returns Location and ETag, and replays byte-identically", async () => {
    const first = await create();
    expect(first.response.headers.get("location")).toBe(`/api/v1/feedstocks/${first.row.id}`);
    expect(first.etag).toBe('"1.1"');
    expect(first.row).toMatchObject({ version: 1, deliveryDate: "2026-10-06", massWetKg: 4200, massDryKg: 2835, moistureContentPercent: 32.5 });
    expect(first.row).not.toHaveProperty("supplierName");
    expect(await stock()).toBe(4200);
    const replay = await POST(request("POST", "", first.body, { "idempotency-key": first.key }));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(first.etag);
    expect(await replay.text()).toBe(first.text);
    expect(await feedstockCount(a)).toBe(1);
    expect(await stock()).toBe(4200);
    await problem(await POST(request("POST", "", a.input(100), { "idempotency-key": first.key })), 422, "idempotency_key_reused");
  });

  it("requires a valid create key, while dry run rolls back stock and idempotency", async () => {
    await problem(await POST(request("POST", "", a.input())), 400, "idempotency_key_required");
    await problem(await POST(request("POST", "", a.input(), { "idempotency-key": "contains space" })), 400, "idempotency_key_invalid");
    const dryRunHeaders: Record<string, string>[] = [{}, { "idempotency-key": randomUUID() }];
    for (const headers of dryRunHeaders) {
      const response = await POST(request("POST", "?dryRun=true", a.input(), headers));
      expect(response.status).toBe(200);
      expect(response.headers.get("dry-run")).toBe("true");
      expect(response.headers.has("location")).toBe(false);
      const body = await response.json();
      expect(body.preview).toEqual([{ feedstockId: body.data[0].id, storageLocationId: a.binId,
        allocatedWetMassKg: 4200, allocatedDryMassKg: 2835, stockDeltaWetKg: 4200 }]);
      expect(await feedstockCount(a)).toBe(0);
      expect(await stock()).toBe(0);
      expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, a.ctx.organizationId))).toHaveLength(0);
    }
    const saved = await create();
    await problem(await POST(request("POST", "?dryRun=true", a.input(), { "idempotency-key": saved.key })), 409, "key_already_used");
  });

  it("returns all split allocations and warnings from the stored result", async () => {
    const [bin] = await db.insert(storageLocations).values({
      organizationId: a.ctx.organizationId, facilityId: a.facilityId, feedstockTypeId: a.feedstockTypeId,
      code: "BIN-SECOND", name: "Second intake bin", type: "feedstock_bin",
    }).returning();
    const saved = await create({ ...a.input(100), overrideJustification: "Scale adjustment", allocations: [
      { storageLocationId: a.binId, allocatedWetMassKg: 80 }, { storageLocationId: bin.id, allocatedWetMassKg: 30 },
    ] });
    expect(saved.data).toHaveLength(2);
    expect(JSON.parse(saved.text).warnings).toHaveLength(1);
    expect(saved.data[0].deliveryGroupId).toBe(saved.data[1].deliveryGroupId);
    const replay = await POST(request("POST", "", saved.body, { "idempotency-key": saved.key }));
    expect(await replay.text()).toBe(saved.text);
    expect(await stock()).toBe(80);
    expect(await deriveFeedstockWetStockKg(a.ctx, db, bin.id)).toBe(30);
  });

  it("gets by id and code and paginates one fixed newest-first ordering", async () => {
    const first = await create();
    const second = await create();
    for (const identifier of [first.row.id, first.row.code]) {
      const response = await GET(request("GET", `/${identifier}`), params(identifier));
      expect(response.headers.get("etag")).toBe(first.etag);
      expect(await response.json()).toEqual({ data: first.row });
    }
    const page1 = await (await LIST(request("GET", "?limit=1"))).json();
    expect(page1.data.map((row: { id: string }) => row.id)).toEqual([second.row.id]);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await (await LIST(request("GET", `?limit=1&cursor=${page1.nextCursor}`))).json();
    expect(page2.data.map((row: { id: string }) => row.id)).toEqual([first.row.id]);
    expect(page2.nextCursor).toBeNull();
    expect(page1).not.toHaveProperty("total");
    await problem(await LIST(request("GET", `?q=FS&cursor=${page1.nextCursor}`)), 400, "invalid_cursor");
    await problem(await LIST(request("GET", `?cursor=${page1.nextCursor}`, undefined, {}, keyB)), 400, "invalid_cursor");
    const exact = await (await LIST(request("GET", `?code=${first.row.code}&facilityId=${a.facilityId}`))).json();
    expect(exact.data).toEqual([first.row]);
    const prefix = await (await LIST(request("GET", `?q=${first.row.code.toLowerCase()}`))).json();
    expect(prefix.data).toEqual([first.row]);
    expect((await (await LIST(request("GET", "?q=%25"))).json()).data).toEqual([]);
    for (const query of ["?limit=201", "?limit=0", "?limit=1&limit=2", "?other=true", "?facilityId=invalid"]) {
      await problem(await LIST(request("GET", query)), 400, "invalid_query");
    }
  });

  it("does not lose timestamp microseconds or UUID tie-breaks between pages", async () => {
    const entries = [await create(), await create(), await create()];
    for (const [index, entry] of entries.entries()) {
      await db.update(feedstocks).set({ createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp` }).where(eq(feedstocks.id, entry.row.id));
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await (await LIST(request("GET", `?limit=1${cursor ? `&cursor=${cursor}` : ""}`))).json();
      ids.push(...page.data.map((row: { id: string }) => row.id));
      cursor = page.nextCursor;
    } while (cursor && ids.length <= entries.length);
    expect(ids).toEqual([...[entries[1].row.id, entries[2].row.id].sort().reverse(), entries[0].row.id]);
  });

  it("enforces strong preconditions, returns current on stale writes and preserves patch semantics", async () => {
    const saved = await create({ ...a.input(), notes: "Keep this note" });
    await problem(await patch(saved.row.id, {}), 428, "precondition_required");
    for (const tag of ["*", 'W/"1.1"']) await problem(await patch(saved.row.id, {}, tag), 428, "strong_etag_required");
    await problem(await patch(saved.row.id, {}, '"1.99"'), 412, "stale_version");
    const updated = await patch(saved.row.id, { moistureContentPercent: 0 }, saved.etag);
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).toBe('"2.1"');
    const current = (await updated.json()).data;
    expect(current).toMatchObject({ version: 2, moistureContentPercent: 0, massDryKg: 4200, notes: "Keep this note" });
    const stale = await problem(await patch(saved.row.id, { notes: "Stale" }, saved.etag), 412, "stale_version");
    expect(stale.current).toEqual(current);
    const cleared = await patch(saved.row.id, { notes: null, transportDistanceKm: null }, '"2.1"');
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).data).toMatchObject({ version: 3, notes: null, moistureContentPercent: 0 });
  });

  it("replays PATCH before its old precondition, including after deletion", async () => {
    const saved = await create();
    const key = randomUUID();
    const first = await patch(saved.row.id, { notes: "First patch" }, saved.etag, keyA, { "idempotency-key": key });
    const text = await first.text();
    expect(first.status).toBe(200);
    expect((await patch(saved.row.id, { notes: "Later edit" }, '"2.1"')).status).toBe(200);
    for (const deleted of [false, true]) {
      if (deleted) expect((await DELETE(request("DELETE", `/${saved.row.id}`, undefined, { "if-match": '"3.1"' }), params(saved.row.id))).status).toBe(204);
      const replay = await patch(saved.row.id, { notes: "First patch" }, saved.etag, keyA, { "idempotency-key": key });
      expect(replay.status).toBe(200);
      expect(replay.headers.get("idempotent-replayed")).toBe("true");
      expect(await replay.text()).toBe(text);
    }
  });

  it("rolls back PATCH and DELETE dry runs, then deletes and replays a real delete", async () => {
    const saved = await create();
    const dryPatch = await PATCH(request("PATCH", `/${saved.row.id}?dryRun=true`, { notes: "Preview" }, { "if-match": saved.etag }), params(saved.row.id));
    expect(dryPatch.status).toBe(200);
    expect(dryPatch.headers.get("dry-run")).toBe("true");
    expect((await dryPatch.json()).data).toMatchObject({ version: 2, notes: "Preview" });
    const dryDelete = await DELETE(request("DELETE", `/${saved.row.id}?dryRun=true`, undefined, { "if-match": saved.etag }), params(saved.row.id));
    expect(dryDelete.status).toBe(200);
    expect(dryDelete.headers.get("dry-run")).toBe("true");
    expect((await dryDelete.json()).data).toEqual(saved.row);
    expect(await stock()).toBe(4200);
    expect((await (await GET(request("GET", `/${saved.row.id}`), params(saved.row.id))).json()).data).toEqual(saved.row);
    await problem(await DELETE(request("DELETE", `/${saved.row.id}`), params(saved.row.id)), 428, "precondition_required");
    const headers = { "if-match": saved.etag, "idempotency-key": randomUUID() };
    for (const replay of [false, true]) {
      const response = await DELETE(request("DELETE", `/${saved.row.id}`, undefined, headers), params(saved.row.id));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(response.headers.get("idempotent-replayed")).toBe(replay ? "true" : null);
    }
    await problem(await GET(request("GET", `/${saved.row.id}`), params(saved.row.id)), 404, "not_found");
    await problem(await patch(saved.row.id, {}, saved.etag), 404, "not_found");
    expect(await stock()).toBe(0);
  });

  it("rejects unknown top-level and nested properties with JSON Pointers", async () => {
    const body = { ...a.input(), extra: true, allocations: [{ storageLocationId: a.binId, allocatedWetMassKg: 100, "a/b~": true }] };
    const failure = await problem(await POST(request("POST", "", body, { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(failure.errors).toEqual([
      { pointer: "/allocations/0/a~1b~0", code: "unknown_field", detail: expect.any(String) },
      { pointer: "/extra", code: "unknown_field", detail: expect.any(String) },
    ]);
    expect(await feedstockCount(a)).toBe(0);
    const saved = await create();
    const forged = await problem(await patch(saved.row.id, { expectedVersion: 20, feedstockId: randomUUID() }, saved.etag), 422, "validation_failed");
    expect(forged.errors.map((issue: { pointer: string }) => issue.pointer)).toEqual(["/expectedVersion", "/feedstockId"]);
    const tooMany = await problem(await POST(request("POST", "", {
      ...a.input(), allocations: Array.from({ length: API_FEEDSTOCK_MAX_ALLOCATIONS + 1 }, () => ({ storageLocationId: a.binId, allocatedWetMassKg: 1 })),
    }, { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(tooMany.errors[0]).toMatchObject({ pointer: "/allocations", code: "too_big" });
  });

  it("refuses foreign targets and references without side effects, and checks scopes", async () => {
    const saved = await create();
    for (const identifier of [saved.row.id, saved.row.code]) {
      await problem(await GET(request("GET", `/${identifier}`, undefined, {}, keyB), params(identifier)), 404, "not_found");
    }
    await problem(await LIST(request("GET", `?facilityId=${a.facilityId}`, undefined, {}, keyB)), 404, "not_found");
    await problem(await patch(saved.row.id, { notes: "Foreign" }, saved.etag, keyB), 404, "not_found");
    await problem(await DELETE(request("DELETE", `/${saved.row.id}`, undefined, { "if-match": saved.etag }, keyB), params(saved.row.id)), 404, "not_found");
    for (const [overrides, pointer] of [
      [{ facilityId: a.facilityId }, "/facilityId"], [{ supplierId: a.supplierId }, "/supplierId"],
      [{ feedstockTypeId: a.feedstockTypeId }, "/feedstockTypeId"],
      [{ allocations: [{ storageLocationId: a.binId, allocatedWetMassKg: 4200 }] }, "/allocations/0/storageLocationId"],
    ] as const) {
      const response = await POST(request("POST", "", { ...b.input(), ...overrides }, { "idempotency-key": randomUUID() }, keyB));
      const failure = await problem(response, 404, "not_found");
      expect(failure.errors).toEqual([{ pointer, code: "not_found", detail: expect.any(String) }]);
      expect(await feedstockCount(b)).toBe(0);
      expect(await stock(b)).toBe(0);
    }
    await problem(await POST(request("POST", "", a.input(), { "idempotency-key": randomUUID() }, readOnly)), 403, "missing_scope");
    await problem(await patch(saved.row.id, {}, saved.etag, readOnly), 403, "missing_scope");
    await problem(await DELETE(request("DELETE", `/${saved.row.id}`, undefined, { "if-match": saved.etag }, readOnly), params(saved.row.id)), 403, "missing_scope");
    expect(await feedstockCount(a)).toBe(1);
    expect(await stock()).toBe(4200);
  });

  it("rejects absent and foreign UUIDs on PATCH without changing the row or stock", async () => {
    const saved = await create();
    for (const [field, foreignId] of [
      ["facilityId", b.facilityId], ["supplierId", b.supplierId],
      ["feedstockTypeId", b.feedstockTypeId], ["storageLocationId", b.binId],
      ["vehicleId", randomUUID()],
    ]) {
      for (const id of [foreignId, randomUUID()]) {
        const failure = await problem(await patch(saved.row.id, { [field]: id }, saved.etag), 404, "not_found");
        expect(failure.errors).toEqual([{ pointer: `/${field}`, code: "not_found", detail: expect.any(String) }]);
      }
    }
    expect((await (await GET(request("GET", `/${saved.row.id}`), params(saved.row.id))).json()).data).toEqual(saved.row);
    expect(await feedstockCount(a)).toBe(1);
    expect(await stock()).toBe(4200);
    expect(await stock(b)).toBe(0);
  });

  it("writes nothing when the POST budget expires while reading its body", async () => {
    const req = request("POST", "", a.input(), { "idempotency-key": randomUUID() });
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const getReader = req.body!.getReader.bind(req.body!);
    const reader = vi.spyOn(req.body!, "getReader").mockImplementation(() => {
      clock.mockReturnValue(startedAt + OPERATION_DEADLINE_MS);
      return getReader();
    });
    try {
      const failure = await problem(await POST(req), 500, "deadline_exceeded");
      expect(failure.retryable).toBe(true);
    } finally {
      reader.mockRestore();
      clock.mockRestore();
    }
    expect(await feedstockCount(a)).toBe(0);
    expect(await stock()).toBe(0);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, a.ctx.organizationId))).toHaveLength(0);
  });

  it("rejects unsupported media, streaming overflow, malformed JSON and invalid dryRun", async () => {
    const headers = { authorization: `Bearer ${keyA}`, "idempotency-key": randomUUID(), "content-type": "application/json" };
    await problem(await POST(request("POST", "", a.input(), { ...headers, "content-type": "text/plain" })), 415, "unsupported_media_type");
    await problem(await POST(new Request("http://localhost/api/v1/feedstocks", { method: "POST", headers, body: "{" })), 400, "malformed_json");
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('"'));
      controller.enqueue(new Uint8Array(API_BODY_MAX_BYTES));
      controller.close();
    } });
    await problem(await POST(new Request("http://localhost/api/v1/feedstocks", { method: "POST", headers, body: stream, duplex: "half" } as RequestInit)), 413, "payload_too_large");
    await problem(await POST(request("POST", "?dryRun=1", a.input(), headers)), 400, "invalid_query");
    expect(await feedstockCount(a)).toBe(0);
  });
});


const auditRows = () => db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, a.ctx.organizationId));

describe("feedstock REST guards and audit", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("audits create, update and delete once with field names and response request ids", async () => {
    const privateNotes = "Private intake detail excluded from audit";
    const created = await create({ ...a.input(), notes: privateNotes });
    const updated = await patch(created.row.id, { notes: privateNotes + " updated" }, created.etag);
    expect(updated.status).toBe(200);
    const deleted = await DELETE(request("DELETE", `/${created.row.id}`, undefined, { "if-match": updated.headers.get("etag")! }), params(created.row.id));
    expect(deleted.status).toBe(204);
    const events = await auditRows();
    expect(events).toHaveLength(3);
    const expected = [
      { response: created.response, operationId: "log_feedstock_delivery", outcomeCode: "created", versionBefore: null, versionAfter: 1,
        changedFields: ["allocations", "deliveryDate", "facilityId", "feedstockTypeId", "moisturePercent", "notes", "supplierId", "totalWetMassKg", "transportDistanceKm"] },
      { response: updated, operationId: "update_feedstock", outcomeCode: "updated", versionBefore: 1, versionAfter: 2, changedFields: ["notes"] },
      { response: deleted, operationId: "delete_feedstock", outcomeCode: "deleted", versionBefore: 2, versionAfter: null, changedFields: [] },
    ];
    for (const { response, ...effect } of expected) {
      const requestId = response.headers.get("x-request-id");
      expect(requestId).toBeTruthy();
      expect(events.filter((event) => event.requestId === requestId)).toHaveLength(1);
      expect(events.find((event) => event.requestId === requestId)).toMatchObject({
        ...effect, organizationId: a.ctx.organizationId, userId: a.ctx.userId,
        credentialId: credentialIdA, entityType: "feedstock", entityIds: [created.row.id],
      });
    }
    expect(JSON.stringify(events)).not.toContain(privateNotes);
  });

  it("adds no audit rows for dry runs or create, update and delete replays", async () => {
    const dryCreate = await POST(request("POST", "?dryRun=true", a.input()));
    expect(dryCreate.status).toBe(200);
    expect(await auditRows()).toEqual([]);
    const created = await create();
    const path = `/${created.row.id}`;
    const dryPatch = await PATCH(request("PATCH", path + "?dryRun=true", { notes: "Preview" }, { "if-match": created.etag }), params(created.row.id));
    expect(dryPatch.status).toBe(200);
    const dryDelete = await DELETE(request("DELETE", path + "?dryRun=true", undefined, { "if-match": created.etag }), params(created.row.id));
    expect(dryDelete.status).toBe(200);
    const beforeReplay = await auditRows();
    expect(beforeReplay).toHaveLength(1);
    const replayCreate = await POST(request("POST", "", created.body, { "idempotency-key": created.key }));
    expect(replayCreate.status).toBe(201);
    expect(replayCreate.headers.get("idempotent-replayed")).toBe("true");
    expect(await auditRows()).toEqual(beforeReplay);
    const updateKey = randomUUID();
    const updated = await patch(created.row.id, { notes: "Saved" }, created.etag, keyA, { "idempotency-key": updateKey });
    expect(updated.status).toBe(200);
    const replayUpdate = await patch(created.row.id, { notes: "Saved" }, created.etag, keyA, { "idempotency-key": updateKey });
    expect(replayUpdate.status).toBe(200);
    expect(replayUpdate.headers.get("idempotent-replayed")).toBe("true");
    expect(await auditRows()).toHaveLength(2);
    const deleteHeaders = { "if-match": updated.headers.get("etag")!, "idempotency-key": randomUUID() };
    expect((await DELETE(request("DELETE", path, undefined, deleteHeaders), params(created.row.id))).status).toBe(204);
    const replayDelete = await DELETE(request("DELETE", path, undefined, deleteHeaders), params(created.row.id));
    expect(replayDelete.status).toBe(204);
    expect(replayDelete.headers.get("idempotent-replayed")).toBe("true");
    expect(await auditRows()).toHaveLength(3);
  });

  it("refuses a feedstock GET when organization API access is disabled", async () => {
    const created = await create();
    await db.insert(organizationApiAccess).values({ organizationId: a.ctx.organizationId, enabled: false, changedByUserId: a.ctx.userId });
    await problem(await GET(request("GET", `/${created.row.id}`), params(created.row.id)), 403, "api_access_disabled");
  });

  it("blocks POST and dry-run POST without writes while GET remains available", async () => {
    mocks.env.API_WRITES_DISABLED = true;
    for (const path of ["", "?dryRun=true"]) {
      await problem(await POST(request("POST", path, a.input(), { "idempotency-key": randomUUID() })), 503, "api_writes_disabled");
    }
    expect((await LIST(request("GET"))).status).toBe(200);
    expect(await feedstockCount(a)).toBe(0);
    expect(await stock()).toBe(0);
    expect(await auditRows()).toEqual([]);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, a.ctx.organizationId))).toEqual([]);
  });
});
