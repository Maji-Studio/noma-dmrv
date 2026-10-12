import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { db } from "@/db";
import { feedstocks, members, storageLocations } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperation } from "@/lib/operations/runner";
import { cleanupOutputStockFixture } from "./output-stock-cleanup";
import { seedOutputStockParents } from "./output-stock-fixture";

export const PRODUCT_API_SCOPES: readonly ApiScope[] = ["biochar-products:read", "formulations:read", "storage-locations:read"];
export const FIRST_PLACED_AT = "2026-09-12T12:00:00.000Z";
export const SECOND_PLACED_AT = "2026-09-13T12:00:00.000Z";
export const BIOCHAR_WET_KG = 500;
export const BIOCHAR_MOISTURE_PERCENT = 10;
export const BIOCHAR_DRY_KG = 450;
export const INGREDIENT_WET_KG = 50;
export const INGREDIENT_MOISTURE_PERCENT = 20;
export const WATER_KG = 25;
const INGREDIENT_STOCK_KG = 100;
/** Before the first placement, so every product after it sees this loss. */
export const FIRST_LOSS_AT = "2026-09-12T11:00:00.000Z";
export const SECOND_LOSS_AT = "2026-09-13T08:00:00.000Z";
export const FIRST_LOSS_WET_KG = 100;
export const SECOND_LOSS_WET_KG = 50;
export const SECOND_LOSS_DRY_KG = 45;
const ENTITY_BASE = "http://localhost:3100/api/v1";

export type ApiProductParents = Awaited<ReturnType<typeof seedOutputStockParents>>;
export interface ApiProductFixture extends ApiProductParents {
  key: string;
  /** A real key whose scopes name neither products, formulations nor movements. */
  otherScopeKey: string;
  /** Formulations only: the scope precedence fixture. */
  formulationsOnlyKey: string;
  pureBin: { id: string; code: string };
  ingredientBin: { id: string };
  r1: string;
  r2: string;
}

async function issueKey(f: ApiProductParents, name: string, scopes: readonly ApiScope[]) {
  return (await createApiKey(f.ctx, { name, scopes: [...scopes], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
}

/** Parents from the output-stock fixture, a Pure product bin, a stocked ingredient bin and real credentials. */
export async function createApiProductFixture(): Promise<ApiProductFixture> {
  const f = await seedOutputStockParents(db);
  const organizationId = f.ctx.organizationId;
  await db.insert(members).values({ id: randomUUID(), organizationId, userId: f.ctx.userId, role: "owner" });
  const [pureBin] = await db.insert(storageLocations).values({ organizationId, facilityId: f.facility.id, formulationId: f.pure.id,
    code: `E2E-API-PB-${f.tag}`, name: `E2E Pure bin ${f.tag}`, type: "product_bin" }).returning();
  const [ingredientBin] = await db.insert(storageLocations).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: f.ingredientType.id,
    code: `E2E-API-IB-${f.tag}`, name: `E2E Ingredient bin ${f.tag}`, type: "feedstock_bin" }).returning();
  await db.insert(feedstocks).values({ organizationId, facilityId: f.facility.id, code: `E2E-API-IN-${f.tag}`, status: "complete", feedstockTypeId: f.ingredientType.id,
    storageLocationId: ingredientBin.id, massWetKg: INGREDIENT_STOCK_KG, massDryKg: INGREDIENT_STOCK_KG * (1 - INGREDIENT_MOISTURE_PERCENT / 100),
    moistureContentPercent: INGREDIENT_MOISTURE_PERCENT, deliveryDate: new Date("2026-09-01") });
  return {
    ...f, pureBin, ingredientBin, r1: f.runs[0].id, r2: f.runs[1].id,
    key: await issueKey(f, "Product reader", PRODUCT_API_SCOPES),
    otherScopeKey: await issueKey(f, "Other scope", ["feedstocks:read"]),
    formulationsOnlyKey: await issueKey(f, "Formulations only", ["formulations:read"]),
  };
}

export async function removeApiProductFixture(f: ApiProductFixture) {
  await cleanupOutputStockFixture(db, f.ctx.organizationId);
}

const productInput = (f: ApiProductFixture, changes: Record<string, unknown>) => ({
  facilityId: f.facility.id, sourceBiocharStorageLocationId: f.source.id, biocharWetMassKg: BIOCHAR_WET_KG,
  biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT, ...changes,
});

/** A Pure product placed in the Pure bin. */
export async function makePureProduct(f: ApiProductFixture, placedAt = FIRST_PLACED_AT) {
  return (await runOperation(makeBiocharProduct, f.ctx, productInput(f, {
    formulationId: f.pure.id, storageLocationId: f.pureBin.id, placedAt, waterAddedKg: 0,
  }))).data.product;
}

/** A blended product: biochar, one ingredient line and added water, in the recipe bin. */
export async function makeBlendedProduct(f: ApiProductFixture, placedAt = SECOND_PLACED_AT) {
  return (await runOperation(makeBiocharProduct, f.ctx, productInput(f, {
    formulationId: f.recipe.id, storageLocationId: f.bin.id, placedAt, waterAddedKg: WATER_KG,
    ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: f.ingredientBin.id, wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE_PERCENT }],
  }))).data.product;
}

export async function postLoss(f: ApiProductFixture, occurredAt: string, wetMassKg: number) {
  return (await runOperation(recordOutputStockMovement, f.ctx, {
    storageLocationId: f.source.id, kind: "loss", occurredAt, wetMassKg, moisturePercent: BIOCHAR_MOISTURE_PERCENT, reason: "E2E spilled",
  })).data;
}

export function productApiRequest(path: string, key: string) {
  return new Request(`${ENTITY_BASE}${path}`, { headers: { authorization: `Bearer ${key}` } });
}
export const productApiParams = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });

export async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.code).toBe(code);
  return body;
}
