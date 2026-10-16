import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { guardApiMethod } from "@/lib/api/method-not-allowed";
import * as boundary from "@/app/api/v1/applications/[idOrCode]/boundary/route";
/** Real REST handlers, credentials and database. Run by explicit path only. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { applications, activityEvents, deliveries, documents, productionProcesses, creditBatches, creditBatchApplications, members, apiKeys } from "@/db/schema";
import { saveApplicationOutputAllocations } from "@/data-access/delivery-allocation-provenance";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import * as collection from "@/app/api/v1/applications/route";
import * as detail from "@/app/api/v1/applications/[idOrCode]/route";
import { createApiOrderReadFixture, removeApiOrderReadFixture, readParams, readRequest } from "./helpers/api-order-read-fixture";
import { createMutationFixture, cleanupMutationFixture } from "./helpers/application-write-fixture";
import { deliveryProblem as problem } from "./helpers/api-delivery-write-fixture";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
const TIMEOUT = 60_000;
let f: Awaited<ReturnType<typeof createApiOrderReadFixture>>;
let chain: Awaited<ReturnType<typeof createMutationFixture>>;
let key: string;
let chainTag: string;
beforeEach(async () => {
  f = await createApiOrderReadFixture();
  chainTag = randomUUID();
  chain = await createMutationFixture(chainTag, f.ctx.organizationId);
  key = (await createApiKey(f.ctx, { name: "Application writes", scopes: ["applications:read", "applications:write", "applications:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
}, TIMEOUT);
afterEach(async () => {
  if (chain) { chain.applicationIds = (await rows()).map(row => row.id); await cleanupMutationFixture(chain); }
  if (f) await removeApiOrderReadFixture(f);
}, TIMEOUT);
const rows = () => db.select().from(applications).where(eq(applications.organizationId, f.ctx.organizationId));
const input = (extra: object = {}) => ({ deliveryId: chain.deliveryIds[0], applicationDate: "2025-07-08", appliedWetMassKg: 4001, fieldSizeHa: 3, ...extra });
function request(method: string, path: string, body: unknown, headers: Record<string, string> = {}, credential = key) {
  return new Request(`http://localhost:3100/api/v1/applications${path}`, { method, headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const post = (body: unknown = input(), requestKey: string | null = randomUUID(), query = "") => collection.POST(request("POST", query, body, requestKey ? { "idempotency-key": requestKey } : {}));
const patch = (id: string, body: unknown, tag?: string, requestKey?: string, query = "") => detail.PATCH(request("PATCH", `/${id}${query}`, body, { ...(tag ? { "if-match": tag } : {}), ...(requestKey ? { "idempotency-key": requestKey } : {}) }), readParams(id));
const remove = (id: string, tag?: string, query = "", credential = key, requestKey?: string) => detail.DELETE(request("DELETE", `/${id}${query}`, undefined, { ...(tag ? { "if-match": tag } : {}), ...(requestKey ? { "idempotency-key": requestKey } : {}) }, credential), readParams(id));
const read = (id: string) => detail.GET(readRequest(`/applications/${id}`, key), readParams(id));
async function saved(extra: object = {}) { const response = await post(input(extra)); expect(response.status).toBe(201); return { ...(await response.json()), tag: response.headers.get("etag")! }; }
it("creates once in kg, returns GET's ETag, allocations, balance, warnings and audit attribution", async () => {
  const response = await post(); expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.data).toMatchObject({ appliedWetMassKg: 4001, dryBiocharKg: 3200.8 });
  expect(body.deliveryBalance).toEqual({ remainingWetMassKgBefore: 5000, remainingWetMassKgAfter: 999 });
  expect(body.allocations).toMatchObject([{ wetMassKg: 4001, dryBiocharKg: 3200.8 }]);
  expect(body.warnings).toContain(`GPS copied from customer location Application Mutation Location ${chainTag}.`);
  expect(response.headers.get("location")).toBe(`/api/v1/applications/${body.data.id}`);
  expect((await read(body.data.id)).headers.get("etag")).toBe(response.headers.get("etag"));
  expect(await rows()).toMatchObject([{ biocharAppliedTons: 4.001 }]);
  const audits = await db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), eq(activityEvents.organizationId, f.ctx.organizationId)));
  expect(new Set(audits.map(row => row.requestId)).size).toBe(1);
  expect(audits).toContainEqual(expect.objectContaining({ entityId: body.data.id, operationId: "record_application", source: "rest" }));
  const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
  expect(events).toContainEqual(expect.objectContaining({ entityId: body.data.id, source: "rest", credentialId: audits[0].credentialId }));
}, TIMEOUT);
it("requires keys even for previews; dry runs leave no application, audit or activity", async () => {
  for (const query of ["", "?dryRun=true"]) await problem(await post(input(), null, query), 400, "idempotency_key_required");
  const requestKey = randomUUID();
  const preview = await post(input(), requestKey, "?dryRun=true"); expect(preview.status).toBe(200);
  expect(preview.headers.get("dry-run")).toBe("true"); expect(preview.headers.has("etag")).toBe(false);
  const body = await preview.json(); expect(body.allocations).toHaveLength(1); expect(body.deliveryBalance.remainingWetMassKgAfter).toBe(999);
  expect(await rows()).toEqual([]);
  expect(await db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), eq(activityEvents.organizationId, f.ctx.organizationId)))).toEqual([]);
  expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual([]);
  expect((await post(input(), requestKey)).status).toBe(201);
}, TIMEOUT);
it("replays the stored outcome and refuses reuse with changed client facts", async () => {
  const requestKey = randomUUID(); const first = await post(input(), requestKey); const text = await first.text();
  const replay = await post(input(), requestKey);
  expect(replay.headers.get("idempotent-replayed")).toBe("true"); expect(await replay.text()).toBe(text);
  await problem(await post(input({ fieldSizeHa: 4 }), requestKey), 422, "idempotency_key_reused");
  expect(await rows()).toHaveLength(1);
}, TIMEOUT);
it.each(["unknown", "code", "status", "biocharAppliedTons", "dryBiocharKg", "source"])("rejects strict create field %s", async field => {
  await problem(await post(input({ [field]: 1 })), 422, "validation_failed", `/${field}`);
  expect(await rows()).toEqual([]);
}, TIMEOUT);
// Fuzz found 5e-324 reaching the float4 column as a 500.
it.each([5e-324, 0.00009, 1e300, 1_000_001])("refuses field size %s outside the stored range at /fieldSizeHa", async fieldSizeHa => {
  await problem(await post(input({ fieldSizeHa })), 422, "validation_failed", "/fieldSizeHa");
}, TIMEOUT);
it("preserves typed capacity, date, reference, archive and unavailable method refusals", async () => {
  const capacity = await problem(await post(input({ appliedWetMassKg: 5000.001 })), 409, "conflict", "/appliedWetMassKg");
  expect(capacity.errors).toContainEqual(expect.objectContaining({ meta: { measure: "delivery_remaining_wet", availableWetKg: 5000, requestedWetKg: 5000.001, unit: "kg" } }));
  for (const applicationDate of ["2025-07-04", "2099-01-01"]) await problem(await post(input({ applicationDate })), 422, "validation_failed", "/applicationDate");
  await problem(await post(input({ deliveryId: randomUUID() })), 404, "not_found", "/deliveryId");
  await problem(await post(input({ evidenceMethod: "visual" })), 422, "validation_failed", "/evidenceMethod");
  await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, chain.deliveryIds[0]));
  await problem(await post(), 404, "not_found", "/deliveryId");
}, TIMEOUT);
const polygon = { type: "Polygon", coordinates: [[[37.42, -3.25], [37.43, -3.25], [37.43, -3.24], [37.42, -3.25]]] };
const feature = { type: "Feature", properties: {}, geometry: polygon };
it.each([polygon, feature, { type: "FeatureCollection", features: [feature] }])("normalizes raw $type in the operation and replays the same raw body", async gisBoundary => {
  const requestKey = randomUUID(); const body = input({ gisBoundary, evidenceMethod: "boundary" });
  const first = await post(body, requestKey); expect(first.status).toBe(201); const text = await first.text();
  const replay = await post(body, requestKey); expect(replay.headers.get("idempotent-replayed")).toBe("true"); expect(await replay.text()).toBe(text);
  const [audit] = await db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), eq(activityEvents.organizationId, f.ctx.organizationId)));
  expect(audit.changedFields).toContain("gisBoundary");
  const [row] = await rows(); expect(row.gisBoundary).toMatchObject({ source: "api", fileName: null, collection: { type: "FeatureCollection" } });
  const response = await boundary.GET(readRequest(`/applications/${row.id}/boundary`, key), readParams(row.id));
  expect(response.status).toBe(200); expect((await response.json()).data.collection).toEqual(row.gisBoundary!.collection);
}, TIMEOUT);
it("rejects invalid geometry, projected CRS and envelope input at the boundary pointer", async () => {
  for (const gisBoundary of [{ type: "Polygon", coordinates: [] }, { ...polygon, crs: { type: "name", properties: { name: "EPSG:3857" } } }, { source: "paste", collection: {} }]) {
    await problem(await post(input({ gisBoundary })), 422, "validation_failed", "/gisBoundary");
  }
  await problem(await post(input({ cropType: "x".repeat(API_BODY_MAX_BYTES) })), 413, "payload_too_large");
}, TIMEOUT);
it("requires a boundary for boundary evidence on create and on the merged PATCH state", async () => {
  await problem(await post(input({ evidenceMethod: "boundary" })), 422, "validation_failed", "/gisBoundary");
  const first = await saved({ evidenceMethod: "boundary", gisBoundary: polygon });
  await problem(await patch(first.data.id, { gisBoundary: null }, first.tag), 422, "validation_failed", "/gisBoundary");
  const cleared = await patch(first.data.id, { evidenceMethod: "location", gpsLatitude: 1, gpsLongitude: 2, gisBoundary: null }, first.tag);
  expect(cleared.status).toBe(200); expect((await cleared.json()).data.gisBoundary).toBeNull();
}, TIMEOUT);
it("requires If-Match, returns current on stale tags and refuses code paths", async () => {
  const first = await saved();
  await problem(await patch(first.data.id, {}), 428, "precondition_required");
  await problem(await patch(first.data.code, {}, first.tag), 404, "not_found");
  const changed = await patch(first.data.id, { cropType: "Maize" }, first.tag); expect(changed.status).toBe(200);
  const current = (await changed.json()).data;
  for (const tag of [first.tag, `"${current.version}.99"`]) expect((await problem(await patch(first.data.id, {}, tag), 412, "stale_version")).current).toEqual(current);
  expect(changed.headers.get("etag")).toBe((await read(first.data.id)).headers.get("etag"));
  const cleared = await patch(first.data.id, { cropType: null }, changed.headers.get("etag")!);
  expect((await cleared.json()).data.cropType).toBeNull();
}, TIMEOUT);
it("refreshes shares and balances for a mass edit and a delivery repoint without copying site defaults", async () => {
  let current = await saved({ cropType: "Maize" });
  const mass = await patch(current.data.id, { appliedWetMassKg: 1500 }, current.tag); expect(mass.status).toBe(200);
  current = { ...(await mass.json()), tag: mass.headers.get("etag")! };
  expect(current.allocations).toMatchObject([{ wetMassKg: 1500, dryBiocharKg: 1200 }]);
  const moved = await patch(current.data.id, { deliveryId: chain.deliveryIds[1], soilTemperatureC: null, soilTemperatureSource: null }, current.tag);
  expect(moved.status).toBe(200); const body = await moved.json();
  expect(body.allocations).toMatchObject([{ wetMassKg: 1500, dryBiocharKg: 1350 }]);
  expect(body.deliveryBalance).toEqual({ remainingWetMassKgBefore: 3000, remainingWetMassKgAfter: 1500 });
  expect(body.data).toMatchObject({ cropType: "Maize", soilTemperatureC: null, soilTemperatureSource: null });
  expect(body.warnings ?? []).not.toContainEqual(expect.stringContaining("copied"));
  await problem(await patch(body.data.id, { gpsLatitude: null, gpsLongitude: null }, moved.headers.get("etag")!), 422, "validation_failed", "/gpsLatitude");
  await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, chain.deliveryIds[1]));
  await problem(await patch(body.data.id, {}, moved.headers.get("etag")!), 404, "not_found", "/deliveryId");
}, TIMEOUT);
it("binds PATCH keys to the target and If-Match and replays before stale checks", async () => {
  const first = await saved({ appliedWetMassKg: 100 }); const second = await saved({ appliedWetMassKg: 100 });
  const requestKey = randomUUID(); const body = { cropType: "Maize" };
  const changed = await patch(first.data.id, body, first.tag, requestKey); expect(changed.status).toBe(200); const original = await changed.text();
  const replay = await patch(first.data.id, body, first.tag, requestKey); expect(replay.headers.get("idempotent-replayed")).toBe("true"); expect(await replay.text()).toBe(original);
  await problem(await patch(second.data.id, body, second.tag, requestKey), 422, "idempotency_key_reused");
  await problem(await patch(first.data.id, body, changed.headers.get("etag")!, requestKey), 422, "idempotency_key_reused");
  const preview = await patch(first.data.id, { cropType: "Preview" }, changed.headers.get("etag")!, randomUUID(), "?dryRun=true");
  expect(preview.status).toBe(200); expect(preview.headers.get("dry-run")).toBe("true");
  expect((await (await read(first.data.id)).json()).data.cropType).toBe("Maize");
}, TIMEOUT);
it("requires delete scope and If-Match, previews without deletion, retires documents and replays after deletion", async () => {
  const first = await saved();
  const writeKey = (await createApiKey(f.ctx, { name: "Write only", scopes: ["applications:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  await problem(await remove(first.data.id, first.tag, "", writeKey), 403, "missing_scope");
  await problem(await remove(first.data.id), 428, "precondition_required");
  await problem(await remove(first.data.code, first.tag), 404, "not_found");
  expect((await problem(await remove(first.data.id, '"2.1"'), 412, "stale_version")).current).toEqual(first.data);
  const [doc] = await db.insert(documents).values({ organizationId: f.ctx.organizationId, entityType: "application", entityId: first.data.id, documentType: "photo", fileName: "evidence.jpg", fileUrl: "https://example.test/evidence", createdBy: f.ctx.userId }).returning();
  const preview = await remove(first.data.id, first.tag, "?dryRun=true"); expect(preview.status).toBe(200); expect(preview.headers.get("dry-run")).toBe("true"); expect((await read(first.data.id)).status).toBe(200);
  const emptyPreview = await detail.DELETE(request("DELETE", `/${first.data.id}?dryRun=true`, {}, { "if-match": first.tag }), readParams(first.data.id));
  expect(emptyPreview.status).toBe(200);
  expect(await db.select().from(documents).where(eq(documents.id, doc.id))).toHaveLength(1);
  const requestKey = randomUUID(); const deleted = await remove(first.data.id, first.tag, "", key, requestKey); expect(deleted.status).toBe(204); expect(await deleted.text()).toBe("");
  expect((await read(first.data.id)).status).toBe(404);
  expect(await db.select().from(documents).where(eq(documents.id, doc.id))).toEqual([]);
  const replay = await remove(first.data.id, first.tag, "", key, requestKey); expect(replay.status).toBe(204); expect(replay.headers.get("idempotent-replayed")).toBe("true");
}, TIMEOUT);
it("checks authorization before target existence and keeps boundary writes read only", async () => {
  const id = randomUUID();
  await problem(await collection.POST(request("POST", "", input({ deliveryId: id }), { "idempotency-key": randomUUID() }, f.missingScopeKey)), 403, "missing_scope");
  await problem(await detail.PATCH(request("PATCH", `/${id}`, {}, { "if-match": '"1.1"' }, f.missingScopeKey), readParams(id)), 403, "missing_scope");
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await guardApiMethod(request(method, `/${id}/boundary`, {})); expect(response?.status).toBe(405); expect(response?.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  }
  for (const path of ["", `/${id}`, `/${id}/boundary`]) for (const method of ["HEAD", "OPTIONS"]) expect(await guardApiMethod(request(method, path, undefined))).toBeNull();
}, TIMEOUT);
it("hides a foreign delivery UUID with the delivery pointer", async () => {
  const other = await createApiOrderReadFixture();
  const foreign = await createMutationFixture(randomUUID(), other.ctx.organizationId);
  try {
    await problem(await post(input({ deliveryId: foreign.deliveryIds[0] })), 404, "not_found", "/deliveryId");
    expect(await rows()).toEqual([]);
  } finally { await cleanupMutationFixture(foreign); await removeApiOrderReadFixture(other); }
}, TIMEOUT);
it("refuses verified batch DELETE with certification_locked", async () => {
  const first = await saved();
  const organizationId = f.ctx.organizationId;
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: chain.facilityId, feedstockTypeId: f.ingredientType.id }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId, facilityId: chain.facilityId, feedstockTypeId: f.ingredientType.id,
    productionProcessId: process.id, code: `CB-API-${randomUUID()}`, startDate: "2025-07-01", endDate: "2025-07-31", status: "verified" }).returning();
  try {
    await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: batch.id, applicationId: first.data.id, allocatedWetMassKg: 4001, allocatedDryMassKg: 3200.8 });
    await problem(await remove(first.data.id, first.tag), 409, "certification_locked");
    expect((await read(first.data.id)).status).toBe(200);
  } finally {
    await db.delete(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, batch.id));
    await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
    await db.delete(productionProcesses).where(eq(productionProcesses.id, process.id));
  }
}, TIMEOUT);

it("refuses submitted lineage metadata PATCH and DELETE with certification_locked", async () => {
  await ensureTestOrg();
  const ctx = makeTestOrgContext(f.ctx.userId);
  const memberId = randomUUID();
  await db.insert(members).values({ id: memberId, organizationId: ctx.organizationId, userId: ctx.userId, role: "owner" });
  const credential = await createApiKey(ctx, { name: "Submitted application writes", scopes: ["applications:read", "applications:write", "applications:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  const lineage = await createLineageFixture("removal");
  const previousKey = key;
  key = credential.key;
  try {
    const current = await read(lineage.applicationId);
    expect(current.status).toBe(200);
    const tag = current.headers.get("etag")!;
    await problem(await patch(lineage.applicationId, { cropType: "Maize" }, tag), 409, "certification_locked");
    await problem(await remove(lineage.applicationId, tag), 409, "certification_locked");
  } finally {
    key = previousKey;
    await cleanupLineageFixture(lineage);
    await db.delete(apiKeys).where(eq(apiKeys.id, credential.id));
    await db.delete(members).where(eq(members.id, memberId));
  }
}, TIMEOUT);

it("hides foreign applications for PATCH and DELETE with current and stale tags", async () => {
  const first = await saved();
  const updated = await patch(first.data.id, { cropType: "Original" }, first.tag);
  expect(updated.status).toBe(200);
  const other = await createApiOrderReadFixture();
  const credential = await createApiKey(other.ctx, { name: "Foreign application writes", scopes: ["applications:write", "applications:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  try {
    for (const tag of [updated.headers.get("etag")!, first.tag]) {
      const changed = await detail.PATCH(request("PATCH", `/${first.data.id}`, { cropType: "Maize" }, { "if-match": tag }, credential.key), readParams(first.data.id));
      expect(await problem(changed, 404, "not_found")).not.toHaveProperty("current");
      expect(await problem(await remove(first.data.id, tag, "", credential.key), 404, "not_found")).not.toHaveProperty("current");
    }
  } finally { await removeApiOrderReadFixture(other); }
}, TIMEOUT);

it("refuses reuse of an idempotency key with changed raw GeoJSON", async () => {
  const requestKey = randomUUID();
  expect((await post(input({ gisBoundary: polygon }), requestKey)).status).toBe(201);
  const changed = { ...polygon, coordinates: polygon.coordinates.map(ring => ring.map(([lon, lat]) => [lon + 0.01, lat])) };
  await problem(await post(input({ gisBoundary: changed }), requestKey), 422, "idempotency_key_reused");
  expect(await rows()).toHaveLength(1);
}, TIMEOUT);

it("PATCH and DELETE dry runs leave audit and activity rows unchanged", async () => {
  const first = await saved();
  const audits = () => db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), eq(activityEvents.organizationId, f.ctx.organizationId)));
  const activities = () => db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
  const beforeAudits = await audits();
  const beforeActivities = await activities();
  expect((await patch(first.data.id, { cropType: "Preview" }, first.tag, randomUUID(), "?dryRun=true")).status).toBe(200);
  expect(await audits()).toEqual(beforeAudits);
  expect(await activities()).toEqual(beforeActivities);
  expect((await remove(first.data.id, first.tag, "?dryRun=true")).status).toBe(200);
  expect(await audits()).toEqual(beforeAudits);
  expect(await activities()).toEqual(beforeActivities);
  expect((await read(first.data.id)).headers.get("etag")).toBe(first.tag);
}, TIMEOUT);

it("refuses switching to visual but allows crop edits on legacy visual rows", async () => {
  const first = await saved();
  await problem(await patch(first.data.id, { evidenceMethod: "visual" }, first.tag), 422, "validation_failed", "/evidenceMethod");
  await db.update(applications).set({ evidenceMethod: "visual", gpsLatitude: null, gpsLongitude: null }).where(eq(applications.id, first.data.id));
  const response = await patch(first.data.id, { cropType: "Maize" }, first.tag);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ cropType: "Maize", evidenceMethod: "visual" });
}, TIMEOUT);

it("allows crop edits on a stored future application date but validates supplied dates", async () => {
  const [legacy] = await db.insert(applications).values({
    organizationId: f.ctx.organizationId, deliveryId: chain.deliveryIds[0], code: `AP-${randomUUID()}`,
    applicationDate: new Date("2099-01-01"), biocharAppliedTons: 0.1, biocharAppliedDryTons: 0.08,
    fieldSizeHa: 3, evidenceMethod: "location", gpsLatitude: 1, gpsLongitude: 2,
  }).returning();
  await db.transaction(tx => saveApplicationOutputAllocations(f.ctx, tx, legacy));
  const current = await read(legacy.id);
  const response = await patch(legacy.id, { cropType: "Maize" }, current.headers.get("etag")!);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ cropType: "Maize", applicationDate: "2099-01-01" });
  for (const applicationDate of ["2099-01-01", "2025-07-04"]) {
    await problem(await patch(legacy.id, { applicationDate }, response.headers.get("etag")!), 422, "validation_failed", "/applicationDate");
  }
}, TIMEOUT);
