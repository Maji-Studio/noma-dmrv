import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, outputStockAllocations, productionRuns, storageLocations } from "@/db/schema";
import { updateOrder } from "@/data-access/orders";
import { updateBiocharProduct } from "@/data-access/biochar-products";
import { updateFormulation } from "@/data-access/formulations";
import { updateProductionRun } from "@/data-access/production-runs";
import { getOutputBinDryBalance } from "@/data-access/output-stock";
import { cleanupPostedStock, postedStockFixture, postDelivery, postMeasurement } from "./helpers/posted-output-stock-fixture";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
async function fixture() { const f = await postedStockFixture(); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });

describe("stock-reducing update guards", () => {
  it("prevents a used order from changing formulation without reassigning saved product sources", async () => {
    const f = await fixture(); const delivery = await postDelivery(f, 500);
    const before = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    await expect(updateOrder(f.ctx, f.order.id, { formulationId: f.recipe.id })).rejects.toThrow(delivery.code);
    expect(await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id))).toEqual(before);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(500);
  });
  it("prevents moving a posted product to another depleted bin", async () => {
    const f = await fixture();
    const [target] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
      code: `E2E-TARGET-${f.tag}`, name: `E2E Target ${f.tag}`, type: "product_bin", formulationId: f.pure.id }).returning();
    if (!f.product) throw new Error("Expected posted product");
    await expect(updateBiocharProduct(f.ctx, f.product.id, { storageLocationId: target.id })).rejects.toThrow("immutable");
    expect(await getOutputBinDryBalance(f.ctx, target.id)).toBe(0);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(1000);
  });
  it("requires explicit stock loss instead of reducing posted creation mass", async () => {
    const f = await fixture(); await postDelivery(f, 800);
    if (!f.product) throw new Error("Expected posted product");
    await expect(updateBiocharProduct(f.ctx, f.product.id, { massKg: 200 })).rejects.toThrow("immutable");
    const loss = await postMeasurement(f, { kind: "loss", wetMassKg: 100 });
    expect(loss.preview.afterDryKg).toBe(100);
    expect((await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.product.id)))[0].massKg).toBe(1000);
  });
  it("does not recalculate source mass from a formulation volume share", async () => {
    const f = await fixture(); if (!f.product) throw new Error("Expected posted product");
    const before = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.targetBiocharProductId, f.product.id));
    await expect(updateFormulation(f.ctx, f.pure.id, { biocharRatio: 0.9 })).resolves.toMatchObject({ biocharRatio: 0.9 });
    expect(await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.targetBiocharProductId, f.product.id))).toEqual(before);
    expect((await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.product.id)))[0].biocharRatio).toBe(1);
  });
  it("rejects reducing a production run after its biochar has been posted downstream", async () => {
    const f = await fixture(); const run = f.runs[0];
    await expect(updateProductionRun(f.ctx, run.id, { biocharOutputKg: 100 })).rejects.toThrow();
    expect((await db.select().from(productionRuns).where(eq(productionRuns.id, run.id)))[0].biocharOutputKg).toBe(1000);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(1000);
  });
});
