/** Stock-moving delivery REST contracts against the worktree test database. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { apiRateLimitBuckets, facilities, orders, storageLocations } from "@/db/schema";
import { API_RATE_LIMITS } from "@/config/api-rate-limits";
import { resolveApiContext } from "@/lib/auth/api-context";
import { updateDeliveryFn } from "@/fn/deliveries";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { certifyOutputLineage, cleanupCertifiedOutputLineage } from "./helpers/certified-output-lineage";
import { archiveReadOrder, readRequest } from "./helpers/api-order-read-fixture";
import { createApiDeliveryWriteFixture, removeApiDeliveryWriteFixture, postDelivery as post, patchDelivery as patch, readDelivery as read,
  deliveryInput, deliveryProblem as problem, deliveryRows as rows, deliveryRecords as records, deliveryAudits as audits,
  DELIVERY_TEST_TIMEOUT_MS, type ApiDeliveryWriteFixture } from "./helpers/api-delivery-write-fixture";

const LARGE_ORDER_WET_KG = 2000;
const OVERDRAW_WET_KG = 1000.001;
const FUTURE_AT = "2099-01-01T00:00:00Z";
const GAP = { date: "2025-03-30", time: "02:30" };
const FOLD = { date: "2025-10-26", time: "02:30" };
const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const rateBucketKeys: string[] = [];
let a: ApiDeliveryWriteFixture;
beforeEach(async () => { a = await createApiDeliveryWriteFixture(); }, DELIVERY_TEST_TIMEOUT_MS);
afterEach(async () => {
  vi.unstubAllEnvs();
  auth.requireOrgContext.mockReset();
  if (rateBucketKeys.length) await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, rateBucketKeys.splice(0)));
  if (a) { await cleanupCertifiedOutputLineage(a.ctx.organizationId); await removeApiDeliveryWriteFixture(a); }
}, DELIVERY_TEST_TIMEOUT_MS);
const setOrder = (quantityKg: number) => db.update(orders).set({ quantityKg }).where(and(eq(orders.organizationId, a.ctx.organizationId), eq(orders.id, a.order.id)));
const setBin = (values: Partial<typeof storageLocations.$inferInsert>) => db.update(storageLocations).set(values).where(and(eq(storageLocations.organizationId, a.ctx.organizationId), eq(storageLocations.id, a.bin.id)));
async function noWrites() {
  expect(await rows(a)).toEqual([]);
  expect(await records(a)).toEqual([]);
  expect(await audits(a)).toEqual([]);
}
async function chargedOnce(send: () => Promise<Response>) {
  const resolved = await resolveApiContext(readRequest("/deliveries", a.writeKey));
  if (!resolved.ok) throw new Error("Fixture credential was refused");
  rateBucketKeys.push(`credential:${resolved.ctx.credentialId}:write`, `organization:${a.ctx.organizationId}:write`);
  const buckets = () => db.select().from(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, rateBucketKeys));
  expect(await buckets()).toEqual([]);
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  const response = await send();
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  const charged = await buckets();
  expect(charged).toHaveLength(2);
  for (const bucket of charged) {
    const kind = bucket.bucketKey.startsWith("credential:") ? "credential" : "organization";
    expect(bucket.tokens).toBe(API_RATE_LIMITS[kind].write - 1);
  }
  return response;
}
async function twoProducts(mode: "mix" | "split", drawOrder: "oldest_first" | "newest_first" = "oldest_first") {
  await setBin({ stockMode: mode, drawOrder });
  await setOrder(LARGE_ORDER_WET_KG);
  return createBiocharProduct(a.ctx, {
    code: `E2E-DP2-${a.tag}`, facilityId: a.facility.id, formulationId: a.recipe.id,
    placedAt: "2026-09-13T12:00:00Z", sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.bin.id,
    massKg: 500, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
    composition: { ingredients: [{ formulationIngredientId: a.ingredient.id, feedstockTypeId: a.ingredientType.id, massKg: 100, moistureContentPercent: 60 }] },
  });
}

describe("delivery stock and order guards", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it.each(["commit", "dryRun", "validation", "replay"])("charges write buckets exactly once per POST: %s", async mode => {
    const key = randomUUID();
    if (mode === "replay") expect((await post(a, deliveryInput(a), key)).status).toBe(201);
    const response = await chargedOnce(() => post(a,
      deliveryInput(a, mode === "validation" ? { moisturePercent: undefined } : {}), key, mode === "dryRun" ? "?dryRun=true" : ""));
    expect(response.status).toBe(mode === "validation" ? 422 : mode === "dryRun" ? 200 : 201);
    if (mode === "replay") expect(response.headers.get("idempotent-replayed")).toBe("true");
  });
  it("refuses a stale basis with a fresh preview, leaves the key free and accepts the new basis", async () => {
    const key = randomUUID();
    const preview = await post(a, deliveryInput(a), key, "?dryRun=true");
    expect(preview.status).toBe(200);
    const old = await preview.json();
    expect((await post(a)).status).toBe(201);
    const response = await chargedOnce(() => post(a, deliveryInput(a, { basisFingerprint: old.basisFingerprint }), key));
    const refusal = await problem(response, 409, "stock_basis_changed");
    expect(refusal.preview).toMatchObject({ basisFingerprint: expect.any(String), stockEffects: expect.any(Array) });
    expect(refusal.preview.basisFingerprint).not.toBe(old.basisFingerprint);
    const independent = await post(a, deliveryInput(a), randomUUID(), "?dryRun=true");
    expect(independent.status).toBe(200);
    const fresh = await independent.json();
    expect(refusal.preview).toEqual({ stockEffects: fresh.stockEffects, basisFingerprint: fresh.basisFingerprint, allocations: fresh.allocations });
    expect(await rows(a)).toHaveLength(1);
    expect(await records(a)).toHaveLength(1);
    expect(await audits(a)).toHaveLength(1);
    expect((await post(a, deliveryInput(a, { basisFingerprint: refusal.preview.basisFingerprint }), key)).status).toBe(201);
  });
  it("rejects an order balance one gram over with wet metadata and accepts the exact remainder", async () => {
    await setOrder(100);
    const refusal = await problem(await post(a, deliveryInput(a, { deliveredWetMassKg: 100.001 })), 409, "conflict", "/deliveredWetMassKg");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/deliveredWetMassKg", meta: { measure: "order_remaining_wet", availableWetKg: 100, requestedWetKg: 100.001, unit: "kg" } }));
    await noWrites();
    expect((await post(a)).status).toBe(201);
    const exhausted = await problem(await post(a, deliveryInput(a, { deliveredWetMassKg: 0.001 })), 409, "conflict");
    expect(exhausted.errors).toContainEqual(expect.objectContaining({ meta: { measure: "order_remaining_wet", availableWetKg: 0, requestedWetKg: 0.001, unit: "kg" } }));
  });
  it("refuses overdraw with total-solids shortage metadata and no posting", async () => {
    await setOrder(LARGE_ORDER_WET_KG);
    const refusal = await problem(await post(a, deliveryInput(a, { deliveredWetMassKg: OVERDRAW_WET_KG })), 409, "insufficient_stock", "/deliveredWetMassKg");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ meta: { storageLocationId: a.bin.id, measure: "total_solids", availableSolidsKg: 800, requestedSolidsKg: 800.0008, unit: "kg" } }));
    await noWrites();
  });
  it("refuses sources on a mix bin and missing moisture without sources", async () => {
    await problem(await post(a, deliveryInput(a, { sources: [{ layerId: a.product.id, moisturePercent: 20 }] })), 422, "validation_failed", "/sources");
    await problem(await post(a, deliveryInput(a, { moisturePercent: undefined })), 422, "validation_failed", "/moisturePercent");
    await noWrites();
  });
  it("refuses future instants, DST gaps and folds, and resolves local time in the order facility zone", async () => {
    await db.update(facilities).set({ timezone: "Europe/Zurich" }).where(and(eq(facilities.organizationId, a.ctx.organizationId), eq(facilities.id, a.facility.id)));
    await problem(await post(a, deliveryInput(a, { deliveredAt: FUTURE_AT })), 422, "validation_failed", "/deliveredAt");
    for (const [deliveredAt, message] of [[GAP, "02:30 does not exist on 2025-03-30 in Europe/Zurich"], [FOLD, "02:30 occurs twice on 2025-10-26 in Europe/Zurich"]] as const) {
      const refusal = await problem(await post(a, deliveryInput(a, { deliveredAt })), 422, "validation_failed", "/deliveredAt");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/deliveredAt", detail: expect.stringContaining(message) }));
    }
    await noWrites();
    const response = await post(a, deliveryInput(a, { deliveredAt: { date: "2026-09-14", time: "14:00" } }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.deliveredAt).toBe("2026-09-14T12:00:00.000Z");
  });
  it.each(["formulation", "facility", "type"] as const)("refuses an ineligible bin with a storageLocationId pointer: %s", async kind => {
    await setBin(kind === "formulation" ? { formulationId: a.pure.id }
      : kind === "facility" ? { facilityId: a.otherFacility.id } : { type: "biochar_bin", formulationId: null });
    await problem(await post(a), 422, "validation_failed", "/storageLocationId");
    await noWrites();
  });
  it("refuses an archived order or facility with an order pointer", async () => {
    await archiveReadOrder(a, a.order.id);
    await problem(await post(a), 404, "not_found", "/orderId");
    await db.update(orders).set({ archivedAt: null }).where(eq(orders.id, a.order.id));
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, a.facility.id));
    await problem(await post(a), 404, "not_found", "/orderId");
    await noWrites();
  });
  it("refuses an archived bin with a storageLocationId pointer and no row", async () => {
    await setBin({ archivedAt: new Date() });
    await problem(await post(a), 404, "not_found", "/storageLocationId");
    await noWrites();
  });
  it("keeps an active delivery readable but refuses REST and app updates on its archived facility", async () => {
    const created = await post(a);
    expect(created.status).toBe(201);
    const { data } = await created.json();
    await db.update(facilities).set({ archivedAt: new Date() }).where(and(eq(facilities.organizationId, a.ctx.organizationId), eq(facilities.id, a.facility.id)));
    const current = await read(a, data.id);
    expect(current.data.archivedAt).toBeNull();
    const beforeRows = await rows(a);
    await problem(await patch(a, data.id, { distanceNote: "Refused" }, current.etag), 404, "not_found", "/deliveryId");
    auth.requireOrgContext.mockResolvedValue(a.ctx);
    const result = await updateDeliveryFn({ deliveryId: data.id, expectedVersion: data.version, distanceNote: "Refused" });
    expect(result).toMatchObject({ success: false, code: "not_found", issues: [{ path: ["deliveryId"] }] });
    expect(await read(a, data.id)).toEqual(current);
    expect(await rows(a)).toEqual(beforeRows);
    expect(await records(a)).toHaveLength(1);
    expect(await audits(a)).toHaveLength(1);
  });
  it("rejects create and PATCH on submitted lineage with the correct pointer", async () => {
    await certifyOutputLineage(a, { runId: a.runs[0].id, productId: a.product.id, submitted: true });
    const [existing] = await rows(a);
    await db.update(orders).set({ formulationId: a.recipe.id, quantityKg: LARGE_ORDER_WET_KG }).where(eq(orders.id, existing.orderId));
    await problem(await post(a, deliveryInput(a, { orderId: existing.orderId })), 409, "certification_locked", "/orderId");
    const current = await read(a, existing.id);
    await problem(await patch(a, existing.id, { distanceNote: "Refused" }, current.etag), 409, "certification_locked", "/deliveryId");
    expect(await read(a, existing.id)).toEqual(current);
    expect(await records(a)).toEqual([]);
    expect(await audits(a)).toEqual([]);
  });
});

describe("delivery allocation results", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it("draws a mix pro rata, including ingredient solids, and keeps preview and committed allocations equal", async () => {
    const second = await twoProducts("mix");
    const input = deliveryInput(a, { deliveredWetMassKg: 300 });
    const preview = await post(a, input, randomUUID(), "?dryRun=true");
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.allocations).toEqual([
      { layerId: a.product.id, code: a.product.code, dryBiocharKg: 144, solidsKg: 160, wetKg: 200, moisturePercent: 20, policy: "pro_rata" },
      { layerId: second.id, code: second.code, dryBiocharKg: 72, solidsKg: 80, wetKg: 100, moisturePercent: 20, policy: "pro_rata" },
    ]);
    await noWrites();
    const committed = await post(a, { ...input, basisFingerprint: body.basisFingerprint });
    expect(committed.status).toBe(201);
    expect(await committed.json()).toMatchObject({ allocations: body.allocations, data: { dryBiocharKg: 216, moisturePercent: 20 } });
  });
  it.each(["oldest_first", "newest_first"] as const)("draws a split bin without sources in %s order", async drawOrder => {
    const second = await twoProducts("split", drawOrder);
    const response = await post(a);
    expect(response.status).toBe(201);
    expect((await response.json()).allocations).toMatchObject([{ layerId: drawOrder === "oldest_first" ? a.product.id : second.id,
      policy: drawOrder === "oldest_first" ? "fifo" : "lifo", solidsKg: 80, wetKg: 100 }]);
  });
  it("keeps explicit source order, measured source moisture and the server-derived overall moisture", async () => {
    const second = await twoProducts("split");
    const input = deliveryInput(a, { moisturePercent: undefined, deliveredWetMassKg: 900,
      sources: [{ layerId: second.id.toUpperCase(), moisturePercent: 50 }, { layerId: a.product.id, moisturePercent: 20 }] });
    const preview = await post(a, input, randomUUID(), "?dryRun=true");
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.allocations).toEqual([
      { layerId: second.id, code: second.code, dryBiocharKg: 360, solidsKg: 400, wetKg: 800, moisturePercent: 50, policy: "operator_order" },
      { layerId: a.product.id, code: a.product.code, dryBiocharKg: 72, solidsKg: 80, wetKg: 100, moisturePercent: 20, policy: "operator_order" },
    ]);
    await noWrites();
    const committed = await post(a, { ...input, basisFingerprint: body.basisFingerprint });
    expect(committed.status).toBe(201);
    expect(await committed.json()).toMatchObject({ allocations: body.allocations, data: { dryBiocharKg: 432, moisturePercent: 46.666667 } });
  });
  it("refuses a source placed after the delivery at its source pointer", async () => {
    await setBin({ stockMode: "split" });
    await problem(await post(a, deliveryInput(a, { deliveredAt: "2026-09-11T12:00:00Z", sources: [{ layerId: a.product.id, moisturePercent: 20 }] })), 422, "validation_failed", "/sources/0/layerId");
    await noWrites();
  });
});
