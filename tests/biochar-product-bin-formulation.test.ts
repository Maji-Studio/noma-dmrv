import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, biocharProductSourceAllocations, feedstocks, feedstockTypes, productIngredientSnapshots, storageLocations } from "@/db/schema";
import { createBiocharProduct, updateBiocharProduct } from "@/data-access/biochar-products";
import { updateFormulation } from "@/data-access/formulations";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { getOutputBinDryBalance } from "@/data-access/output-stock";
import { cleanupPostedStock, postedStockFixture, postProduct, productInput } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
async function fixture() {
  const f = await postedStockFixture({ stockKg: 0 }); fixtures.push(f);
  await db.update(storageLocations).set({ formulationId: f.recipe.id }).where(eq(storageLocations.id, f.bin.id));
  return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function ingredientBin(f: Fixture, wetKg = 100, moisture = 20, typeId = f.ingredientType.id) {
  const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `E2E-INGBIN-${randomUUID()}`, name: `E2E Ingredient bin ${randomUUID()}`, type: "feedstock_bin", feedstockTypeId: typeId }).returning();
  if (wetKg > 0) await intake(f, bin.id, wetKg, moisture);
  return bin;
}
async function intake(f: Fixture, binId: string, wetKg: number, moisture: number, date = "2026-09-01") {
  const [row] = await db.insert(feedstocks).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `E2E-INTAKE-${randomUUID()}`, status: "complete", feedstockTypeId: f.ingredientType.id, storageLocationId: binId,
    massWetKg: wetKg, massDryKg: wetKg * (1 - moisture / 100), moistureContentPercent: moisture, deliveryDate: new Date(date) }).returning();
  return row;
}
function composition(f: Fixture, massKg = 0, binId: string | null = null, extra: Record<string, unknown> = {}) {
  return { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg, storageLocationId: binId, ...extra }] };
}
async function blend(f: Fixture, input: { massKg?: number; composition?: Record<string, unknown>; storageLocationId?: string } = {}) {
  return postProduct(f, { massKg: 100, formulationId: f.recipe.id, composition: composition(f), ...input });
}
async function snapshot(productId: string) { return (await db.select().from(productIngredientSnapshots).where(eq(productIngredientSnapshots.biocharProductId, productId)))[0]; }

describe("posted product bin and formulation contract", () => {
  it("claims an unassigned output bin for the selected formulation", async () => {
    const f = await fixture(); await db.update(storageLocations).set({ formulationId: null }).where(eq(storageLocations.id, f.bin.id));
    const product = await blend(f);
    expect((await db.select().from(storageLocations).where(eq(storageLocations.id, f.bin.id)))[0].formulationId).toBe(f.recipe.id);
    expect(product.biocharRatio).toBe(0.8);
  });
  it("rejects a different formulation in an assigned bin before posting", async () => {
    const f = await fixture();
    await expect(postProduct(f)).rejects.toThrow("product bin for this formulation");
    expect(await getOutputBinDryBalance(f.ctx, f.source.id)).toBe(1500);
  });
  it("rejects a composition that omits a formulation ingredient", async () => {
    const f = await fixture(); await expect(postProduct(f, { formulationId: f.recipe.id })).rejects.toThrow("must include every ingredient");
  });
  it("rejects duplicate ingredient rows before drawing either source", async () => {
    const f = await fixture(); const bin = await ingredientBin(f); const row = composition(f, 20, bin.id).ingredients[0];
    await expect(blend(f, { composition: { ingredients: [row, { ...row }] } })).rejects.toThrow("Each formulation ingredient can appear only once");
    expect((await getStorageLocationWithFacility(f.ctx, bin.id)).feedstockInventory.currentWetMassKg).toBe(100);
    expect(await getOutputBinDryBalance(f.ctx, f.source.id)).toBe(1500);
  });
  it("claims an unassigned bin for the explicit Pure biochar formulation", async () => {
    const f = await fixture(); await db.update(storageLocations).set({ formulationId: null }).where(eq(storageLocations.id, f.bin.id));
    const product = await postProduct(f);
    expect(product.formulationId).toBe(f.pure.id); expect(product.biocharRatio).toBe(1);
    expect((await db.select().from(storageLocations).where(eq(storageLocations.id, f.bin.id)))[0].formulationId).toBe(f.pure.id);
  });
  it("rejects pyrolysis-only feedstock bins as blend ingredient sources", async () => {
    const f = await fixture(); const [type] = await db.insert(feedstockTypes).values({ organizationId: f.ctx.organizationId, code: `E2E-PYRO-${f.tag}`, name: `E2E Pyro ${f.tag}`, category: "forestry", usage: "pyrolysis" }).returning();
    const bin = await ingredientBin(f, 0, 0, type.id);
    await expect(blend(f, { composition: composition(f, 20, bin.id) })).rejects.toThrow("blend-usage");
  });
  it("rejects a blend bin whose held material differs from the recipe line", async () => {
    const f = await fixture(); const [type] = await db.insert(feedstockTypes).values({ organizationId: f.ctx.organizationId, code: `E2E-OTHER-${f.tag}`, name: `E2E Other ${f.tag}`, category: "mineral", usage: "blend" }).returning();
    const bin = await ingredientBin(f, 0, 0, type.id);
    await expect(blend(f, { composition: composition(f, 20, bin.id) })).rejects.toThrow("match the formulation material");
  });
  it("omits moisture snapshots for zero-mass ingredients and keeps their solids at zero", async () => {
    const f = await fixture(); const bin = await ingredientBin(f, 0);
    const product = await blend(f, { composition: composition(f, 0, bin.id) });
    expect(await snapshot(product.id)).toBeUndefined();
    expect(product.composition).toMatchObject({ ingredients: [{ massKg: 0, massDryKg: 0, moistureContentPercent: null }] });
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(100);
  });
  it("requires moisture for a positive ingredient without a usable intake", async () => {
    const f = await fixture(); const bin = await ingredientBin(f, 0);
    await expect(blend(f, { composition: composition(f, 1, bin.id) })).rejects.toThrow("Every positive ingredient requires moisture");
  });
  it("deducts ingredient wet mass and freezes weighted remaining dry solids", async () => {
    const f = await fixture(); const bin = await ingredientBin(f); const product = await blend(f, { composition: composition(f, 50, bin.id) });
    expect(await snapshot(product.id)).toMatchObject({ wetMassKg: "50.000", drySolidsKg: "40.000", moisturePercentUsed: 20, moistureSource: "weighted_remaining" });
    expect((await getStorageLocationWithFacility(f.ctx, bin.id)).feedstockInventory.currentWetMassKg).toBe(50);
  });
  it("keeps posted ingredient moisture unchanged after a later dry intake", async () => {
    const f = await fixture(); const bin = await ingredientBin(f); const product = await blend(f, { composition: composition(f, 50, bin.id) });
    const before = await snapshot(product.id); await intake(f, bin.id, 100, 0, "2026-09-02");
    await updateBiocharProduct(f.ctx, product.id, { code: `E2E-RENAMED-${f.tag}` });
    expect(await snapshot(product.id)).toEqual(before);
    expect((await getStorageLocationWithFacility(f.ctx, bin.id)).feedstockInventory.currentWetMassKg).toBe(150);
  });
  it("prefills from weighted remaining stock, with an explicit operator override for a new blend", async () => {
    const f = await fixture(); const bin = await ingredientBin(f);
    await blend(f, { composition: composition(f, 50, bin.id) }); await intake(f, bin.id, 100, 0, "2026-09-02");
    const product = await blend(f, { composition: composition(f, 30, bin.id) });
    expect(await snapshot(product.id)).toMatchObject({ drySolidsKg: "28.000", moisturePercentUsed: 6.666667 });
    const override = await blend(f, { composition: composition(f, 30, bin.id, { moistureContentPercent: 10, moistureSource: "operator_override" }) });
    expect(await snapshot(override.id)).toMatchObject({ drySolidsKg: "27.000", moisturePercentUsed: 10, moistureSource: "operator_override" });
  });
  it("rejects changing a posted ingredient draw even when later stock is available", async () => {
    const f = await fixture(); const bin = await ingredientBin(f); const product = await blend(f, { composition: composition(f, 60, bin.id) });
    await expect(updateBiocharProduct(f.ctx, product.id, { composition: composition(f, 101, bin.id) })).rejects.toThrow("immutable");
    expect((await getStorageLocationWithFacility(f.ctx, bin.id)).feedstockInventory.currentWetMassKg).toBe(40);
  });
  it("serializes concurrent ingredient draws and leaves no orphan product on rejection", async () => {
    const f = await fixture(); const bin = await ingredientBin(f, 100, 0);
    const inputs = await Promise.all([productInput(f, { formulationId: f.recipe.id, massKg: 100, composition: composition(f, 60, bin.id) }), productInput(f, { formulationId: f.recipe.id, massKg: 100, composition: composition(f, 60, bin.id) })]);
    const results = await Promise.allSettled(inputs.map(input => createBiocharProduct(f.ctx, input)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await getStorageLocationWithFacility(f.ctx, bin.id)).feedstockInventory.currentWetMassKg).toBe(40);
    expect(await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId))).toHaveLength(1);
  });
  it("withdraws saved source dry mass, freezes source shares and rejects dry overdraw", async () => {
    const f = await fixture();
    const product = await blend(f, { massKg: 1600, composition: composition(f, 100, null, { moistureContentPercent: 0, moistureSource: "operator_override" }) });
    const shares = await db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, product.id));
    expect(shares.reduce((sum, row) => sum + row.allocatedDryMassKg, 0)).toBe(1500);
    expect(await getOutputBinDryBalance(f.ctx, f.source.id)).toBe(0);
    await updateFormulation(f.ctx, f.recipe.id, { biocharRatio: 0.7 });
    await expect(updateBiocharProduct(f.ctx, product.id, { composition: composition(f, 105, null, { moistureContentPercent: 0 }) })).rejects.toThrow("immutable");
    expect(await db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, product.id))).toEqual(shares);
    await expect(blend(f, { massKg: 1 })).rejects.toThrow(/Insufficient/);
  });
  it("rejects an all-ingredient product with zero source biochar", async () => {
    const f = await fixture();
    await expect(blend(f, { composition: composition(f, 100, null, { moistureContentPercent: 0 }) })).rejects.toThrow("positive source biochar");
  });
  it("allows manual ingredient moisture without a bin while keeping posted mass immutable", async () => {
    const f = await fixture(); const product = await blend(f, { composition: composition(f, 20, null, { moistureContentPercent: 10, moistureSource: "operator_override" }) });
    expect(await snapshot(product.id)).toMatchObject({ sourceStorageLocationId: null, drySolidsKg: "18.000" });
    await expect(updateBiocharProduct(f.ctx, product.id, { massKg: 110 })).rejects.toThrow("immutable");
  });
  it("retains its ratio snapshot when the live formulation and metadata change", async () => {
    const f = await fixture(); const product = await blend(f); await updateFormulation(f.ctx, f.recipe.id, { biocharRatio: 0.7 });
    const updated = await updateBiocharProduct(f.ctx, product.id, { code: `E2E-RATIO-${f.tag}` }); expect(updated.biocharRatio).toBe(0.8);
  });
  it("prevents a posted product from being reassigned to another formulation", async () => {
    const f = await fixture(); const product = await blend(f);
    await expect(updateBiocharProduct(f.ctx, product.id, { formulationId: f.pure.id })).rejects.toThrow("immutable");
    expect((await db.select().from(biocharProducts).where(eq(biocharProducts.id, product.id)))[0].biocharRatio).toBe(0.8);
  });
});
