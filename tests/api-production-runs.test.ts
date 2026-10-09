import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, storageLocations, productionRuns, productionRunFeedstockDraws } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { GET as LIST, POST } from "@/app/api/v1/production-runs/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/production-runs/[idOrCode]/route";
import {
  createApiProductionRunFixture, removeApiFeedstockFixture, seedApiFeedstock, binWetStock,
  productionRunInput, productionRunRequest, expectFeedstockProblem as problem, type ApiProductionRunFixture,
} from "./helpers/api-feedstock-fixture";

const TIMEOUT_MS = 30_000;
let a: ApiProductionRunFixture;
let b: ApiProductionRunFixture;
const params = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });
beforeEach(async () => {
  a = await createApiProductionRunFixture(`run-a-${randomUUID()}`);
  b = await createApiProductionRunFixture(`run-b-${randomUUID()}`);
  await seedApiFeedstock(a);
  await seedApiFeedstock(b);
});
afterEach(async () => { await removeApiFeedstockFixture(a); await removeApiFeedstockFixture(b); });
const request = (method: string, path = "", body?: unknown, headers: Record<string, string> = {}, fixture = a) =>
  productionRunRequest(fixture, method, path, body, headers);
async function create(body: unknown = productionRunInput(a), fixture = a, key = randomUUID()) {
  const response = await POST(request("POST", "", body, { "idempotency-key": key }, fixture));
  expect(response.status).toBe(201);
  const envelope = await response.json();
  return { row: envelope.data, body: envelope, etag: response.headers.get("etag")!, response, key };
}
const patch = (id: string, body: unknown, tag: string, path = "", fixture = a) =>
  PATCH(request("PATCH", `/${id}${path}`, body, { "if-match": tag }, fixture), params(id));
const rows = () => db.select().from(productionRuns).where(eq(productionRuns.organizationId, a.ctx.organizationId));

describe("production run REST outcomes", { timeout: TIMEOUT_MS }, () => {
  it("persists the run, explicit draw and resulting bin stock and returns a stable projection", async () => {
    const saved = await create();
    expect(saved.response.headers.get("location")).toBe(`/api/v1/production-runs/${saved.row.id}`);
    expect(saved.etag).toBe('"1.2"');
    expect(saved.body).not.toHaveProperty("stockEffects");
    expect(saved.row).toMatchObject({ status: "running", version: 1, reactorId: a.reactorId,
      feedstockDraws: [{ storageLocationId: a.binId, wetMassKg: 1200 }] });
    for (const field of ["organizationId", "feedstocks", "operatorName", "stockPostingSequence"]) expect(saved.row).not.toHaveProperty(field);
    expect(await rows()).toMatchObject([{ id: saved.row.id, feedstockWetMassKg: 1200 }]);
    expect(await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, a.ctx.organizationId)))
      .toMatchObject([{ productionRunId: saved.row.id, storageLocationId: a.binId, wetMassKg: 1200 }]);
    expect(await binWetStock(a)).toBe(3000);
    for (const identifier of [saved.row.id, saved.row.code]) {
      const response = await GET(request("GET", `/${identifier}`), params(identifier));
      expect(response.headers.get("etag")).toBe(saved.etag);
      expect(await response.json()).toEqual(saved.body);
    }
  });

  it("resolves local date/time in a non-UTC facility and refuses offset-less instants", async () => {
    await db.update(facilities).set({ timezone: "Africa/Nairobi" }).where(and(eq(facilities.id, a.facilityId), eq(facilities.organizationId, a.ctx.organizationId)));
    const saved = await create({ ...productionRunInput(a), startTime: { date: "2026-10-06", time: "13:00" } });
    expect(saved.row).toMatchObject({ startTime: "2026-10-06T10:00:00.000Z" });
    expect((await rows())[0].startTime.toISOString()).toBe("2026-10-06T10:00:00.000Z");
    const refused = await problem(await POST(request("POST", "", { ...productionRunInput(a), startTime: "2026-10-06T13:00:00" }, { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(refused.errors).toContainEqual(expect.objectContaining({ pointer: "/startTime" }));
    expect(await rows()).toHaveLength(1);
  });

  it("starts without inventing a draw when no mass was supplied", async () => {
    const saved = await create(productionRunInput(a, false));
    expect(saved.row).toMatchObject({ status: "running", feedstockDraws: [] });
    expect(await binWetStock(a)).toBe(4200);
    expect(await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, a.ctx.organizationId))).toHaveLength(0);
  });

  it("fails through status PATCH while retaining consumed stock", async () => {
    const saved = await create();
    const response = await patch(saved.row.id, { status: "failed", endTime: "2026-10-06T11:00:00Z" }, saved.etag);
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("failed");
    expect(await rows()).toMatchObject([{ status: "failed" }]);
    expect(await binWetStock(a)).toBe(3000);
  });

  it("completes through status PATCH with output and preserves omitted draws", async () => {
    const saved = await create();
    const response = await patch(saved.row.id, { status: "complete", endTime: "2026-10-06T11:00:00Z",
      biocharOutputKg: 200, biocharMoisturePercent: 2, biocharStorageLocationId: a.outputBinId }, saved.etag);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2.2"');
    expect((await response.json()).data).toMatchObject({ status: "complete", biocharOutputKg: 200, biocharStorageLocationId: a.outputBinId, feedstockDraws: saved.row.feedstockDraws });
    expect(await rows()).toMatchObject([{ status: "complete", biocharOutputKg: 200, version: 2 }]);
    expect(await binWetStock(a)).toBe(3000);
  });

  it("cancels through PATCH and returns drawn stock", async () => {
    const saved = await create();
    const response = await patch(saved.row.id, { status: "cancelled", cancellationReason: "Reactor stopped", endTime: "2026-10-06T11:00:00Z" }, saved.etag);
    expect(response.status).toBe(200);
    expect(await rows()).toMatchObject([{ status: "cancelled", cancellationReason: "Reactor stopped" }]);
    expect(await binWetStock(a)).toBe(4200);
  });

  it("deletes with a strong precondition, returns 204 and restores stock", async () => {
    const saved = await create();
    const response = await DELETE(request("DELETE", `/${saved.row.id}`, undefined, { "if-match": saved.etag }), params(saved.row.id));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await rows()).toHaveLength(0);
    expect(await binWetStock(a)).toBe(4200);
    expect(await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, a.ctx.organizationId))).toHaveLength(0);
  });

  it("previews create, update and delete with stockEffects and no persisted change", async () => {
    const preview = await POST(request("POST", "?dryRun=true", productionRunInput(a)));
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    expect((await preview.json()).stockEffects).toMatchObject([{ storageLocationId: a.binId, before: { wetKg: 4200 }, after: { wetKg: 3000 }, delta: { wetKg: -1200 } }]);
    expect(await rows()).toHaveLength(0);
    expect(await binWetStock(a)).toBe(4200);
    const saved = await create();
    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await (method === "PATCH" ? PATCH : DELETE)(request(method, `/${saved.row.id}?dryRun=true`,
        method === "PATCH" ? { feedstockDraws: [{ storageLocationId: a.binId, wetMassKg: 600 }] } : undefined,
        { "if-match": saved.etag }), params(saved.row.id));
      expect(response.status).toBe(200);
      expect(response.headers.get("dry-run")).toBe("true");
      expect(response.headers.has("etag")).toBe(false);
      expect((await response.json()).stockEffects).toMatchObject([{ storageLocationId: a.binId, before: { wetKg: 3000 }, after: { wetKg: method === "PATCH" ? 3600 : 4200 } }]);
      expect(await rows()).toMatchObject([{ version: 1, feedstockWetMassKg: 1200 }]);
      expect(await binWetStock(a)).toBe(3000);
    }
  });

  it("requires If-Match and returns the current representation on stale version or revision", async () => {
    const saved = await create();
    await problem(await PATCH(request("PATCH", `/${saved.row.id}`, {}), params(saved.row.id)), 428, "precondition_required");
    const changed = await patch(saved.row.id, { electricityKwh: 0 }, saved.etag);
    expect(changed.status).toBe(200);
    const current = (await changed.json()).data;
    for (const tag of [saved.etag, '"2.99"']) {
      for (const method of ["PATCH", "DELETE"] as const) {
        const response = await (method === "PATCH" ? PATCH : DELETE)(request(method, `/${saved.row.id}`, method === "PATCH" ? {} : undefined, { "if-match": tag }), params(saved.row.id));
        expect((await problem(response, 412, "stale_version")).current).toEqual(current);
      }
    }
  });

  it("reports overlapping runs with the blocking conflict and rejects unknown fields", async () => {
    const saved = await create();
    const overlap = await problem(await POST(request("POST", "", { ...productionRunInput(a), startTime: "2026-10-06T10:30:00Z" }, { "idempotency-key": randomUUID() })), 409, "conflict");
    expect(overlap.conflict).toMatchObject({ id: saved.row.id, code: saved.row.code });
    for (const body of [{ ...productionRunInput(a), feedstockWetMassKg: 1200 }, { ...productionRunInput(a), feedstockDraws: [{ storageLocationId: a.binId, wetMassKg: 1200, mystery: true }] }]) {
      await problem(await POST(request("POST", "", body, { "idempotency-key": randomUUID() })), 422, "validation_failed");
    }
    expect(await rows()).toHaveLength(1);
  });

  it("lists newest first with facility, reactor, status and code filters and bound cursors", async () => {
    const first = await create();
    const second = await create({ ...productionRunInput(a, false), status: "cancelled", cancellationReason: "Not started", endTime: "2026-10-06T11:00:00Z" });
    const firstPage = await (await LIST(request("GET", "?limit=1"))).json();
    expect(firstPage.data.map((row: { id: string }) => row.id)).toEqual([second.row.id]);
    const nextPage = await (await LIST(request("GET", `?limit=1&cursor=${firstPage.nextCursor}`))).json();
    expect(nextPage.data.map((row: { id: string }) => row.id)).toEqual([first.row.id]);
    expect(nextPage.nextCursor).toBeNull();
    for (const query of [`facilityId=${a.facilityId}&reactorId=${a.reactorId}&status=running`, `code=${first.row.code}`, `q=${first.row.code.toLowerCase()}`]) {
      expect((await (await LIST(request("GET", `?${query}`))).json()).data).toEqual([first.row]);
    }
    for (const q of ["%", "_", "\\"]) {
      expect((await (await LIST(request("GET", `?q=${encodeURIComponent(q)}`))).json()).data).toEqual([]);
    }
    await problem(await LIST(request("GET", `?status=running&cursor=${firstPage.nextCursor}`)), 400, "invalid_cursor");
    await problem(await LIST(request("GET", `?cursor=${firstPage.nextCursor}`, undefined, {}, b)), 400, "invalid_cursor");
  });

  it("refuses missing and foreign run, reactor and bin references without leaking data", async () => {
    const foreign = await create(productionRunInput(b), b);
    for (const id of [foreign.row.id, randomUUID()]) {
      const missing = await problem(await GET(request("GET", `/${id}`), params(id)), 404, "not_found");
      expect(missing.errors).toContainEqual(expect.objectContaining({ pointer: "/productionRunId" }));
      await problem(await patch(id, {}, '"1.2"'), 404, "not_found");
      await problem(await DELETE(request("DELETE", `/${id}`, undefined, { "if-match": '"1.2"' }), params(id)), 404, "not_found");
      expect(JSON.stringify(missing)).not.toContain(foreign.row.code);
    }
    for (const [field, id, pointer] of [["reactorId", b.reactorId, "/reactorId"], ["reactorId", randomUUID(), "/reactorId"], ["storageLocationId", b.binId, "/feedstockDraws/0/storageLocationId"], ["storageLocationId", randomUUID(), "/feedstockDraws/0/storageLocationId"]]) {
      const body = field === "reactorId" ? { ...productionRunInput(a), reactorId: id }
        : { ...productionRunInput(a), feedstockDraws: [{ storageLocationId: id, wetMassKg: 1200 }] };
      const refusal = await problem(await POST(request("POST", "", body, { "idempotency-key": randomUUID() })), 404, "not_found");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer }));
    }
    for (const query of [`facilityId=${b.facilityId}`, `reactorId=${b.reactorId}`]) await problem(await LIST(request("GET", `?${query}`)), 404, "not_found");
    expect((await (await LIST(request("GET", `?code=${foreign.row.code}`))).json()).data).toEqual([]);
    expect(await rows()).toHaveLength(0);
    expect(await binWetStock(a)).toBe(4200);
    expect(await binWetStock(b)).toBe(3000);
    const saved = await create();
    for (const body of [{ reactorId: b.reactorId }, { feedstockDraws: [{ storageLocationId: b.binId, wetMassKg: 1200 }] }, { biocharStorageLocationId: b.outputBinId }]) {
      await problem(await patch(saved.row.id, body, saved.etag), 404, "not_found");
    }
  });

  it("refuses each route without its scope, including delete with only write permission", async () => {
    const saved = await create();
    const scoped = { ...a, key: (await createApiKey(a.ctx, { name: "No production scopes", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key };
    for (const handler of [() => LIST(request("GET", "", undefined, {}, scoped)), () => GET(request("GET", `/${saved.row.id}`, undefined, {}, scoped), params(saved.row.id)),
      () => POST(request("POST", "", productionRunInput(a), { "idempotency-key": randomUUID() }, scoped)),
      () => patch(saved.row.id, {}, saved.etag, "", scoped), () => DELETE(request("DELETE", `/${saved.row.id}`, undefined, { "if-match": saved.etag }, scoped), params(saved.row.id))]) {
      await problem(await handler(), 403, "missing_scope");
    }
    const writer = { ...a, key: (await createApiKey(a.ctx, { name: "Run writer", scopes: ["production-runs:read", "production-runs:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key };
    await problem(await DELETE(request("DELETE", `/${saved.row.id}`, undefined, { "if-match": saved.etag }, writer), params(saved.row.id)), 403, "missing_scope");
    expect(await rows()).toHaveLength(1);
  });
});

describe("production run review regressions", { timeout: TIMEOUT_MS }, () => {
  it("refuses a failed create with the status pointer", async () => {
    const refusal = await problem(await POST(request("POST", "", { ...productionRunInput(a), status: "failed" },
      { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/status" }));
    expect(await rows()).toHaveLength(0);
  });

  it.each([{ biocharOutputKg: 300 }, { feedingRateKgHr: 100 }])("refuses edits to terminal runs without feedstock: %j", async (body) => {
    const saved = await create({ ...productionRunInput(a), feedstockDraws: [], feedstockMoisturePercent: null });
    await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-10-06T11:00:00Z"),
      biocharOutputKg: 200, biocharMoisturePercent: 2 }).where(eq(productionRuns.id, saved.row.id));
    const refusal = await problem(await patch(saved.row.id, body, saved.etag), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockDraws" }));
    expect(await rows()).toMatchObject([{ version: 1, biocharOutputKg: 200 }]);
  });

  it("rejects terminal create without draws or moisture using the form field messages", async () => {
    const body = { ...productionRunInput(a), status: "complete", endTime: "2026-10-06T11:00:00Z",
      biocharOutputKg: 200, biocharMoisturePercent: 2, feedstockMoisturePercent: null, feedstockDraws: [] };
    const refusal = await problem(await POST(request("POST", "", body, { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(refusal.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointer: "/feedstockDraws", detail: "Add at least one feedstock source." }),
      expect.objectContaining({ pointer: "/feedstockMoisturePercent", detail: "Enter feedstock moisture." }),
    ]));
    const moistureOnly = await problem(await POST(request("POST", "", { ...body, feedstockDraws: productionRunInput(a).feedstockDraws },
      { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(moistureOnly.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockMoisturePercent", detail: "Enter feedstock moisture." }));
    const drawsOnly = await problem(await POST(request("POST", "", { ...body, feedstockMoisturePercent: 20 },
      { "idempotency-key": randomUUID() })), 422, "validation_failed");
    expect(drawsOnly.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockDraws", detail: "Add at least one feedstock source." }));
    expect(await rows()).toHaveLength(0);
    expect(await binWetStock(a)).toBe(4200);
  });

  it.each(["complete", "failed"])("requires moisture and draws when PATCH makes a run %s", async (status) => {
    const saved = await create({ ...productionRunInput(a), feedstockMoisturePercent: null });
    const terminal = { status, endTime: "2026-10-06T11:00:00Z", biocharOutputKg: 200, biocharMoisturePercent: 2 };
    const refusal = await problem(await patch(saved.row.id, terminal, saved.etag), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockMoisturePercent", detail: "Enter feedstock moisture." }));
    const noDraws = await problem(await patch(saved.row.id, { ...terminal, feedstockMoisturePercent: 20, feedstockDraws: [] }, saved.etag), 422, "validation_failed");
    expect(noDraws.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockDraws", detail: "Add at least one feedstock source." }));
    expect(await rows()).toMatchObject([{ status: "running", version: 1 }]);
    const completed = await patch(saved.row.id, { ...terminal, feedstockMoisturePercent: 20 }, saved.etag);
    expect(completed.status).toBe(200);
    const cleared = await problem(await patch(saved.row.id, { feedstockMoisturePercent: null }, completed.headers.get("etag")!), 422, "validation_failed");
    expect(cleared.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockMoisturePercent" }));
  });

  it("keeps the submitted index for a missing lower-id draw on create and PATCH", async () => {
    const feedstockDraws = [{ storageLocationId: a.binId, wetMassKg: 100 },
      { storageLocationId: "00000000-0000-4000-8000-000000000001", wetMassKg: 100 }];
    const refused = await problem(await POST(request("POST", "", { ...productionRunInput(a), feedstockDraws },
      { "idempotency-key": randomUUID() })), 404, "not_found");
    expect(refused.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockDraws/1/storageLocationId" }));
    const saved = await create();
    const patched = await problem(await patch(saved.row.id, { feedstockDraws }, saved.etag), 404, "not_found");
    expect(patched.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockDraws/1/storageLocationId" }));
  });

  it("distinguishes inaccessible output bins from wrong-type or wrong-facility bins", async () => {
    for (const biocharStorageLocationId of [b.outputBinId, randomUUID()]) {
      const refusal = await problem(await POST(request("POST", "", { ...productionRunInput(a), biocharStorageLocationId },
        { "idempotency-key": randomUUID() })), 404, "not_found");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/biocharStorageLocationId" }));
    }
    const saved = await create();
    for (const biocharStorageLocationId of [b.outputBinId, randomUUID()]) {
      const refusal = await problem(await patch(saved.row.id, { biocharStorageLocationId }, saved.etag), 404, "not_found");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/biocharStorageLocationId" }));
    }
    const [facility] = await db.insert(facilities).values({ organizationId: a.ctx.organizationId, code: "OTHER", name: "Other facility" }).returning();
    const [bin] = await db.insert(storageLocations).values({ organizationId: a.ctx.organizationId, facilityId: facility.id,
      code: "OTHER-OUTPUT", name: "Other output", type: "biochar_bin" }).returning();
    for (const biocharStorageLocationId of [a.binId, bin.id]) {
      await problem(await patch(saved.row.id, { biocharStorageLocationId }, saved.etag), 422, "validation_failed");
      await problem(await POST(request("POST", "", { ...productionRunInput(a), status: "draft", startTime: "2026-10-05T10:00:00Z", endTime: "2026-10-05T11:00:00Z", biocharStorageLocationId },
        { "idempotency-key": randomUUID() })), 422, "validation_failed");
    }
    expect(await rows()).toMatchObject([{ id: saved.row.id, version: 1 }]);
  });
});
