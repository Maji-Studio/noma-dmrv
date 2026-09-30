import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, binMovements, outputStockAllocations, storageLocations } from "@/db/schema";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { previewProductStock } from "@/data-access/product-stock-preview";
import { SafeError } from "@/lib/errors";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { withProductStockFingerprint } from "./helpers/product-stock-preview-fixture";

const PLACED_AT = "2026-09-14T12:00:00.000Z";
const orgs: string[] = [];
afterEach(async () => { for (const org of orgs.splice(0)) await cleanupOutputStockFixture(db, org); });

/** A split biochar bin with two runs: R1 holds 900 kg dry (10% when added), R2 600 kg (20%). */
async function splitSource() {
  const f = await seedOutputStockParents(db);
  orgs.push(f.ctx.organizationId);
  const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, formulationId: f.pure.id,
    code: `E2E-SPLIT-PB-${f.tag}`, name: `E2E Pure bin ${f.tag}`, type: "product_bin" }).returning();
  const product = (sources?: { layerId: string; moisturePercent: number }[], moisture?: number) => ({
    code: `E2E-SPLIT-P-${f.tag}-${randomUUID().slice(0, 4)}`, facilityId: f.facility.id, formulationId: f.pure.id, placedAt: PLACED_AT,
    sourceBiocharStorageLocationId: f.source.id, storageLocationId: bin.id, massKg: 1000, waterAddedKg: 0,
    moistureContentPercent: moisture ?? null, sources, idempotencyKey: randomUUID(), composition: { ingredients: [] },
  });
  return { ...f, pureBin: bin, product, r1: f.runs[0], r2: f.runs[1] };
}

describe("product creation from a split biochar bin", () => {
  it("draws the runs in the operator's order, each at its own reading", async () => {
    const f = await splitSource();
    // R2 first: 600 ÷ 0.80 = 750 kg wet empties it; the other 250 kg wet at 10% takes 225 kg from R1.
    const sources = [{ layerId: f.r2.id, moisturePercent: 20 }, { layerId: f.r1.id, moisturePercent: 10 }];
    const [source] = await previewProductStock(f.ctx, { facilityId: f.facility.id, formulationId: f.pure.id, placedAt: PLACED_AT,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.pureBin.id, massKg: 1000, waterAddedKg: 0, sources, ingredientBins: [] });
    expect(source.blockingMessage).toBeNull();
    expect(source.removedDryKg).toBe(825);
    const product = await createBiocharProduct(f.ctx, await withProductStockFingerprint(f.ctx, f.product(sources)));
    // The product's biochar moisture is the draw's overall 1 − solids ÷ wet = 1 − 825 ÷ 1,000.
    const [saved] = await db.select().from(biocharProducts).where(eq(biocharProducts.id, product.id));
    expect(saved.moistureContentPercent).toBe(17.5);
    const [movement] = await db.select().from(binMovements).where(eq(binMovements.storageLocationId, f.source.id));
    const rows = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.movementId, movement.id));
    const byRun = new Map(rows.map(row => [row.productionRunId, row]));
    expect(byRun.get(f.r2.id)).toMatchObject({ dryMassKg: "600.000", wetMassKg: "750.000" });
    expect(byRun.get(f.r1.id)).toMatchObject({ dryMassKg: "225.000", wetMassKg: "250.000" });
    expect(byRun.get(f.r1.id)?.basisSnapshot).toMatchObject({ policy: "operator_order", order: [f.r2.id, f.r1.id], readingPercent: "10" });
  });

  it("refuses a draw with neither a moisture nor sub-bin readings", async () => {
    const f = await splitSource();
    await expect(createBiocharProduct(f.ctx, { ...f.product(), basisFingerprint: "unused" })).rejects.toThrow(SafeError);
  });
});
