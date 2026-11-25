/** Real-DB consumer validation and preview contracts for blend-usage bins. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { feedstocks, storageLocations } from "@/db/schema";
import { validateCompositionIngredientBins } from "@/data-access/biochar-product-composition";
import { previewProductStock } from "@/data-access/product-stock-preview";
import { runOperation } from "@/lib/operations/runner";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { UNCARBONIZED_INGREDIENT_MESSAGE } from "@/lib/uncarbonized-bins";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { feedstockFixtureValues } from "./helpers/feedstock-fixture";

const SUITE_TIMEOUT_MS = 30_000;
const PLACED_AT = "2026-09-12T12:00:00.000Z";
const INGREDIENT_WET_KG = 25;
const SOURCE_WET_KG = 100;
const INGREDIENT_MOISTURE_PERCENT = 20;
let fixture: Awaited<ReturnType<typeof seedOutputStockParents>>;
let taggedId: string;
let ordinaryId: string;

beforeEach(async () => {
  fixture = await seedOutputStockParents(db);
  const bins = await db.insert(storageLocations).values([false, true].map(uncarbonized => ({
    organizationId: fixture.ctx.organizationId, facilityId: fixture.facility.id,
    code: `E2E-SEG-${uncarbonized}-${fixture.tag}`, name: `E2E Segregation ${uncarbonized} ${fixture.tag}`,
    type: "feedstock_bin" as const, feedstockTypeId: fixture.ingredientType.id, uncarbonized,
  }))).returning();
  ordinaryId = bins.find(bin => !bin.uncarbonized)!.id;
  taggedId = bins.find(bin => bin.uncarbonized)!.id;
  // Fixture stock stands for the future failed-run material posting path.
  // Fresh delivery intake into the tagged bin is tested separately and refused.
  await db.insert(feedstocks).values(await feedstockFixtureValues(db, bins.map(bin => ({
    organizationId: fixture.ctx.organizationId, facilityId: fixture.facility.id,
    feedstockTypeId: fixture.ingredientType.id, storageLocationId: bin.id, code: `E2E-SEG-FS-${bin.uncarbonized}-${fixture.tag}`,
    status: "complete" as const, massWetKg: 100, massDryKg: 80, moistureContentPercent: INGREDIENT_MOISTURE_PERCENT,
    deliveryDate: new Date("2026-09-08T00:00:00Z"),
  }))));
}, SUITE_TIMEOUT_MS);
afterEach(async () => {
  if (fixture) await cleanupOutputStockFixture(db, fixture.ctx.organizationId);
}, SUITE_TIMEOUT_MS);

function ingredients(storageLocationId: string) {
  return [{ formulationIngredientId: fixture.ingredient.id, feedstockTypeId: fixture.ingredientType.id,
    storageLocationId, massKg: INGREDIENT_WET_KG, moistureContentPercent: INGREDIENT_MOISTURE_PERCENT }];
}
function preview(storageLocationId: string) {
  return previewProductStock(fixture.ctx, {
    facilityId: fixture.facility.id, formulationId: fixture.recipe.id, placedAt: PLACED_AT,
    sourceBiocharStorageLocationId: fixture.source.id, storageLocationId: fixture.bin.id,
    massKg: SOURCE_WET_KG, moistureContentPercent: 10, waterAddedKg: 0, ingredientBins: ingredients(storageLocationId),
  });
}

describe("uncarbonized formulation segregation", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("refuses tagged blend bins and accepts ordinary matching formulation ingredient bins", async () => {
    await expect(validateCompositionIngredientBins(fixture.ctx, db, { ingredients: ingredients(taggedId) }, fixture.recipe.id, fixture.facility.id))
      .rejects.toThrow(UNCARBONIZED_INGREDIENT_MESSAGE);
    await expect(validateCompositionIngredientBins(fixture.ctx, db, { ingredients: ingredients(ordinaryId) }, fixture.recipe.id, fixture.facility.id))
      .resolves.toBeUndefined();
  });

  it("refuses tagged ingredients in stock previews and in actual product operations", async () => {
    await expect(preview(taggedId)).rejects.toThrow(UNCARBONIZED_INGREDIENT_MESSAGE);
    const fresh = await preview(ordinaryId);
    expect(fresh.some(bin => bin.storageLocationId === ordinaryId && bin.lane === "ingredient")).toBe(true);
    await expect(runOperation(makeBiocharProduct, fixture.ctx, {
      facilityId: fixture.facility.id, formulationId: fixture.recipe.id, placedAt: PLACED_AT,
      sourceBiocharStorageLocationId: fixture.source.id, storageLocationId: fixture.bin.id,
      biocharWetMassKg: SOURCE_WET_KG, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: fixture.ingredient.id, storageLocationId: taggedId,
        wetMassKg: INGREDIENT_WET_KG, moisturePercent: INGREDIENT_MOISTURE_PERCENT }],
    })).rejects.toThrow(UNCARBONIZED_INGREDIENT_MESSAGE);
  });

  it("does not accept a foreign bin as an ingredient", async () => {
    const foreign = await seedOutputStockParents(db);
    try {
      const [foreignBin] = await db.insert(storageLocations).values({ organizationId: foreign.ctx.organizationId,
        facilityId: foreign.facility.id, code: `E2E-FOREIGN-${foreign.tag}`, name: `E2E Foreign ${foreign.tag}`,
        type: "feedstock_bin", feedstockTypeId: foreign.ingredientType.id, uncarbonized: true }).returning();
      await expect(validateCompositionIngredientBins(fixture.ctx, db, { ingredients: ingredients(foreignBin.id) }, fixture.recipe.id, fixture.facility.id))
        .rejects.toThrow("Feedstock bin was not found");
      await expect(preview(foreignBin.id)).rejects.toThrow();
    } finally {
      await cleanupOutputStockFixture(db, foreign.ctx.organizationId);
    }
  });
});
