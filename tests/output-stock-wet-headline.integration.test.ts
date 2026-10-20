import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { createBiocharProduct } from '@/data-access/biochar-product-create';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { previewProductStock, type ProductStockPreviewInput } from '@/data-access/product-stock-preview';
import { replayStock } from '@/lib/output-stock/stock-replay';
import { seedOutputStockParents } from './helpers/output-stock-fixture';
import { cleanupOutputStockFixture } from './helpers/output-stock-cleanup';

const PLACED_AT = '2026-09-12T10:00:00.000Z';
const READ_AT = '2026-09-13T00:00:00.000Z';
const organizations: string[] = [];
afterAll(async () => { for (const id of organizations) await cleanupOutputStockFixture(db, id); });

/** The bin now, as the stock card, the tile and the history headline read it. */
async function balance(f: Awaited<ReturnType<typeof seedOutputStockParents>>, storageLocationId: string) {
  return previewOutputStock(f.ctx, { storageLocationId, facilityId: f.facility.id, occurredAt: READ_AT, kind: 'count', wetMassKg: 0, moisturePercent: null });
}

describe('output bin wet headline', () => {
  it('always has a wet figure for stock from runs and products', async () => {
    const f = await seedOutputStockParents(db);
    organizations.push(f.ctx.organizationId);
    const input: ProductStockPreviewInput = { facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: PLACED_AT,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, massKg: 100, moistureContentPercent: 10, waterAddedKg: 0,
      ingredientBins: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, feedstockTypeName: f.ingredientType.name,
        feedstockTypeCategory: f.ingredientType.category, massKg: 0, moistureContentPercent: 0 }] };
    const [preview] = await previewProductStock(f.ctx, input);
    await createBiocharProduct(f.ctx, { code: `E2E-WET-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: PLACED_AT,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, massKg: 100, moistureContentPercent: 10, waterAddedKg: 0,
      composition: { ingredients: input.ingredientBins }, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });

    for (const bin of [f.source, f.bin]) {
      const history = await getOutputStockHistory(f.ctx, bin.id);
      const intakes = history.filter(entry => entry.kind === 'intake');
      expect(intakes.length).toBeGreaterThan(0);
      for (const intake of intakes) expect(intake.wetDeltaKg).toEqual(intake.wetMassKg);
      // Every step of the history, the product draw from the biochar bin included, keeps a wet figure.
      for (const step of replayStock(history)) expect(step.after.wetKg).not.toBeNull();
      const now = await balance(f, bin.id);
      expect(now.beforeDryKg).toBeGreaterThan(0);
      expect(now.beforeEstimatedWetKg).not.toBeNull();
    }
    // Two runs (1,000 kg and 750 kg wet) less the 100 kg the product drew; the product bin holds that 100 kg.
    expect((await balance(f, f.source.id)).beforeEstimatedWetKg).toBeCloseTo(1650);
    expect((await balance(f, f.bin.id)).beforeEstimatedWetKg).toBeCloseTo(100);
  });
});
