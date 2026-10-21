import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts, storageLocations } from "@/db/schema";
import { findApiOutputBinStock } from "@/data-access/api-output-bin-stock";
import { getFacilities } from "@/data-access/facilities";
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
const SECOND_BIN_WET_KG = 100;
const SECOND_BIN_DRY_BIOCHAR_KG = 80;
const INVALID_INGREDIENT_MASS_KG = -1;

type Fixture = Awaited<ReturnType<typeof postedStockFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupPostedStock(f);
});

async function fixture() {
  const f = await postedStockFixture({ stockKg: 0 });
  fixtures.push(f);
  const product = await postProduct(f, { massKg: INITIAL_WET_KG, moistureContentPercent: MOISTURE_PERCENT });
  return { ...f, product };
}

async function inventory(f: Fixture) {
  const result = await getFacilities(f.ctx, { search: f.facility.code });
  expect(result.items.map(row => row.id)).toEqual([f.facility.id]);
  return result.items[0].inventorySummary;
}

async function binStock(f: Fixture, id: string) {
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
    code: `E2E-SNAPSHOT-B-${f.tag}`, name: "Second product bin", formulationId: f.pure.id,
  }).returning();
  await postProduct(f, { massKg: SECOND_BIN_WET_KG, moistureContentPercent: MOISTURE_PERCENT, storageLocationId: bin.id });
  return bin;
}

describe("facility inventory snapshot", { timeout: TIMEOUT_MS }, () => {
  it("matches bin stock after a delivery, a loss and a stock count, and stays inside its organization", async () => {
    const f = await fixture();
    const before = await inventory(f);
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
    expect(counted.feedstockWetKg).toBe(before.feedstockWetKg);

    const other = await fixture();
    const foreign = await getFacilities(other.ctx, { search: f.facility.code });
    expect(foreign.items).toEqual([]);
    expect(foreign.total).toBe(0);
    await expect(findApiOutputBinStock(other.ctx, { identifier: { id: f.bin.id } })).rejects.toMatchObject({ code: "not_found" });
    const own = await getFacilities(other.ctx);
    expect(own.items.map(row => row.id)).toEqual([other.facility.id]);
    expect(own.items[0].inventorySummary.product).toEqual({ wetKg: INITIAL_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG });
  });

  it("reports unknown product stock without hiding the known biochar stock", async () => {
    const f = await fixture();
    await secondProductBin(f);
    await db.update(biocharProducts).set({
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, massKg: INVALID_INGREDIENT_MASS_KG }] },
    }).where(and(eq(biocharProducts.id, f.product!.id), eq(biocharProducts.organizationId, f.ctx.organizationId)));
    expect(await inventory(f)).toMatchObject({ product: null, biochar: await binStock(f, f.source.id) });
  });

  it("adds the wet estimates and dry biochar of all active bins at the facility", async () => {
    const f = await fixture();
    const second = await secondProductBin(f);
    const stock = await inventory(f);
    expect(stock.product).toEqual({ wetKg: INITIAL_WET_KG + SECOND_BIN_WET_KG, dryBiocharKg: INITIAL_DRY_BIOCHAR_KG + SECOND_BIN_DRY_BIOCHAR_KG });
    const firstStock = await binStock(f, f.bin.id);
    const secondStock = await binStock(f, second.id);
    expect(stock.product).toEqual({ wetKg: firstStock.wetKg + secondStock.wetKg, dryBiocharKg: firstStock.dryBiocharKg + secondStock.dryBiocharKg });
    expect(stock.biochar).toEqual(await binStock(f, f.source.id));
  });

  it("leaves archived output bins out of the facility figures", async () => {
    const f = await fixture();
    const before = await inventory(f);
    await db.update(storageLocations).set({ archivedAt: new Date() })
      .where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.facilityId, f.facility.id), eq(storageLocations.id, f.bin.id)));
    expect(await inventory(f)).toEqual({ ...before, product: { wetKg: 0, dryBiocharKg: 0 } });
  });
});
