import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts, biocharProductSourceAllocations } from "@/db/schema";
import { cleanupOutputStockFixture } from "../../tests/helpers/output-stock-cleanup";
import { seedOutputStockParents } from "../../tests/helpers/output-stock-fixture";
import { getBiocharProducts } from "./biochar-products";
import { getBiocharProductStats } from "./biochar-product-stats";

const PRODUCT_COUNT = 25;
const PAGE_SIZE = 10;
const MASS_KG = 100;
const WATER_KG = 20;
const MOISTURE_PERCENT = 20;
const INGREDIENT_KG = 20;
const DERIVED_DRY_KG = 64;
const ALLOCATED_DRY_KG = [30, 20];
const FIXTURE_DAY = "2026-09-12";
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

describe("getBiocharProductStats whole-facility totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;
  let otherFacilityId: string;

  beforeAll(async () => {
    fixture = await seedOutputStockParents(db);
    const other = await seedOutputStockParents(db, {
      organizationId: fixture.ctx.organizationId,
      userId: fixture.ctx.userId,
    });
    otherFacilityId = other.facility.id;
    foreign = await seedOutputStockParents(db);
    const productValues = (owner: Fixture, code: string, facilityId = owner.facility.id) => ({
      organizationId: owner.ctx.organizationId,
      facilityId,
      code,
      productionDate: FIXTURE_DAY,
      placedAt: FIXTURE_DATE,
      formulationId: owner.recipe.id,
      sourceBiocharStorageLocationId: owner.source.id,
      storageLocationId: owner.bin.id,
      massKg: MASS_KG,
      waterAddedKg: WATER_KG,
      moistureContentPercent: MOISTURE_PERCENT,
      composition: { ingredients: [{
        formulationIngredientId: owner.ingredient.id,
        feedstockTypeId: owner.ingredientType.id,
        feedstockTypeName: owner.ingredientType.name,
        feedstockTypeCategory: owner.ingredientType.category,
        massKg: INGREDIENT_KG,
      }] },
    });
    // org-scope-ok: fixture insert; the values helper sets organizationId
    const active = await db.insert(biocharProducts).values(Array.from({ length: PRODUCT_COUNT }, (_, index) =>
      productValues(fixture, `E2E-PRODUCT-STATS-${fixture.tag}-${index}`),
    )).returning();
    // org-scope-ok: fixture insert; the values helper sets organizationId
    await db.insert(biocharProducts).values([
      { ...productValues(fixture, `E2E-PRODUCT-ARCHIVED-${fixture.tag}`), archivedAt: FIXTURE_DATE },
      productValues(other, `E2E-PRODUCT-OTHER-${fixture.tag}`),
      productValues(foreign, `E2E-PRODUCT-FOREIGN-${foreign.tag}`),
    ]);
    await db.insert(biocharProductSourceAllocations).values(fixture.runs.map((run, index) => ({
      organizationId: fixture.ctx.organizationId,
      biocharProductId: active[0].id,
      productionRunId: run.id,
      sourceStorageLocationId: fixture.source.id,
      allocatedWetMassKg: ALLOCATED_DRY_KG[index],
      allocatedDryMassKg: ALLOCATED_DRY_KG[index],
    })));
  });

  afterAll(async () => {
    if (foreign) await cleanupOutputStockFixture(db, foreign.ctx.organizationId);
    if (fixture) await cleanupOutputStockFixture(db, fixture.ctx.organizationId);
  });

  it("uses every active facility product, composition and allocation snapshots independently of list queries", async () => {
    const scope = { facilityId: fixture.facility.id };
    const expected = {
      totalProducts: PRODUCT_COUNT,
      totalWetMassKg: PRODUCT_COUNT * (MASS_KG + WATER_KG),
      totalDryBiocharMassKg: (PRODUCT_COUNT - 1) * DERIVED_DRY_KG + ALLOCATED_DRY_KG.reduce((sum, mass) => sum + mass, 0),
    };
    expect(await getBiocharProductStats(fixture.ctx, scope)).toEqual(expected);
    const page = await getBiocharProducts(fixture.ctx, { ...scope, page: 1, pageSize: PAGE_SIZE });
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.total).toBe(PRODUCT_COUNT);
    const searched = await getBiocharProducts(fixture.ctx, {
      ...scope, page: 1, pageSize: PAGE_SIZE,
      search: `E2E-PRODUCT-STATS-${fixture.tag}-0`,
    });
    expect(searched.items).toHaveLength(1);
    expect(await getBiocharProductStats(fixture.ctx, scope)).toEqual(expected);
    const nextPage = await getBiocharProducts(fixture.ctx, { ...scope, page: 2, pageSize: PAGE_SIZE });
    expect(nextPage.items).toHaveLength(PAGE_SIZE);
    expect(await getBiocharProductStats(fixture.ctx, scope)).toEqual(expected);
  });

  it("includes the other facility only for organization totals and rejects foreign rows", async () => {
    expect(await getBiocharProductStats(fixture.ctx)).toEqual({
      totalProducts: PRODUCT_COUNT + 1,
      totalWetMassKg: (PRODUCT_COUNT + 1) * (MASS_KG + WATER_KG),
      totalDryBiocharMassKg: PRODUCT_COUNT * DERIVED_DRY_KG + ALLOCATED_DRY_KG.reduce((sum, mass) => sum + mass, 0),
    });
    expect(await getBiocharProductStats(fixture.ctx, { facilityId: otherFacilityId })).toEqual({
      totalProducts: 1,
      totalWetMassKg: MASS_KG + WATER_KG,
      totalDryBiocharMassKg: DERIVED_DRY_KG,
    });
    expect(await getBiocharProductStats(foreign.ctx, { facilityId: fixture.facility.id })).toEqual({
      totalProducts: 0, totalWetMassKg: null, totalDryBiocharMassKg: null,
    });
  });
});
