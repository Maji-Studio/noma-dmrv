import { apiActivityWhere } from "./api-activity";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, deliveries, drivers, storageLocations, vehicles } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import * as collection from "@/app/api/v1/deliveries/route";
import * as detail from "@/app/api/v1/deliveries/[idOrCode]/route";
import { createApiOrderReadFixture, insertReadOrder, readParams, readRequest, removeApiOrderReadFixture } from "./api-order-read-fixture";

export const DELIVERY_AT = "2026-09-14T12:00:00.000Z";
export const DELIVERY_WET_KG = 100;
export const DELIVERY_MOISTURE = 20;
export const DELIVERY_TEST_TIMEOUT_MS = 60_000;

export async function createApiDeliveryWriteFixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ("deliveries:read" | "deliveries:write")[]) => (await createApiKey(f.ctx, {
    name: "Delivery writer", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  })).key;
  await db.update(storageLocations).set({ stockMode: "mix" }).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
  const product = await createBiocharProduct(f.ctx, {
    code: `E2E-DP-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id,
    placedAt: "2026-09-12T12:00:00.000Z", sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
    massKg: 1000, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
    composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: 200, moistureContentPercent: 60 }] },
  });
  const order = await insertReadOrder(f, `E2E-DO-${f.tag}`, { quantityKg: 1000 });
  const [driver] = await db.insert(drivers).values({ organizationId: f.ctx.organizationId, code: `E2E-DR-${f.tag}`, name: `E2E Driver ${f.tag}` }).returning();
  const [vehicle] = await db.insert(vehicles).values({ organizationId: f.ctx.organizationId, code: `E2E-VH-${f.tag}`, name: `E2E Vehicle ${f.tag}`, vehicleType: "truck" }).returning();
  return { ...f, product, order, driver, vehicle, readKey: await key(["deliveries:read"]), writeKey: await key(["deliveries:write"]), secondWriteKey: await key(["deliveries:write"]) };
}
export type ApiDeliveryWriteFixture = Awaited<ReturnType<typeof createApiDeliveryWriteFixture>>;
export function deliveryInput(f: ApiDeliveryWriteFixture, extra: Record<string, unknown> = {}) {
  return { orderId: f.order.id, storageLocationId: f.bin.id, deliveredAt: DELIVERY_AT, deliveredWetMassKg: DELIVERY_WET_KG, moisturePercent: DELIVERY_MOISTURE, ...extra };
}
function request(method: string, path: string, credential: string, body: unknown, headers: Record<string, string>) {
  return new Request(`http://localhost:3100/api/v1${path}`, { method, headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
export function postDelivery(f: ApiDeliveryWriteFixture, body: unknown = deliveryInput(f), key: string | null = randomUUID(), query = "", credential = f.writeKey) {
  return collection.POST(request("POST", `/deliveries${query}`, credential, body, key ? { "idempotency-key": key } : {}));
}
export function patchDelivery(f: ApiDeliveryWriteFixture, id: string, body: unknown, etag?: string, key: string | null = null, query = "", credential = f.writeKey) {
  return detail.PATCH(request("PATCH", `/deliveries/${id}${query}`, credential, body, { ...(etag ? { "if-match": etag } : {}), ...(key ? { "idempotency-key": key } : {}) }), readParams(id));
}
export async function readDelivery(f: ApiDeliveryWriteFixture, id: string) {
  const response = await detail.GET(readRequest(`/deliveries/${id}`, f.readKey), readParams(id));
  if (response.status !== 200) throw new Error(`Delivery read failed: ${response.status}`);
  return { data: (await response.json()).data, etag: response.headers.get("etag")! };
}
export const deliveryRows = (f: ApiDeliveryWriteFixture) => db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId));
export const deliveryRecords = (f: ApiDeliveryWriteFixture) => db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
export const deliveryAudits = (f: ApiDeliveryWriteFixture) => db.select().from(activityEvents).where(apiActivityWhere(f.ctx.organizationId));
export async function removeApiDeliveryWriteFixture(f: ApiDeliveryWriteFixture) {
  await db.update(deliveries).set({ driverId: null, vehicleId: null }).where(eq(deliveries.organizationId, f.ctx.organizationId));
  await db.delete(drivers).where(eq(drivers.organizationId, f.ctx.organizationId));
  await db.delete(vehicles).where(eq(vehicles.organizationId, f.ctx.organizationId));
  await removeApiOrderReadFixture(f);
}
export async function deliveryProblem(response: Response, status: number, code: string, pointer?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = await response.json();
  expect(body.code).toBe(code);
  if (pointer) expect(body.errors).toContainEqual(expect.objectContaining({ pointer }));
  return body;
}
