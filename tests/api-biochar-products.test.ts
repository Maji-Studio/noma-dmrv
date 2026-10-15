/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, feedstockTypes, formulationIngredients, formulations, storageLocations } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/biochar-products/route";
import { GET } from "@/app/api/v1/biochar-products/[idOrCode]/route";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import {
  BIOCHAR_DRY_KG, BIOCHAR_MOISTURE_PERCENT, BIOCHAR_WET_KG, createApiProductFixture, expectProblem, FIRST_PLACED_AT, INGREDIENT_MOISTURE_PERCENT,
  INGREDIENT_WET_KG, makeBlendedProduct, makePureProduct, productApiParams, productApiRequest, removeApiProductFixture, SECOND_PLACED_AT, WATER_KG,
  type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";

const TIMEOUT_MS = 60_000;
const PAGE_LIMIT = 1;
let a: ApiProductFixture;
let b: ApiProductFixture;
let pure: Awaited<ReturnType<typeof makePureProduct>>;
let blended: Awaited<ReturnType<typeof makeBlendedProduct>>;
const list = (query = "", key = a.key) => LIST(productApiRequest(`/biochar-products${query}`, key));
const get = (identifier: string, key = a.key, query = "") => GET(productApiRequest(`/biochar-products/${encodeURIComponent(identifier)}${query}`, key), productApiParams(identifier));
const ids = async (response: Response) => (await response.json()).data.map((row: { id: string }) => row.id);

beforeEach(async () => {
  a = await createApiProductFixture();
  b = await createApiProductFixture();
  pure = await makePureProduct(a);
  blended = await makeBlendedProduct(a);
}, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(a); await removeApiProductFixture(b); }, TIMEOUT_MS);

describe("biochar product reads", { timeout: TIMEOUT_MS }, () => {
  it("gets a Pure product by id and code with the stored facts, ids only and a strong ETag", async () => {
    for (const identifier of [pure.id, pure.code]) {
      const response = await get(identifier);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("etag")).toBe(`"${pure.version}.${BIOCHAR_PRODUCT_REPRESENTATION_REVISION}"`);
      const { data: body } = await response.json();
      const data = body;
      expect(biocharProductRepresentationSchema.parse(body)).toEqual(body);
      expect(body).not.toHaveProperty("expiresAt");
      expect(data).toEqual({
        id: pure.id, code: pure.code, version: pure.version, facilityId: a.facility.id, formulationId: a.pure.id, status: "testing",
        placedAt: FIRST_PLACED_AT, productionDate: expect.any(String),
        sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.pureBin.id,
        biocharWetMassKg: BIOCHAR_WET_KG, biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT, waterAddedKg: 0, densityKgM3: null,
        ingredients: [], sourceAllocations: [{ productionRunId: a.r1, wetMassKg: BIOCHAR_WET_KG, dryMassKg: BIOCHAR_DRY_KG }],
        archivedAt: null, createdAt: expect.any(String), updatedAt: expect.any(String),
      });
      for (const field of ["organizationId", "massKg", "composition", "stockPostingSequence", "biocharRatio", "linkedProductionRunId", "remainingDryKg"]) expect(data).not.toHaveProperty(field);
    }
  });

  it("derives the biochar-only mass from the stored blend and lists the saved ingredients as ids", async () => {
    const { data } = await (await get(blended.id)).json();
    expect(data).toMatchObject({ formulationId: a.recipe.id, storageLocationId: a.bin.id, biocharWetMassKg: BIOCHAR_WET_KG, waterAddedKg: WATER_KG });
    expect(data.ingredients).toEqual([{
      formulationIngredientId: a.ingredient.id, feedstockTypeId: a.ingredientType.id, storageLocationId: a.ingredientBin.id,
      wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE_PERCENT,
    }]);
    expect(blended.massKg).toBe(BIOCHAR_WET_KG + INGREDIENT_WET_KG);
  });

  it("returns identical bytes on repeated reads and after the catalog is renamed", async () => {
    const first = await (await get(blended.id)).text();
    expect(await (await get(blended.id)).text()).toBe(first);
    await db.update(feedstockTypes).set({ name: `Renamed ${a.tag}`, category: "other" }).where(eq(feedstockTypes.id, a.ingredientType.id));
    await db.update(formulations).set({ name: `Renamed ${a.tag}` }).where(eq(formulations.id, a.recipe.id));
    await db.update(formulationIngredients).set({ ratio: 0.35 }).where(eq(formulationIngredients.id, a.ingredient.id));
    await db.update(storageLocations).set({ name: `Renamed bin ${a.tag}` }).where(and(eq(storageLocations.id, a.ingredientBin.id), eq(storageLocations.organizationId, a.ctx.organizationId)));
    expect(await (await get(blended.id)).text()).toBe(first);
    expect(await (await list()).json()).toMatchObject({ data: [{ id: blended.id }, { id: pure.id }] });
  });

  it("lists newest first, filters by every published filter and paginates by cursor", async () => {
    expect(await ids(await list())).toEqual([blended.id, pure.id]);
    const first = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    expect(first.data.map((row: { id: string }) => row.id)).toEqual([blended.id]);
    expect(first.nextCursor).toBeTruthy();
    const second = await (await list(`?limit=${PAGE_LIMIT}&cursor=${first.nextCursor}`)).json();
    expect(second.data.map((row: { id: string }) => row.id)).toEqual([pure.id]);
    expect(second.nextCursor).toBeNull();
    expect(first).not.toHaveProperty("total");
    const only = async (query: string) => ids(await list(`?${query}`));
    expect(await only(`facilityId=${a.facility.id}`)).toEqual([blended.id, pure.id]);
    expect(await only("status=ready")).toEqual([]);
    expect(await only("status=testing")).toEqual([blended.id, pure.id]);
    expect(await only(`storageLocationId=${a.pureBin.id}`)).toEqual([pure.id]);
    expect(await only(`formulationId=${a.recipe.id}`)).toEqual([blended.id]);
    expect(await only(`code=${encodeURIComponent(pure.code)}`)).toEqual([pure.id]);
    expect(await only(`q=${encodeURIComponent(pure.code.slice(0, 5).toLowerCase())}`)).toEqual([blended.id, pure.id]);
    expect(await only("code=missing")).toEqual([]);
    expect(await only(`placedFrom=${encodeURIComponent(SECOND_PLACED_AT)}`)).toEqual([blended.id]);
    expect(await only(`placedBefore=${encodeURIComponent(SECOND_PLACED_AT)}`)).toEqual([pure.id]);
    expect(await only(`placedFrom=${encodeURIComponent(FIRST_PLACED_AT)}&placedBefore=${encodeURIComponent(SECOND_PLACED_AT)}`)).toEqual([pure.id]);
    expect(await only(`placedFrom=${encodeURIComponent("2026-09-13T14:00:00+02:00")}`)).toEqual([blended.id]);
  });

  it("binds cursors to the organization and the filter set", async () => {
    const page = await (await list(`?limit=${PAGE_LIMIT}`)).json();
    await expectProblem(await list(`?status=testing&cursor=${page.nextCursor}`), 400, "invalid_cursor");
    await expectProblem(await list(`?cursor=${page.nextCursor}`, b.key), 400, "invalid_cursor");
  });

  it("rejects invalid, repeated and unknown queries and an offset-less range instant", async () => {
    for (const query of ["?unknown=1", "?status=archived", "?limit=0", "?limit=1&limit=2", "?q=a&q=b", "?facilityId=nope", "?placedFrom=2026-09-12T12:00:00", "?placedBefore=2026-09-12"]) {
      await expectProblem(await list(query), 400, "invalid_query");
    }
    await expectProblem(await get(pure.id, a.key, "?q=a"), 400, "invalid_query");
  });

  it("keeps archived products readable by id and out of lists", async () => {
    const archivedAt = new Date("2026-10-01T00:00:00.000Z");
    await db.update(biocharProducts).set({ archivedAt }).where(and(eq(biocharProducts.id, pure.id), eq(biocharProducts.organizationId, a.ctx.organizationId)));
    expect(await ids(await list())).toEqual([blended.id]);
    const { data } = await (await get(pure.id)).json();
    expect(data.archivedAt).toBe(archivedAt.toISOString());
  });

  it("answers 404 for foreign ids, codes and filters, and for unknown products", async () => {
    for (const identifier of [pure.id, pure.code, blended.id, blended.code, "missing"]) {
      const refusal = await expectProblem(await get(identifier, b.key), 404, "not_found");
      expect(refusal.errors).toEqual([{ pointer: "/biocharProductId", code: "not_found", detail: expect.any(String) }]);
    }
    expect(await ids(await list("", b.key))).toEqual([]);
    for (const [filter, value] of [["facilityId", a.facility.id], ["storageLocationId", a.pureBin.id], ["formulationId", a.recipe.id]]) {
      const refusal = await expectProblem(await list(`?${filter}=${value}`, b.key), 404, "not_found");
      expect(refusal.errors[0].pointer).toBe(`/${filter}`);
    }
  });

  it("refuses each route without the products scope, including a formulations-only key", async () => {
    for (const key of [a.otherScopeKey, a.formulationsOnlyKey]) {
      await expectProblem(await list("", key), 403, "missing_scope");
      await expectProblem(await get(pure.id, key), 403, "missing_scope");
    }
  });
});
