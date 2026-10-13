/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { PATCH } from "@/app/api/v1/biochar-products/[idOrCode]/route";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import {
  BIOCHAR_DRY_KG, BIOCHAR_MOISTURE_PERCENT, BIOCHAR_WET_KG, createApiProductFixture, expectProblem, FIRST_PLACED_AT, INGREDIENT_MOISTURE_PERCENT,
  INGREDIENT_WET_KG, removeApiProductFixture, WATER_KG, type ApiProductFixture,
} from "./helpers/api-biochar-product-fixture";
import {
  blendedProductBody, captureProductWriteState, FUTURE_AT, ingredientLine, patchProductRest, postProductRest, productWriteAudits, pureProductBody,
  readRestProduct, requiredEtag, seedRestProduct, writeIdempotencyRecords,
} from "./helpers/api-biochar-write-fixture";
import { uppercaseUuids } from "./helpers/uppercase-uuids";

const TIMEOUT_MS = 60_000;
const SOURCE_DRY_KG = 1500;
const OVERSIZED_WET_KG = 5000;
const OVERSIZED_DRY_KG = 4500;
const INGREDIENT_STOCK_KG = 100;
const DENSITY_KG_M3 = 250;
let a: ApiProductFixture;
let b: ApiProductFixture;
beforeEach(async () => {
  a = await createApiProductFixture();
  b = await createApiProductFixture();
}, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(a); await removeApiProductFixture(b); }, TIMEOUT_MS);

const noChange = async () => {
  const state = await captureProductWriteState(a);
  expect(state.products).toEqual([]);
  expect(state.movements).toEqual([]);
  expect(await productWriteAudits(a)).toEqual([]);
};

describe("biochar product create", { timeout: TIMEOUT_MS }, () => {
  it("creates a Pure product with Location, a strong ETag, the stored facts, one draw and one audit row", async () => {
    const response = await postProductRest(a, pureProductBody(a));
    expect(response.status).toBe(201);
    const { data, ...rest } = await response.json();
    expect(rest).toEqual({});
    expect(biocharProductRepresentationSchema.parse(data)).toEqual(data);
    expect(response.headers.get("location")).toBe(`/api/v1/biochar-products/${data.id}`);
    expect(response.headers.get("etag")).toBe('"1.1"');
    expect(response.headers.has("idempotent-replayed")).toBe(false);
    expect(data).toMatchObject({
      version: 1, status: "testing", facilityId: a.facility.id, formulationId: a.pure.id, placedAt: FIRST_PLACED_AT,
      sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.pureBin.id,
      biocharWetMassKg: BIOCHAR_WET_KG, biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT, waterAddedKg: 0, densityKgM3: null,
      ingredients: [], sourceAllocations: [{ productionRunId: a.r1, wetMassKg: BIOCHAR_WET_KG, dryMassKg: BIOCHAR_DRY_KG }],
    });
    for (const field of ["organizationId", "massKg", "composition", "idempotencyKey", "basisFingerprint", "stockPostingSequence"]) expect(data).not.toHaveProperty(field);
    const read = await readRestProduct(a, data.id);
    expect(read.row).toEqual(data);
    expect(read.etag).toBe('"1.1"');
    const state = await captureProductWriteState(a);
    expect(state.products).toMatchObject([{ id: data.id, massKg: BIOCHAR_WET_KG, code: data.code }]);
    expect(state.movements).toMatchObject([{ outputKind: "production_draw", storageLocationId: a.source.id }]);
    expect(await productWriteAudits(a)).toMatchObject([{
      operationId: "make_biochar_product", outcomeCode: "created", transport: "rest", credentialId: a.writeCredentialId,
      entityIds: [data.id], versionBefore: null, versionAfter: 1,
    }]);
    expect((await productWriteAudits(a))[0].changedFields).not.toContain("basisFingerprint");
  });

  it("creates a blend from the parts as weighed and stores the derived blend", async () => {
    const response = await postProductRest(a, blendedProductBody(a));
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data).toMatchObject({ formulationId: a.recipe.id, storageLocationId: a.bin.id, biocharWetMassKg: BIOCHAR_WET_KG, waterAddedKg: WATER_KG });
    expect(data.ingredients).toEqual([{
      formulationIngredientId: a.ingredient.id, feedstockTypeId: a.ingredientType.id, storageLocationId: a.ingredientBin.id,
      wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE_PERCENT,
    }]);
    expect((await captureProductWriteState(a)).products).toMatchObject([{ massKg: BIOCHAR_WET_KG + INGREDIENT_WET_KG, waterAddedKg: WATER_KG }]);
  });

  it("previews with stockEffects and a basis fingerprint, needs a key, persists nothing and consumes no key", async () => {
    const keyless = await postProductRest(a, pureProductBody(a), null, "?dryRun=true");
    expect((await expectProblem(keyless, 400, "idempotency_key_required")).retryable).toBe(false);
    const key = randomUUID();
    const preview = await postProductRest(a, pureProductBody(a), key, "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const body = await preview.json();
    expect(body.basisFingerprint).toEqual(expect.any(String));
    expect(body.data).toMatchObject({ version: 1, status: "testing", biocharWetMassKg: BIOCHAR_WET_KG });
    expect(body.stockEffects).toContainEqual(expect.objectContaining({
      storageLocationId: a.source.id, stockKind: "biochar_bin", delta: expect.objectContaining({ dryKg: -BIOCHAR_DRY_KG }),
    }));
    await noChange();
    expect(await writeIdempotencyRecords(a)).toEqual([]);
    expect((await postProductRest(a, pureProductBody(a), key)).status).toBe(201);
  });

  it("replays the same key and body, and refuses the key with a different body", async () => {
    const key = randomUUID();
    const first = await postProductRest(a, pureProductBody(a), key);
    expect(first.status).toBe(201);
    const text = await first.text();
    const replay = await postProductRest(a, pureProductBody(a), key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(await replay.text()).toBe(text);
    await expectProblem(await postProductRest(a, pureProductBody(a, { waterAddedKg: 1 }), key), 422, "idempotency_key_reused");
    const state = await captureProductWriteState(a);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(1);
    expect(await productWriteAudits(a)).toHaveLength(1);
  });

  it("canonicalizes uppercase reference UUIDs, so either case replays one key (api/uuid-case)", async () => {
    const key = randomUUID();
    const upper = await postProductRest(a, uppercaseUuids(blendedProductBody(a)), key);
    expect(upper.status).toBe(201);
    const text = await upper.text();
    expect(JSON.parse(text).data).toMatchObject({
      facilityId: a.facility.id, formulationId: a.recipe.id, sourceBiocharStorageLocationId: a.source.id, storageLocationId: a.bin.id,
      ingredients: [{ formulationIngredientId: a.ingredient.id, storageLocationId: a.ingredientBin.id }],
    });
    const lower = await postProductRest(a, blendedProductBody(a), key);
    expect(lower.status).toBe(201);
    expect(lower.headers.get("idempotent-replayed")).toBe("true");
    expect(await lower.text()).toBe(text);
    const { data } = JSON.parse(text);
    const patched = await patchProductRest(a, data.id.toUpperCase(), { densityKgM3: DENSITY_KG_M3 }, requiredEtag(upper));
    expect(patched.status).toBe(200);
    expect((await patched.json()).data).toMatchObject({ id: data.id, densityKgM3: DENSITY_KG_M3, version: 2 });
    const state = await captureProductWriteState(a);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(1);
    expect(await productWriteAudits(a)).toHaveLength(2);
  });

  const foreign = () => randomUUID();
  it.each([
    ["an unknown facility", (f: ApiProductFixture) => pureProductBody(f, { facilityId: foreign() }), "/facilityId"],
    ["a foreign facility", (f: ApiProductFixture, other: ApiProductFixture) => pureProductBody(f, { facilityId: other.facility.id }), "/facilityId"],
    ["an unknown formulation", (f: ApiProductFixture) => pureProductBody(f, { formulationId: foreign() }), "/formulationId"],
    ["a foreign formulation", (f: ApiProductFixture, other: ApiProductFixture) => pureProductBody(f, { formulationId: other.pure.id }), "/formulationId"],
    ["an unknown source bin", (f: ApiProductFixture) => pureProductBody(f, { sourceBiocharStorageLocationId: foreign() }), "/sourceBiocharStorageLocationId"],
    ["a foreign source bin", (f: ApiProductFixture, other: ApiProductFixture) => pureProductBody(f, { sourceBiocharStorageLocationId: other.source.id }), "/sourceBiocharStorageLocationId"],
    ["an unknown product bin", (f: ApiProductFixture) => pureProductBody(f, { storageLocationId: foreign() }), "/storageLocationId"],
    ["a foreign product bin", (f: ApiProductFixture, other: ApiProductFixture) => pureProductBody(f, { storageLocationId: other.pureBin.id }), "/storageLocationId"],
    ["an unknown ingredient bin", (f: ApiProductFixture) => blendedProductBody(f, { ingredients: [ingredientLine(f, { storageLocationId: foreign() })] }), "/ingredients/0/storageLocationId"],
    ["a foreign ingredient bin", (f: ApiProductFixture, other: ApiProductFixture) => blendedProductBody(f, { ingredients: [ingredientLine(f, { storageLocationId: other.ingredientBin.id })] }), "/ingredients/0/storageLocationId"],
    ["an unknown formulation ingredient", (f: ApiProductFixture) => blendedProductBody(f, { ingredients: [ingredientLine(f, { formulationIngredientId: foreign() })] }), "/ingredients/0/formulationIngredientId"],
    ["a foreign formulation ingredient", (f: ApiProductFixture, other: ApiProductFixture) => blendedProductBody(f, { ingredients: [ingredientLine(f, { formulationIngredientId: other.ingredient.id })] }), "/ingredients/0/formulationIngredientId"],
  ])("answers 404 on its own pointer for %s and leaks nothing", async (_name, build, pointer) => {
    const refusal = await expectProblem(await postProductRest(a, build(a, b)), 404, "not_found");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer, code: "not_found" }));
    expect(JSON.stringify(refusal)).not.toContain(b.facility.id);
    await noChange();
    expect((await captureProductWriteState(b)).movements).toEqual([]);
  });

  it("refuses an ingredient line of another formulation of the same organization as a validation error", async () => {
    const refusal = await expectProblem(await postProductRest(a, pureProductBody(a, { ingredients: [ingredientLine(a, { wetMassKg: 1 })] })), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/ingredients/0/formulationIngredientId" }));
    await noChange();
  });

  it.each([
    ["a missing water amount", (body: Record<string, unknown>) => { delete body.waterAddedKg; }, "/waterAddedKg"],
    ["neither a moisture nor sub-bins", (body: Record<string, unknown>) => { delete body.biocharMoisturePercent; }, "/biocharMoisturePercent"],
    ["a moisture of 100", (body: Record<string, unknown>) => { body.biocharMoisturePercent = 100; }, "/biocharMoisturePercent"],
    ["a zero biochar mass", (body: Record<string, unknown>) => { body.biocharWetMassKg = 0; }, "/biocharWetMassKg"],
    ["a placement in the future", (body: Record<string, unknown>) => { body.placedAt = FUTURE_AT; }, "/placedAt"],
    ["a placement without an offset", (body: Record<string, unknown>) => { body.placedAt = "2026-09-12T12:00:00"; }, "/placedAt"],
    ["an unknown status", (body: Record<string, unknown>) => { body.status = "archived"; }, "/status"],
  ])("answers 422 for %s", async (_name, change, pointer) => {
    const body = pureProductBody(a);
    change(body);
    const refusal = await expectProblem(await postProductRest(a, body), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer }));
    await noChange();
  });

  it.each(["code", "idempotencyKey", "expectedProductVersions", "massKg", "composition", "linkedProductionRunId", "unknownThing"])("rejects %s as an unknown key", async (key) => {
    const refusal = await expectProblem(await postProductRest(a, pureProductBody(a, { [key]: key === "expectedProductVersions" ? {} : "x" })), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${key}`, code: "unknown_field" }));
    await noChange();
  });

  it("answers 409 insufficient_stock with the typed meta for the biochar bin and for an ingredient bin", async () => {
    const biochar = await expectProblem(await postProductRest(a, pureProductBody(a, { biocharWetMassKg: OVERSIZED_WET_KG })), 409, "insufficient_stock");
    expect(biochar.errors).toContainEqual(expect.objectContaining({
      pointer: "/biocharWetMassKg", code: "insufficient_stock",
      meta: { storageLocationId: a.source.id, measure: "dry_biochar", availableSolidsKg: SOURCE_DRY_KG, requestedSolidsKg: OVERSIZED_DRY_KG, unit: "kg" },
    }));
    const ingredient = await expectProblem(await postProductRest(a, blendedProductBody(a, {
      ingredients: [ingredientLine(a, { wetMassKg: INGREDIENT_STOCK_KG + 1 })],
    })), 409, "insufficient_stock");
    expect(ingredient.errors).toContainEqual(expect.objectContaining({
      pointer: "/ingredients/0/wetMassKg", meta: expect.objectContaining({ storageLocationId: a.ingredientBin.id, measure: "ingredient_wet_stock", unit: "kg" }),
    }));
    await noChange();
  });

  it("refuses each write without the write scope, including a key that can only read", async () => {
    for (const key of [a.key, a.otherScopeKey, a.formulationsOnlyKey]) {
      await expectProblem(await postProductRest(a, pureProductBody(a), randomUUID(), "", key), 403, "missing_scope");
    }
    await noChange();
  });

  it("does not let another organization's key reach this organization's bins", async () => {
    await expectProblem(await postProductRest(b, pureProductBody(a), randomUUID()), 404, "not_found");
    expect((await captureProductWriteState(a)).products).toEqual([]);
  });
});

describe("biochar product update", { timeout: TIMEOUT_MS }, () => {
  it("changes code, status and density with the next ETag, an audit row and nothing else", async () => {
    const saved = await seedRestProduct(a);
    const before = await captureProductWriteState(a);
    const response = await patchProductRest(a, saved.row.id, { status: "ready", densityKgM3: DENSITY_KG_M3 }, saved.etag);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2.1"');
    const { data } = await response.json();
    expect(data).toMatchObject({ id: saved.row.id, version: 2, status: "ready", densityKgM3: DENSITY_KG_M3, code: saved.row.code });
    expect(await readRestProduct(a, saved.row.id)).toEqual({ row: data, etag: '"2.1"' });
    const state = await captureProductWriteState(a);
    expect(state.movements).toEqual(before.movements);
    expect(state.products).toMatchObject([{ id: saved.row.id, version: 2, status: "ready", massKg: BIOCHAR_WET_KG }]);
    expect(await productWriteAudits(a)).toHaveLength(2);
    expect((await productWriteAudits(a)).find((row) => row.operationId === "update_biochar_product")).toMatchObject({
      outcomeCode: "updated", transport: "rest", credentialId: a.writeCredentialId, entityIds: [saved.row.id],
      versionBefore: 1, versionAfter: 2, changedFields: ["densityKgM3", "status"],
    });
    const cleared = await patchProductRest(a, saved.row.id, { densityKgM3: null }, '"2.1"');
    expect((await cleared.json()).data.densityKgM3).toBeNull();
    const renamed = await patchProductRest(a, saved.row.id, { code: `${saved.row.code}-X` }, '"3.1"');
    expect((await renamed.json()).data.code).toBe(`${saved.row.code}-X`);
  });

  it("previews without persisting and without an ETag", async () => {
    const saved = await seedRestProduct(a);
    const response = await patchProductRest(a, saved.row.id, { status: "sold" }, saved.etag, "?dryRun=true");
    expect(response.status).toBe(200);
    expect(response.headers.get("dry-run")).toBe("true");
    expect(response.headers.has("etag")).toBe(false);
    expect((await response.json()).data).toMatchObject({ status: "sold", version: 2 });
    expect(await db.select().from(biocharProducts).where(eq(biocharProducts.id, saved.row.id))).toMatchObject([{ status: "testing", version: 1 }]);
  });

  it("requires If-Match and returns the current representation on a stale version or revision", async () => {
    const saved = await seedRestProduct(a);
    await expectProblem(await patchProductRest(a, saved.row.id, {}), 428, "precondition_required");
    await expectProblem(await patchProductRest(a, saved.row.id, {}, "*"), 428, "strong_etag_required");
    const changed = await patchProductRest(a, saved.row.id, { status: "ready" }, saved.etag);
    const current = (await changed.json()).data;
    for (const tag of [saved.etag, '"2.99"']) {
      const refusal = await expectProblem(await patchProductRest(a, saved.row.id, { status: "sold" }, tag), 412, "stale_version");
      expect(refusal.current).toEqual(current);
    }
    expect(requiredEtag(await patchProductRest(a, saved.row.id, {}, '"2.1"'))).toBe('"3.1"');
  });

  it.each([
    "facilityId", "formulationId", "placedAt", "storageLocationId", "sourceBiocharStorageLocationId", "massKg", "biocharWetMassKg",
    "moistureContentPercent", "waterAddedKg", "composition", "expectedVersion", "biocharProductId", "linkedProductionRunId",
  ])("rejects %s as an unknown key", async (key) => {
    const saved = await seedRestProduct(a);
    const refusal = await expectProblem(await patchProductRest(a, saved.row.id, { [key]: key === "composition" ? {} : "x" }, saved.etag), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${key}`, code: "unknown_field" }));
    expect((await readRestProduct(a, saved.row.id)).etag).toBe(saved.etag);
  });

  it("answers 404 for a code, an unknown id and another organization's product", async () => {
    const saved = await seedRestProduct(a);
    const other = await seedRestProduct(b);
    for (const id of [saved.row.code, randomUUID(), other.row.id]) {
      const refusal = await expectProblem(await patchProductRest(a, id, { status: "ready" }, '"1.1"'), 404, "not_found");
      // Both organizations' first product is BP-26-001; `instance` only echoes the path this caller sent.
      const problem = { ...refusal, instance: undefined };
      expect(JSON.stringify(problem)).not.toContain(other.row.code);
    }
    expect((await readRestProduct(b, other.row.id)).etag).toBe(other.etag);
  });

  it("refuses the write scope's absence", async () => {
    const saved = await seedRestProduct(a);
    const reader = await createApiKey(a.ctx, { name: "Reader", scopes: ["biochar-products:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const request = new Request(`http://localhost:3100/api/v1/biochar-products/${saved.row.id}`, {
      method: "PATCH", headers: { authorization: `Bearer ${reader.key}`, "content-type": "application/json", "if-match": saved.etag }, body: JSON.stringify({ status: "ready" }),
    });
    await expectProblem(await PATCH(request, { params: Promise.resolve({ idOrCode: saved.row.id }) }), 403, "missing_scope");
  });
});
