import { apiActivityWhere } from "./api-activity";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, binMovements, biocharProducts } from "@/db/schema";
import { POST as POST_PRODUCT } from "@/app/api/v1/biochar-products/route";
import { PATCH as PATCH_PRODUCT } from "@/app/api/v1/biochar-products/[idOrCode]/route";
import { POST as POST_MOVEMENT } from "@/app/api/v1/storage-locations/[idOrCode]/stock-movements/route";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import {
  BIOCHAR_MOISTURE_PERCENT, BIOCHAR_WET_KG, FIRST_PLACED_AT, INGREDIENT_MOISTURE_PERCENT, INGREDIENT_WET_KG, WATER_KG,
  type ApiProductFixture,
} from "./api-biochar-product-fixture";

const API_URL = "http://localhost:3100/api/v1";
/** After every placement the fixtures make, before now. */
export const WRITE_LOSS_AT = "2026-09-14T12:00:00.000Z";
export const WRITE_LOSS_WET_KG = 100;
export const FUTURE_AT = "2099-01-01T00:00:00.000Z";
const PRODUCT_AUDIT_ENTITY = "biochar_product";
const MOVEMENT_AUDIT_ENTITY = "bin_movement";

export function writeRequest(f: ApiProductFixture, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, key = f.writeKey) {
  return new Request(`${API_URL}${path}`, {
    method, headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });

/** A Pure product of 500 kg wet biochar at 10 % moisture, 450 kg dry, drawn from the biochar bin into the Pure bin. */
export const pureProductBody = (f: ApiProductFixture, changes: Record<string, unknown> = {}) => ({
  facilityId: f.facility.id, formulationId: f.pure.id, placedAt: FIRST_PLACED_AT,
  sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.pureBin.id,
  biocharWetMassKg: BIOCHAR_WET_KG, biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT, waterAddedKg: 0, ...changes,
});

/** The recipe's one ingredient line as mixed. */
export const ingredientLine = (f: ApiProductFixture, changes: Record<string, unknown> = {}) => ({
  formulationIngredientId: f.ingredient.id, storageLocationId: f.ingredientBin.id,
  wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE_PERCENT, ...changes,
});

/** The same biochar blended with one ingredient line and water, in the recipe bin. */
export const blendedProductBody = (f: ApiProductFixture, changes: Record<string, unknown> = {}) => pureProductBody(f, {
  formulationId: f.recipe.id, storageLocationId: f.bin.id, waterAddedKg: WATER_KG,
  ingredients: [ingredientLine(f)], ...changes,
});

export const lossBody = (changes: Record<string, unknown> = {}) => ({
  kind: "loss", occurredAt: WRITE_LOSS_AT, wetMassKg: WRITE_LOSS_WET_KG, moisturePercent: BIOCHAR_MOISTURE_PERCENT, reason: "E2E REST loss", ...changes,
});
export const countBody = (wetMassKg: number, changes: Record<string, unknown> = {}) => ({
  kind: "count", occurredAt: WRITE_LOSS_AT, wetMassKg, moisturePercent: BIOCHAR_MOISTURE_PERCENT, reason: "E2E REST count", ...changes,
});

export const postProductRest = (f: ApiProductFixture, body: unknown, key: string | null = randomUUID(), query = "", writeKey = f.writeKey) =>
  POST_PRODUCT(writeRequest(f, "POST", `/biochar-products${query}`, body, key === null ? {} : { "idempotency-key": key }, writeKey));
export const patchProductRest = (f: ApiProductFixture, id: string, body: unknown, etag?: string, query = "") =>
  PATCH_PRODUCT(writeRequest(f, "PATCH", `/biochar-products/${id}${query}`, body, etag === undefined ? {} : { "if-match": etag }), params(id));
export const postMovementRest = (f: ApiProductFixture, binId: string, body: unknown, key: string | null = randomUUID(), query = "") =>
  POST_MOVEMENT(writeRequest(f, "POST", `/storage-locations/${binId}/stock-movements${query}`, body, key === null ? {} : { "idempotency-key": key }), params(binId));

export function requiredEtag(response: Response): string {
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  return etag!;
}

/** Create through the endpoint and return the parsed product with its ETag. */
export async function seedRestProduct(f: ApiProductFixture, body: unknown = pureProductBody(f)) {
  const response = await postProductRest(f, body);
  expect(response.status).toBe(201);
  return { row: biocharProductRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}

export async function readRestProduct(f: ApiProductFixture, id: string) {
  const { GET } = await import("@/app/api/v1/biochar-products/[idOrCode]/route");
  const response = await GET(writeRequest(f, "GET", `/biochar-products/${id}`), params(id));
  expect(response.status).toBe(200);
  return { row: biocharProductRepresentationSchema.parse((await response.json()).data), etag: requiredEtag(response) };
}

/** Actual rows, independent of the API projection. */
export async function captureProductWriteState(f: ApiProductFixture) {
  const org = f.ctx.organizationId;
  return {
    products: await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, org)).orderBy(biocharProducts.code),
    movements: await db.select().from(binMovements).where(eq(binMovements.organizationId, org)).orderBy(binMovements.postingSequence),
  };
}

export async function productWriteAudits(f: ApiProductFixture, entityType: "product" | "movement" = "product") {
  return db.select().from(activityEvents).where(apiActivityWhere(f.ctx.organizationId, eq(activityEvents.entityType, entityType === "product" ? PRODUCT_AUDIT_ENTITY : MOVEMENT_AUDIT_ENTITY)));
}
export const writeIdempotencyRecords = (f: ApiProductFixture) =>
  db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
