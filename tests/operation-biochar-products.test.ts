import { feedstockFixtureValues } from "./helpers/feedstock-fixture";
/**
 * `make_biochar_product` and `update_biochar_product` against PostgreSQL,
 * through the operation runner: Pure and blended products, the blend derived
 * as the form derives it, the optional stock basis (decision 53), typed
 * shortages, future placements (decision 56), edits, certified lineage, and
 * retries at the code savepoint and around the whole transaction (astra
 * finding 5). The biochar bin holds R1 (900 kg dry at 10%, placed
 * 2026-09-09) and R2 (600 kg dry at 20%, placed 2026-09-11); facilities are UTC.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements, biocharProducts, biocharProductSourceAllocations, facilities, feedstocks, feedstockTypes, formulationIngredients, outputStockAllocations, productIngredientSnapshots, storageLocations,
  type BiocharProduct,
} from "@/db/schema";
import { generateNextCodes } from "@/data-access/code-generator";
import { getOutputBinAllLayersDryKg } from "@/data-access/output-stock";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { fromCompositionJsonb } from "@/lib/biochar-composition";
import { deriveSourceBiocharMassKg } from "@/lib/biochar-composition/composition";
import { prepareBiocharProductSubmission } from "@/lib/biochar-composition/product-submission";
import { makeBiocharProduct, updateBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperation, runOperationInProcess, type Operation } from "@/lib/operations/runner";
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import { certifyOutputLineage, cleanupCertifiedOutputLineage, LINEAGE_LOCKED_COPY } from "./helpers/certified-output-lineage";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";

type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;
type Created = Awaited<ReturnType<typeof makeBiocharProduct.execute>>;

const PLACED_AT = "2026-09-12T12:00:00.000Z";
/** After R1 is placed and before R2 is. */
const BEFORE_R2 = "2026-09-10";
const LOCAL_TIME = "12:00";
const BIN_DRY_KG = 1500;
const R1_DRY_KG = 900;
/** 1,000 kg wet at 10% is R1's 900 kg of solids. */
const R1_WET_KG = 1000;
const BIOCHAR_WET_KG = 500;
const BIOCHAR_MOISTURE = 10;
const BIOCHAR_DRY_KG = 450;
const INGREDIENT_STOCK_KG = 100;
const INGREDIENT_MOISTURE = 20;
const INGREDIENT_WET_KG = 50;
const INGREDIENT_DRY_KG = 40;
const WATER_KG = 25;
/** An hour before the placement, so every product planned after it sees the loss. */
const LOSS_AT = "2026-09-12T11:00:00.000Z";
const LOSS_WET_KG = 100;
const LOSS_DRY_KG = 90;
const FUTURE_MS = 60_000;
const DAY_MS = 86_400_000;
const RETRYABLE = { code: "40001" };
const BARRIER_CONNECTIONS = 2;
const VERSION_STEP = 1;
const DENSITY_KG_M3 = 600;

const fixtures: Fixture[] = [];
let barrierPool: Pool;
beforeAll(() => { barrierPool = createTestPool(BARRIER_CONNECTIONS); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await cleanupCertifiedOutputLineage(f.ctx.organizationId);
    await cleanupOutputStockFixture(db, f.ctx.organizationId);
  }
});
afterAll(async () => {
  await barrierPool.end();
});

/** Parents, a Pure product bin, and a blend ingredient bin holding 100 kg wet at 20%. */
async function fixture() {
  const f = await seedOutputStockParents(db);
  fixtures.push(f);
  const organizationId = f.ctx.organizationId;
  const [pureBin] = await db.insert(storageLocations).values({ organizationId, facilityId: f.facility.id, formulationId: f.pure.id,
    code: `E2E-BP-PB-${f.tag}`, name: `E2E Pure bin ${f.tag}`, type: "product_bin" }).returning();
  const [ingredientBin] = await db.insert(storageLocations).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: f.ingredientType.id,
    code: `E2E-BP-IB-${f.tag}`, name: `E2E Ingredient bin ${f.tag}`, type: "feedstock_bin" }).returning();
  await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId, facilityId: f.facility.id, code: `E2E-BP-IN-${f.tag}`, status: "complete", feedstockTypeId: f.ingredientType.id,
    storageLocationId: ingredientBin.id, massWetKg: INGREDIENT_STOCK_KG, massDryKg: INGREDIENT_STOCK_KG * (1 - INGREDIENT_MOISTURE / 100),
    moistureContentPercent: INGREDIENT_MOISTURE, deliveryDate: new Date("2026-09-01") }));
  return { ...f, pureBin, ingredientBin, r1: f.runs[0].id, r2: f.runs[1].id };
}
type ProductFixture = Awaited<ReturnType<typeof fixture>>;

const pure = (f: ProductFixture, changes: Record<string, unknown> = {}) => ({
  facilityId: f.facility.id, formulationId: f.pure.id, placedAt: PLACED_AT, sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.pureBin.id,
  biocharWetMassKg: BIOCHAR_WET_KG, biocharMoisturePercent: BIOCHAR_MOISTURE, waterAddedKg: 0, ...changes,
});
const blended = (f: ProductFixture, changes: Record<string, unknown> = {}) => ({
  ...pure(f), formulationId: f.recipe.id, storageLocationId: f.bin.id, waterAddedKg: WATER_KG,
  ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: f.ingredientBin.id, wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE }],
  ...changes,
});
const loss = (f: ProductFixture) => ({ storageLocationId: f.source.id, kind: "loss", occurredAt: LOSS_AT, wetMassKg: LOSS_WET_KG, moisturePercent: BIOCHAR_MOISTURE, reason: "E2E spilled" });

const sourceStock = (f: ProductFixture) => getOutputBinAllLayersDryKg(f.ctx, f.source.id, db);
const ingredientStock = async (f: ProductFixture) => (await getStorageLocationWithFacility(f.ctx, f.ingredientBin.id)).feedstockInventory.currentWetMassKg;
const productsOf = (f: ProductFixture) => db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId));
const movementsOf = (f: ProductFixture) => db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId));
const sourceShares = async (f: ProductFixture, productId: string) => (await db.select().from(biocharProductSourceAllocations)
  .where(and(eq(biocharProductSourceAllocations.organizationId, f.ctx.organizationId), eq(biocharProductSourceAllocations.biocharProductId, productId))))
  .map(share => [share.productionRunId, share.allocatedDryMassKg]).sort();
const orphanAllocations = async (f: ProductFixture) => (await db.execute<{ count: number }>(sql`select count(*)::int as count from output_stock_allocations a
  where a.organization_id = ${f.ctx.organizationId} and not exists (select 1 from bin_movements m where m.id = a.movement_id)`)).rows[0].count;
const locked = { code: "certification_locked", message: expect.stringContaining(LINEAGE_LOCKED_COPY) };

describe("creating products", () => {
  it("creates a Pure biochar product from the oldest run and records the basis it returns", async () => {
    const f = await fixture();
    const result = await runOperation(makeBiocharProduct, f.ctx, pure(f));
    const { product, basisFingerprint } = result.data;
    expect(product).toMatchObject({ code: expect.stringMatching(/^BP-\d{2}-001$/), status: "testing", massKg: BIOCHAR_WET_KG, moistureContentPercent: BIOCHAR_MOISTURE,
      formulationId: f.pure.id, storageLocationId: f.pureBin.id, linkedProductionRunId: f.r1, placedAt: PLACED_AT });
    expect(await sourceStock(f)).toBe(BIN_DRY_KG - BIOCHAR_DRY_KG);
    expect(await sourceShares(f, product.id)).toEqual([[f.r1, BIOCHAR_DRY_KG]]);
    const [movement] = await movementsOf(f);
    expect(movement).toMatchObject({ outputKind: "production_draw", basisFingerprint });
    expect(movement.idempotencyKey).toMatch(/^api:/);
  });

  it("creates a blended product: the stored blend, the formulation line snapshot and the ingredient draw", async () => {
    const f = await fixture();
    const { product } = (await runOperation(makeBiocharProduct, f.ctx, blended(f))).data;
    expect(product).toMatchObject({ massKg: BIOCHAR_WET_KG + INGREDIENT_WET_KG, waterAddedKg: WATER_KG, biocharRatio: f.recipe.biocharRatio });
    expect(product.composition).toMatchObject({ ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id,
      feedstockTypeName: f.ingredientType.name, feedstockTypeCategory: f.ingredientType.category, ratio: f.ingredient.ratio,
      storageLocationId: f.ingredientBin.id, massKg: INGREDIENT_WET_KG, massDryKg: INGREDIENT_DRY_KG, moistureContentPercent: INGREDIENT_MOISTURE }] });
    const snapshots = await db.select().from(productIngredientSnapshots).where(eq(productIngredientSnapshots.biocharProductId, product.id));
    expect(snapshots).toEqual([expect.objectContaining({ wetMassKg: "50.000", drySolidsKg: "40.000", moisturePercentUsed: INGREDIENT_MOISTURE, sourceStorageLocationId: f.ingredientBin.id })]);
    expect(await ingredientStock(f)).toBe(INGREDIENT_STOCK_KG - INGREDIENT_WET_KG);
    expect(await sourceStock(f)).toBe(BIN_DRY_KG - BIOCHAR_DRY_KG);
  });

  it("stores the blend exactly as the form's submission derives it, and the form's mapping round-trips", async () => {
    const f = await fixture();
    const biocharWetMassKg = 100.105;
    const ingredientWetKg = 0.335;
    const formBlend = prepareBiocharProductSubmission({ massKg: biocharWetMassKg,
      ingredientBins: [{ formulationIngredientId: f.ingredient.id, massKg: ingredientWetKg }] } as BiocharProductFormData, false).massKg;
    const ingredients = [{ formulationIngredientId: f.ingredient.id, storageLocationId: f.ingredientBin.id, wetMassKg: ingredientWetKg, moisturePercent: INGREDIENT_MOISTURE }];
    const { product } = (await runOperation(makeBiocharProduct, f.ctx, blended(f, { biocharWetMassKg, ingredients }))).data;
    expect(Object.is(product.massKg, formBlend)).toBe(true);
    // The UI action hands the operation the form's blend less its ingredients.
    expect(deriveSourceBiocharMassKg(formBlend, [{ massKg: ingredientWetKg }])).toBe(biocharWetMassKg);
  });

  it("replays a form request key without a second product, and refuses it with different values", async () => {
    const f = await fixture();
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey }));
    const replay = await runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey }));
    expect(replay.product.id).toBe(first.product.id);
    expect(replay.basisFingerprint).toBe(first.basisFingerprint);
    expect(await productsOf(f)).toHaveLength(1);
    await expect(runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey, biocharWetMassKg: BIOCHAR_WET_KG + 1 })))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("replays a blended form request after the ingredient's name and ratio change", async () => {
    const f = await fixture();
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey }));
    await db.update(feedstockTypes).set({ name: `Renamed ${f.tag}` }).where(eq(feedstockTypes.id, f.ingredientType.id));
    await db.update(formulationIngredients).set({ ratio: 0.3 }).where(eq(formulationIngredients.id, f.ingredient.id));
    const replay = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey }));
    expect(replay.product.id).toBe(first.product.id);
    expect(await productsOf(f)).toHaveLength(1);
  });

  it("replays a blended form request after the formulation's lines change order", async () => {
    const f = await fixture();
    const organizationId = f.ctx.organizationId;
    const [secondType] = await db.insert(feedstockTypes).values({ organizationId, code: `E2E-BP-T2-${f.tag}`, name: `E2E Second ${f.tag}`, category: "compost", usage: "blend" }).returning();
    const [secondBin] = await db.insert(storageLocations).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: secondType.id,
      code: `E2E-BP-IB2-${f.tag}`, name: `E2E Second bin ${f.tag}`, type: "feedstock_bin" }).returning();
    await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId, facilityId: f.facility.id, code: `E2E-BP-IN2-${f.tag}`, status: "complete", feedstockTypeId: secondType.id,
      storageLocationId: secondBin.id, massWetKg: INGREDIENT_STOCK_KG, massDryKg: INGREDIENT_STOCK_KG * (1 - INGREDIENT_MOISTURE / 100),
      moistureContentPercent: INGREDIENT_MOISTURE, deliveryDate: new Date("2026-09-01") }));
    const [second] = await db.insert(formulationIngredients).values({ organizationId, formulationId: f.recipe.id, feedstockTypeId: secondType.id, ratio: 0.1 }).returning();
    await db.update(formulationIngredients).set({ sortOrder: 0 }).where(eq(formulationIngredients.id, f.ingredient.id));
    await db.update(formulationIngredients).set({ sortOrder: 1 }).where(eq(formulationIngredients.id, second.id));
    const ingredients = [
      { formulationIngredientId: f.ingredient.id, storageLocationId: f.ingredientBin.id, wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE },
      { formulationIngredientId: second.id, storageLocationId: secondBin.id, wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE },
    ];
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey, ingredients }));
    await db.update(formulationIngredients).set({ sortOrder: 1 }).where(eq(formulationIngredients.id, f.ingredient.id));
    await db.update(formulationIngredients).set({ sortOrder: 0 }).where(eq(formulationIngredients.id, second.id));
    const replay = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey, ingredients }));
    expect(replay.product.id).toBe(first.product.id);
    expect(await productsOf(f)).toHaveLength(1);
  });

  // api/product-replay-recipe-edit: the committed product is looked up before the live recipe and facility checks.
  it("replays a blended form request after a formulation line is added", async () => {
    const f = await fixture();
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey }));
    const [secondType] = await db.insert(feedstockTypes).values({ organizationId: f.ctx.organizationId, code: `E2E-BP-T2-${f.tag}`, name: `E2E Second ${f.tag}`, category: "compost", usage: "blend" }).returning();
    await db.insert(formulationIngredients).values({ organizationId: f.ctx.organizationId, formulationId: f.recipe.id, feedstockTypeId: secondType.id, ratio: 0.1 });
    const replay = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey }));
    expect(replay.product.id).toBe(first.product.id);
    expect(replay.basisFingerprint).toBe(first.basisFingerprint);
    // A new request is checked against the recipe as it now stands.
    await expect(runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey: randomUUID() })))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["ingredients"] }] });
    expect(await productsOf(f)).toHaveLength(1);
    expect(await ingredientStock(f)).toBe(INGREDIENT_STOCK_KG - INGREDIENT_WET_KG);
  });

  it("replays a blended form request after a formulation line is removed", async () => {
    const f = await fixture();
    const organizationId = f.ctx.organizationId;
    const [secondType] = await db.insert(feedstockTypes).values({ organizationId, code: `E2E-BP-T2-${f.tag}`, name: `E2E Second ${f.tag}`, category: "compost", usage: "blend" }).returning();
    const [second] = await db.insert(formulationIngredients).values({ organizationId, formulationId: f.recipe.id, feedstockTypeId: secondType.id, ratio: 0.1 }).returning();
    // A line recorded at 0 kg keeps no ingredient snapshot, so the recipe can drop it afterwards.
    const ingredients = [...blended(f).ingredients, { formulationIngredientId: second.id, storageLocationId: null, wetMassKg: 0 }];
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey, ingredients }));
    await db.delete(formulationIngredients).where(and(eq(formulationIngredients.organizationId, organizationId), eq(formulationIngredients.id, second.id)));
    const replay = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey, ingredients }));
    expect(replay.product.id).toBe(first.product.id);
    await expect(runOperationInProcess(makeBiocharProduct, f.ctx, blended(f, { idempotencyKey: randomUUID(), ingredients })))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["ingredients", 1, "formulationIngredientId"] }] });
    expect(await productsOf(f)).toHaveLength(1);
  });

  it("replays a form request after its facility is archived", async () => {
    const f = await fixture();
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey }));
    await db.update(facilities).set({ archivedAt: new Date() }).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id)));
    const replay = await runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey }));
    expect(replay.product.id).toBe(first.product.id);
    await expect(runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey: randomUUID() })))
      .rejects.toMatchObject({ code: "not_found", issues: [{ path: ["facilityId"] }] });
    // Different facts under the same key stay a conflict, before the archived facility is read.
    await expect(runOperationInProcess(makeBiocharProduct, f.ctx, pure(f, { idempotencyKey, biocharWetMassKg: BIOCHAR_WET_KG + 1 })))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await productsOf(f)).toHaveLength(1);
    expect(await sourceStock(f)).toBe(BIN_DRY_KG - BIOCHAR_DRY_KG);
  });

  it("never replays another organization's product under the same request key", async () => {
    const a = await fixture();
    const b = await fixture();
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(makeBiocharProduct, a.ctx, pure(a, { idempotencyKey }));
    // A's exact facts are foreign ids to B, so the early lookup finds nothing and the live checks refuse them.
    await expect(runOperationInProcess(makeBiocharProduct, b.ctx, pure(a, { idempotencyKey }))).rejects.toMatchObject({ code: "not_found" });
    const own = await runOperationInProcess(makeBiocharProduct, b.ctx, pure(b, { idempotencyKey }));
    expect(own.product.id).not.toBe(first.product.id);
    expect(await productsOf(a)).toHaveLength(1);
    expect(await productsOf(b)).toHaveLength(1);
  });
});

describe("dry runs and the optional stock basis (decision 53)", () => {
  it("previews the product it writes, with every affected bin, and rolls back", async () => {
    const f = await fixture();
    const dry = await runOperation(makeBiocharProduct, f.ctx, blended(f), { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(await productsOf(f)).toEqual([]);
    expect(await movementsOf(f)).toEqual([]);
    const effects = new Map(dry.stockEffects!.map(effect => [effect.storageLocationId, effect]));
    expect([...effects.keys()].sort()).toEqual([f.source.id, f.bin.id, f.ingredientBin.id].sort());
    expect(effects.get(f.source.id)).toMatchObject({ stockKind: "biochar_bin", delta: { dryKg: -BIOCHAR_DRY_KG } });
    expect(effects.get(f.ingredientBin.id)).toMatchObject({ stockKind: "feedstock_bin", delta: { wetKg: -INGREDIENT_WET_KG } });
    const written = await runOperation(makeBiocharProduct, f.ctx, blended(f, { basisFingerprint: dry.data.basisFingerprint }));
    expect(written.data.basisFingerprint).toBe(dry.data.basisFingerprint);
    const sameFacts = ({ code, massKg, moistureContentPercent, productionDate, composition }: typeof dry.data.product) => ({ code, massKg, moistureContentPercent, productionDate, composition });
    expect(sameFacts(written.data.product)).toEqual(sameFacts(dry.data.product));
    expect(await sourceStock(f)).toBe(effects.get(f.source.id)!.after.dryKg);
  });

  it("returns one fingerprint for the same stock, however the placement is written", async () => {
    const f = await fixture();
    const utc = await runOperation(makeBiocharProduct, f.ctx, pure(f), { dryRun: true });
    const local = await runOperation(makeBiocharProduct, f.ctx, pure(f, { placedAt: { date: PLACED_AT.slice(0, 10), time: LOCAL_TIME } }), { dryRun: true });
    const offset = await runOperation(makeBiocharProduct, f.ctx, pure(f, { placedAt: "2026-09-12T15:00:00+03:00" }), { dryRun: true });
    expect(local.data.basisFingerprint).toBe(utc.data.basisFingerprint);
    expect(offset.data.basisFingerprint).toBe(utc.data.basisFingerprint);
  });

  it("refuses a stale fingerprint with stock_basis_changed and the bin conflict, writing nothing", async () => {
    const f = await fixture();
    const dry = await runOperation(makeBiocharProduct, f.ctx, pure(f), { dryRun: true });
    await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    const before = await movementsOf(f);
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { basisFingerprint: dry.data.basisFingerprint })))
      .rejects.toMatchObject({ code: "stock_basis_changed", conflict: { entity: "storageLocation" } });
    expect(await movementsOf(f)).toHaveLength(before.length);
    expect(await productsOf(f)).toEqual([]);
  });

  it("draws current stock under the bin lock without a fingerprint", async () => {
    const f = await fixture();
    await runOperation(makeBiocharProduct, f.ctx, pure(f), { dryRun: true });
    await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    const { product } = (await runOperation(makeBiocharProduct, f.ctx, pure(f, { biocharWetMassKg: R1_WET_KG }))).data;
    // R1 lost 90 kg first, so 810 kg come from R1 and 90 kg from R2.
    expect(await sourceShares(f, product.id)).toEqual([[f.r1, R1_DRY_KG - LOSS_DRY_KG], [f.r2, LOSS_DRY_KG]].sort());
  });
});

describe("typed shortages (astra finding 3)", () => {
  it("answers a short source bin, Pure or blended, as insufficient_stock in dry biochar", async () => {
    const f = await fixture();
    const shortage = { code: "insufficient_stock", issues: [{ path: ["biocharWetMassKg"],
      meta: { storageLocationId: f.source.id, measure: "dry_biochar", availableSolidsKg: BIN_DRY_KG, requestedSolidsKg: BIN_DRY_KG * 2, unit: "kg" } }] };
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { biocharWetMassKg: BIN_DRY_KG * 2, biocharMoisturePercent: 0 }))).rejects.toMatchObject(shortage);
    await expect(runOperation(makeBiocharProduct, f.ctx, blended(f, { biocharWetMassKg: BIN_DRY_KG * 2, biocharMoisturePercent: 0 }))).rejects.toMatchObject(shortage);
    expect(await productsOf(f)).toEqual([]);
  });

  it("answers an overdrawn chosen sub-bin as insufficient_stock on its sources entry", async () => {
    const f = await fixture();
    // 1,100 kg at 10% is 990 kg of solids from R1 alone, which holds 900 kg.
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { biocharMoisturePercent: undefined, biocharWetMassKg: 1100, sources: [{ layerId: f.r1, moisturePercent: BIOCHAR_MOISTURE }] })))
      .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["sources", 0], meta: { layerId: f.r1, measure: "dry_biochar", availableSolidsKg: R1_DRY_KG } }] });
  });

  it("keeps a sub-bin the load never reaches a validation failure", async () => {
    const f = await fixture();
    // R2 holds 750 kg wet at 20%, so 500 kg is used up before it reaches R1.
    const sources = [{ layerId: f.r2, moisturePercent: 20 }, { layerId: f.r1, moisturePercent: BIOCHAR_MOISTURE }];
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { biocharMoisturePercent: undefined, sources })))
      .rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("Untick") });
  });

  it("answers a short ingredient bin as insufficient_stock in ingredient wet stock", async () => {
    const f = await fixture();
    const ingredients = [{ formulationIngredientId: f.ingredient.id, storageLocationId: f.ingredientBin.id, wetMassKg: INGREDIENT_STOCK_KG + INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE }];
    await expect(runOperation(makeBiocharProduct, f.ctx, blended(f, { ingredients }))).rejects.toMatchObject({ code: "insufficient_stock",
      issues: [{ path: ["ingredients", 0, "wetMassKg"], meta: { storageLocationId: f.ingredientBin.id, measure: "ingredient_wet_stock",
        availableWetKg: INGREDIENT_STOCK_KG, requestedWetKg: INGREDIENT_STOCK_KG + INGREDIENT_WET_KG, unit: "kg" } }] });
    expect(await ingredientStock(f)).toBe(INGREDIENT_STOCK_KG);
  });
});

describe("placement times (decision 56)", () => {
  it("refuses a future placement, as an instant or a facility-local time, on writes and dry runs", async () => {
    const f = await fixture();
    const future = new Date(Date.now() + FUTURE_MS).toISOString();
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { placedAt: future }))).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["placedAt"] }] });
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { placedAt: { date: tomorrow, time: LOCAL_TIME } }))).rejects.toMatchObject({ code: "validation_failed" });
    await expect(runOperation(makeBiocharProduct, f.ctx, pure(f, { placedAt: future }), { dryRun: true })).rejects.toMatchObject({ code: "validation_failed" });
    expect(await movementsOf(f)).toEqual([]);
  });

  it("allows a backdated placement, drawing only what the bin held then", async () => {
    const f = await fixture();
    const { product } = (await runOperation(makeBiocharProduct, f.ctx, pure(f, { placedAt: { date: BEFORE_R2, time: LOCAL_TIME } }))).data;
    expect(product.placedAt).toBe(`${BEFORE_R2}T12:00:00.000Z`);
    expect(await sourceShares(f, product.id)).toEqual([[f.r1, BIOCHAR_DRY_KG]]);
  });
});

describe("editing products", () => {
  const make = async (f: ProductFixture) => (await runOperationInProcess(makeBiocharProduct, f.ctx, pure(f))).product;

  it("writes code, status and density and bumps the version", async () => {
    const f = await fixture();
    const product = await make(f);
    const saved = await runOperationInProcess(updateBiocharProduct, f.ctx, { biocharProductId: product.id, expectedVersion: product.version,
      code: `E2E-BP-${f.tag}`, status: "ready", densityKgM3: DENSITY_KG_M3 });
    expect(saved).toMatchObject({ code: `E2E-BP-${f.tag}`, status: "ready", densityKgM3: DENSITY_KG_M3, version: product.version + VERSION_STEP, massKg: product.massKg });
    const cleared = await runOperationInProcess(updateBiocharProduct, f.ctx, { biocharProductId: product.id, expectedVersion: saved.version, densityKgM3: null });
    expect(cleared).toMatchObject({ densityKgM3: null, status: "ready" });
  });

  it("edits status without changing a legacy ingredient's null moisture", async () => {
    const f = await fixture();
    const { product } = await runOperationInProcess(makeBiocharProduct, f.ctx, blended(f));
    const composition = { ingredients: fromCompositionJsonb(product.composition).map(ingredient => ({
      ...ingredient, moistureContentPercent: null,
    })) };
    await db.update(biocharProducts).set({ composition }).where(and(
      eq(biocharProducts.organizationId, f.ctx.organizationId), eq(biocharProducts.id, product.id),
    ));

    const saved = await runOperationInProcess(updateBiocharProduct, f.ctx, {
      biocharProductId: product.id, expectedVersion: product.version, status: "ready", composition,
    });
    expect(saved).toMatchObject({ status: "ready", version: product.version + VERSION_STEP, composition });
    expect((await productsOf(f))[0].composition).toEqual(composition);
    await expect(runOperationInProcess(updateBiocharProduct, f.ctx, {
      biocharProductId: product.id, expectedVersion: saved.version, composition: product.composition,
    })).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("immutable") });
  });

  it("refuses a stale version and an unknown product", async () => {
    const f = await fixture();
    const product = await make(f);
    await expect(runOperation(updateBiocharProduct, f.ctx, { biocharProductId: product.id, expectedVersion: product.version + VERSION_STEP, status: "ready" }))
      .rejects.toMatchObject({ code: "stale_version" });
    await expect(runOperation(updateBiocharProduct, f.ctx, { biocharProductId: randomUUID(), expectedVersion: 1, status: "ready" }))
      .rejects.toMatchObject({ code: "not_found", issues: [{ path: ["biocharProductId"] }] });
  });

  it("refuses changing the facts the product's stock was drawn on", async () => {
    const f = await fixture();
    const product = await make(f);
    for (const change of [{ massKg: BIOCHAR_WET_KG + 1 }, { storageLocationId: f.bin.id }, { placedAt: "2026-09-13T12:00:00.000Z" }, { formulationId: f.recipe.id }]) {
      await expect(runOperationInProcess(updateBiocharProduct, f.ctx, { biocharProductId: product.id, expectedVersion: product.version, ...change }))
        .rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("immutable") });
    }
    // The edit form resends them unchanged; that is not a change.
    await runOperationInProcess(updateBiocharProduct, f.ctx, { biocharProductId: product.id, expectedVersion: product.version,
      massKg: product.massKg!, storageLocationId: product.storageLocationId, placedAt: PLACED_AT, status: "ready" });
  });
});

describe("certified lineage", () => {
  it("refuses editing a product in submitted certification lineage", async () => {
    const f = await fixture();
    const { product } = (await runOperation(makeBiocharProduct, f.ctx, pure(f))).data;
    await certifyOutputLineage(f, { runId: f.r1, productId: product.id, deliveryBinId: f.pureBin.id, submitted: true });
    await expect(runOperation(updateBiocharProduct, f.ctx, { biocharProductId: product.id, expectedVersion: product.version, status: "ready" })).rejects.toMatchObject(locked);
  });

  it("still draws a certified run's remaining stock: certification freezes records, not the stock left in the bin", async () => {
    const f = await fixture();
    await certifyOutputLineage(f, { runId: f.r1, submitted: true });
    const { product } = (await runOperation(makeBiocharProduct, f.ctx, pure(f))).data;
    expect(await sourceShares(f, product.id)).toEqual([[f.r1, BIOCHAR_DRY_KG]]);
  });
});

describe("retries (astra finding 5)", () => {
  it("retries a code collision in a fresh savepoint that plans on the stock an intervening writer left", async () => {
    const f = await fixture();
    const [taken] = await generateNextCodes(f.ctx, "BP", biocharProducts, biocharProducts.code, 1);
    const barrier = await openOperationBarrier(barrierPool);
    const create = () => runOperation(makeBiocharProduct, f.ctx, pure(f, { biocharWetMassKg: R1_WET_KG }));
    let pending: ReturnType<typeof create> | undefined;
    let writer: Promise<unknown> | undefined;
    try {
      // Uncommitted, the code still reads as free; the first attempt's insert then waits on this row.
      // Archived so this code-reservation fixture is not an active stock layer.
      await barrier.tx.insert(biocharProducts).values({ organizationId: f.ctx.organizationId, code: taken, facilityId: f.facility.id,
        formulationId: f.pure.id, placedAt: new Date(PLACED_AT), productionDate: new Date(PLACED_AT),
        massKg: 1, moistureContentPercent: 0, waterAddedKg: 0, archivedAt: new Date(PLACED_AT), storageLocationId: f.pureBin.id, sourceBiocharStorageLocationId: f.source.id });
      pending = create();
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      // The intervening loss queues on the source bin lock the first attempt holds inside its savepoint.
      writer = runOperation(recordOutputStockMovement, f.ctx, loss(f));
      await waitForBlockedOperations(barrierPool, barrier.pid, 2);
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([pending, writer]);
      throw error;
    }
    await writer;
    const created = (await pending!).data;
    expect(created.product.code).not.toBe(taken);
    // The retry saw the loss: 810 kg from R1 and 90 kg from R2, not 900 kg from R1.
    expect(await sourceShares(f, created.product.id)).toEqual([[f.r1, R1_DRY_KG - LOSS_DRY_KG], [f.r2, LOSS_DRY_KG]].sort());
    expect(await sourceStock(f)).toBe(BIN_DRY_KG - LOSS_DRY_KG - R1_DRY_KG);
    const posted = await productsOf(f);
    expect(posted.filter(p => !p.archivedAt).map(p => p.id)).toEqual([created.product.id]);
    expect((await movementsOf(f)).map(m => m.outputKind).sort()).toEqual(["loss", "production_draw"]);
    expect(await orphanAllocations(f)).toBe(0);
    const shares = await db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.organizationId, f.ctx.organizationId));
    expect(new Set(shares.map(share => share.biocharProductId))).toEqual(new Set([created.product.id]));
  });

  it("commits one blended product with the final attempt's effects after a retryable failure once writes began", async () => {
    const f = await fixture();
    let attempts = 0;
    const flaky: Operation<typeof makeBiocharProduct.input, Created> = {
      ...makeBiocharProduct,
      execute: async (scope, input) => {
        const created = await makeBiocharProduct.execute(scope, input);
        // Product, draw, allocations and the ingredient snapshot are written; abort before COMMIT.
        if (++attempts === 1) throw RETRYABLE;
        return created;
      },
    };
    const { product } = (await runOperation(flaky, f.ctx, blended(f))).data;
    expect(attempts).toBe(2);
    expect((await productsOf(f)).map((p: BiocharProduct) => p.id)).toEqual([product.id]);
    const [movement, ...others] = await movementsOf(f);
    expect(others).toEqual([]);
    const allocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, f.ctx.organizationId));
    expect(new Set(allocations.map(a => a.movementId))).toEqual(new Set([movement.id]));
    const snapshots = await db.select().from(productIngredientSnapshots).where(eq(productIngredientSnapshots.organizationId, f.ctx.organizationId));
    expect(snapshots.map(s => s.biocharProductId)).toEqual([product.id]);
    expect(await ingredientStock(f)).toBe(INGREDIENT_STOCK_KG - INGREDIENT_WET_KG);
    expect(await sourceStock(f)).toBe(BIN_DRY_KG - BIOCHAR_DRY_KG);
    expect(await orphanAllocations(f)).toBe(0);
  });
});
