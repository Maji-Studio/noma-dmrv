import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts, productionRuns, storageLocations } from "@/db/schema";
import { findApiOutputBinStock } from "@/data-access/api-output-bin-stock";
import { archiveFacility, getFacilities } from "@/data-access/facilities";
import { getFacilityOutputStock } from "@/data-access/facility-output-stock";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { rationalToNumber } from "@/lib/output-stock";
import { cleanupPostedStock, postedStockFixture, postDelivery, postMeasurement, postProduct } from "./helpers/posted-output-stock-fixture";

const TIMEOUT_MS = 30_000;
const INITIAL_WET_KG = 1000;
const INITIAL_DRY_BIOCHAR_KG = 800;
const MOISTURE_PERCENT = 20;
const DELIVERED_WET_KG = 200;
const DELIVERED_DRY_BIOCHAR_KG = 160;
const LOST_WET_KG = 50;
const LOST_DRY_BIOCHAR_KG = 40;
const COUNTED_WET_KG = 600;
const COUNTED_DRY_BIOCHAR_KG = 480;
const SOURCE_DRAW_WET_KG = 100;
const SECOND_BIN_WET_KG = 100;
const SECOND_BIN_DRY_BIOCHAR_KG = 80;
const INVALID_INGREDIENT_MASS_KG = -1;

type Fixture = Awaited<ReturnType<typeof postedStockFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupPostedStock(f);
});

async function fixture(productWetKg = INITIAL_WET_KG) {
  const f = await postedStockFixture({ stockKg: 0 });
  fixtures.push(f);
  const product = await postProduct(f, { massKg: productWetKg, moistureContentPercent: MOISTURE_PERCENT });
  return { ...f, product };
}

async function inventory(f: Fixture) {
  return getFacilityOutputStock(f.ctx, f.facility.id);
}

async function binStock(f: Pick<Fixture, "ctx" | "facility">, id: string) {
  const stock = await findApiOutputBinStock(f.ctx, { identifier: { id }, facilityId: f.facility.id });
  expect(stock.status).toBe("resolved");
  expect(stock.totals?.estimatedWetKg).not.toBeNull();
  return {
    wetKg: rationalToNumber(stock.totals!.estimatedWetKg!),
    dryBiocharKg: rationalToNumber(stock.totals!.dryBiocharKg),
  };
}

async function secondProductBin(f: Fixture) {
  const [bin] = await db.insert(storageLocations).values({
    organizationId: f.ctx.organizationId, facilityId: f.facility.id, type: "product_bin",
    code: `E2E-SNAPSHOT-B-${f.tag}`, name: "E2E Second product bin", formulationId: f.pure.id,
  }).returning();
  await postProduct(f, { massKg: SECOND_BIN_WET_KG, moistureContentPercent: MOISTURE_PERCENT, storageLocationId: bin.id });
  return bin;
}

describe("facility inventory snapshot", { timeout: TIMEOUT_MS }, () => {
  it("matches bin stock after a delivery, a loss and a stock count, and stays inside its organization", async () => {
    const f = await fixture();
    const before = await inventory(f);
    const feedstockBefore = (await getFacilities(f.ctx)).items[0].inventorySummary;
    expect(before.product).toEqual({ wetKg: INITIAL_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG });
    expect(before.product).toEqual(await binStock(f, f.bin.id));
    expect(before.biochar).toEqual(await binStock(f, f.source.id));

    await postDelivery(f, DELIVERED_WET_KG, MOISTURE_PERCENT);
    const delivered = await inventory(f);
    expect(delivered.product).toEqual({ wetKg: INITIAL_WET_KG - DELIVERED_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG - DELIVERED_DRY_BIOCHAR_KG });
    expect(delivered.product!.wetKg).toBeLessThan(before.product!.wetKg!);
    expect(delivered.product!.dryBiocharKg).toBeLessThan(before.product!.dryBiocharKg);
    expect(delivered.product).toEqual(await binStock(f, f.bin.id));

    await postMeasurement(f, { kind: "loss", wetMassKg: LOST_WET_KG, moisturePercent: MOISTURE_PERCENT });
    const lost = await inventory(f);
    expect(lost.product).toEqual({ wetKg: INITIAL_WET_KG - DELIVERED_WET_KG - LOST_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG - DELIVERED_DRY_BIOCHAR_KG - LOST_DRY_BIOCHAR_KG });
    expect(lost.product!.wetKg).toBeLessThan(delivered.product!.wetKg!);
    expect(lost.product!.dryBiocharKg).toBeLessThan(delivered.product!.dryBiocharKg);
    expect(lost.product).toEqual(await binStock(f, f.bin.id));

    await postMeasurement(f, { kind: "count", wetMassKg: COUNTED_WET_KG, moisturePercent: MOISTURE_PERCENT });
    const counted = await inventory(f);
    expect(counted.product).toEqual({ wetKg: COUNTED_WET_KG, dryBiocharKg: COUNTED_DRY_BIOCHAR_KG });
    expect(counted.product).toEqual(await binStock(f, f.bin.id));
    expect(counted.biochar).toEqual(before.biochar);
    expect((await getFacilities(f.ctx)).items[0].inventorySummary).toEqual(feedstockBefore);

    const other = await fixture();
    await expect(getFacilityOutputStock(other.ctx, f.facility.id)).rejects.toThrow("Facility was not found in this Organization.");
    await expect(findApiOutputBinStock(other.ctx, { identifier: { id: f.bin.id } })).rejects.toMatchObject({ code: "not_found" });
    const own = await getFacilities(other.ctx);
    expect(own.items.map(row => row.id)).toEqual([other.facility.id]);
    expect(own.items[0].inventorySummary).toEqual({ feedstockWetKg: expect.any(Number) });
    expect((await inventory(other)).product).toEqual({ wetKg: INITIAL_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG });
  });

  it("reports unknown product stock without hiding the known biochar stock", async () => {
    const f = await fixture();
    await secondProductBin(f);
    await db.update(biocharProducts).set({
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, massKg: INVALID_INGREDIENT_MASS_KG }] },
    }).where(and(eq(biocharProducts.id, f.product!.id), eq(biocharProducts.organizationId, f.ctx.organizationId)));
    expect(await inventory(f)).toMatchObject({ product: null, biochar: await binStock(f, f.source.id) });
  });

  it("adds the wet estimates and dry biochar of all bins at the facility", async () => {
    const f = await fixture();
    const second = await secondProductBin(f);
    const stock = await inventory(f);
    expect(stock.product).toEqual({ wetKg: INITIAL_WET_KG + SECOND_BIN_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG + SECOND_BIN_DRY_BIOCHAR_KG });
    const firstStock = await binStock(f, f.bin.id);
    const secondStock = await binStock(f, second.id);
    expect(stock.product).toEqual({ wetKg: firstStock.wetKg + secondStock.wetKg, dryBiocharKg: firstStock.dryBiocharKg + secondStock.dryBiocharKg });
    expect(stock.biochar).toEqual(await binStock(f, f.source.id));
  });

  it("keeps archived output bins in the facility figures", async () => {
    const f = await fixture();
    const before = await inventory(f);
    await db.update(storageLocations).set({ archivedAt: new Date() })
      .where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.facilityId, f.facility.id), eq(storageLocations.id, f.bin.id)));
    expect(await inventory(f)).toEqual(before);
  });

  it.each(["split", "mix"] as const)("matches biochar-bin losses and counts in %s mode", async stockMode => {
    const f = await fixture(SOURCE_DRAW_WET_KG);
    await db.update(storageLocations).set({ stockMode }).where(and(
      eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.source.id),
    ));
    const before = await inventory(f);
    expect(before.biochar).toEqual(await binStock(f, f.source.id));
    expect(before.biochar!.wetKg).toBeGreaterThan(COUNTED_WET_KG + LOST_WET_KG);

    await postMeasurement(f, { storageLocationId: f.source.id, kind: "loss", wetMassKg: LOST_WET_KG, moisturePercent: MOISTURE_PERCENT });
    const lost = await inventory(f);
    expect(lost.biochar).toEqual({
      wetKg: before.biochar!.wetKg! - LOST_WET_KG,
      dryBiocharKg: before.biochar!.dryBiocharKg - LOST_DRY_BIOCHAR_KG,
    });
    expect(lost.biochar).toEqual(await binStock(f, f.source.id));

    await postMeasurement(f, { storageLocationId: f.source.id, kind: "count", wetMassKg: COUNTED_WET_KG, moisturePercent: MOISTURE_PERCENT });
    const counted = await inventory(f);
    expect(counted.biochar).toEqual({ wetKg: COUNTED_WET_KG, dryBiocharKg: COUNTED_DRY_BIOCHAR_KG });
    expect(counted.biochar!.wetKg).toBeLessThan(lost.biochar!.wetKg!);
    expect(counted.biochar!.dryBiocharKg).toBeLessThan(lost.biochar!.dryBiocharKg);
    expect(counted.biochar).toEqual(await binStock(f, f.source.id));
    expect(counted.product).toEqual(before.product);
  });

  it("counts only stock placed by now, as the bin cards do", async () => {
    const f = await fixture();
    const before = await inventory(f);
    const FUTURE_MS = 365 * 24 * 60 * 60 * 1000;
    const start = new Date(Date.now() + FUTURE_MS);
    await db.insert(productionRuns).values({
      organizationId: f.ctx.organizationId, facilityId: f.facility.id, reactorId: f.runs[0].reactorId,
      code: `E2E-SNAPSHOT-FUTURE-${f.tag}`, status: "complete", startTime: start, endTime: new Date(start.getTime() + 4 * 60 * 60 * 1000),
      biocharStorageLocationId: f.source.id, biocharOutputKg: SECOND_BIN_WET_KG, biocharMoisturePercent: MOISTURE_PERCENT,
      biocharDryMassKg: SECOND_BIN_DRY_BIOCHAR_KG,
    });
    const after = await inventory(f);
    expect(after.biochar).toEqual(before.biochar);
    expect(after.biochar).toEqual(await binStock(f, f.source.id));
    expect(after.product).toEqual(before.product);
  });

  it("keeps another facility's bins in the same organization out of the figures", async () => {
    const f = await fixture();
    const before = await inventory(f);
    const other = await seedOutputStockParents(db, { organizationId: f.ctx.organizationId, userId: f.ctx.userId });
    await db.update(storageLocations).set({ formulationId: other.pure.id }).where(and(
      eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, other.bin.id),
    ));
    await postProduct(other, { massKg: SECOND_BIN_WET_KG, moistureContentPercent: MOISTURE_PERCENT });
    expect(await inventory(f)).toEqual(before);
    const otherInventory = await getFacilityOutputStock(f.ctx, other.facility.id);
    expect(otherInventory.product).toEqual({ wetKg: SECOND_BIN_WET_KG, dryBiocharKg: SECOND_BIN_DRY_BIOCHAR_KG });
    expect(otherInventory.biochar).toEqual(await binStock(other, other.source.id));
  });

  it("preserves the figures when the facility and its bins are archived", async () => {
    const f = await fixture();
    await secondProductBin(f);
    const before = await inventory(f);
    expect(before.product!.wetKg).toBe(INITIAL_WET_KG + SECOND_BIN_WET_KG);
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await inventory(f)).toEqual(before);
  });
});
