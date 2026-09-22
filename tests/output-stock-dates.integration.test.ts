import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, facilities, feedstocks, productionRunFeedstockDraws, productionRuns, storageLocations } from '@/db/schema';
import { getBiocharOutputStockLayers, getOutputBinDryBalance } from '@/data-access/output-stock';
import { getIngredientStockBasis } from '@/data-access/ingredient-moisture-basis';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { postOutputStock } from '@/data-access/output-stock-post';
import { archiveStorageLocation } from '@/data-access/storage-locations';
import { createBiocharProduct } from '@/data-access/biochar-product-create';
import { previewProductStock, type ProductStockPreviewInput } from '@/data-access/product-stock-preview';
import { getProductionRunDependentProduct } from '@/data-access/production-runs/product-dependencies';
import { seedOutputStockParents } from './helpers/output-stock-fixture';
import { cleanupOutputStockFixture } from './helpers/output-stock-cleanup';

const ONE_HOUR_MS = 60 * 60 * 1000;
const organizations: string[] = [];
afterAll(async () => { for (const id of organizations) await cleanupOutputStockFixture(db, id); });
async function fixture(endTime = new Date('2026-09-15T22:30:00Z')) {
  const f = await seedOutputStockParents(db);
  organizations.push(f.ctx.organizationId);
  await db.update(facilities).set({ timezone: 'Africa/Dar_es_Salaam' }).where(and(eq(facilities.id, f.facility.id), eq(facilities.organizationId, f.ctx.organizationId)));
  for (const [index, run] of f.runs.entries()) {
    const runEndTime = new Date(endTime.getTime() + index * ONE_HOUR_MS);
    await db.update(productionRuns).set({
      endTime: runEndTime,
      startTime: new Date(runEndTime.getTime() - ONE_HOUR_MS),
    }).where(and(eq(productionRuns.id, run.id), eq(productionRuns.facilityId, f.facility.id), eq(productionRuns.organizationId, f.ctx.organizationId)));
  }
  return f;
}

describe('output stock facility dates in PostgreSQL', () => {
  it('uses the facility date for SQL layers, FIFO eligibility and receipt history under different session zones', async () => {
    const f = await fixture();
    for (const zone of ['UTC', 'America/Los_Angeles']) {
      await db.transaction(async tx => {
        await tx.execute(sql`select set_config('TimeZone', ${zone}, true)`);
        const state = await getBiocharOutputStockLayers(f.ctx, { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-15' }, tx);
        expect(state.layers.map(l => l.physicalDate)).toEqual(['2026-09-16', '2026-09-16']);
        expect(state.remainingDryKg).toBe('0.000');
      });
    }
    const input = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-15', kind: 'production_draw' as const, wetMassKg: 100, moisturePercent: 0 };
    expect((await previewOutputStock(f.ctx, input)).blockingMessage).toMatch(/Not enough dry biochar/);
    const nextDay = await previewOutputStock(f.ctx, { ...input, physicalDate: '2026-09-16' });
    expect(nextDay.blockingMessage).toBeFalsy();
    expect(nextDay.removedDryKg).toBe(100);
    expect((await getOutputStockHistory(f.ctx, f.source.id)).filter(e => e.kind === 'intake').map(e => e.physicalDate)).toEqual(['2026-09-16', '2026-09-16']);
  });

  it('uses facility dates for ingredient draws and movement fallbacks while explicit movement dates win', async () => {
    const f = await fixture();
    await db.transaction(async tx => {
      const organizationId = f.ctx.organizationId;
      const [bin] = await tx.insert(storageLocations).values({
        organizationId, facilityId: f.facility.id, code: `E2E-INGREDIENT-${f.tag}`,
        name: `E2E Ingredient ${f.tag}`, type: 'feedstock_bin',
      }).returning();
      await tx.insert(feedstocks).values({
        organizationId, facilityId: f.facility.id, code: `E2E-INTAKE-${f.tag}`,
        feedstockTypeId: f.ingredientType.id, storageLocationId: bin.id, status: 'complete',
        deliveryDate: new Date('2026-09-15T00:00:00Z'), massWetKg: 100, massDryKg: 50,
      });
      // Keep the fixture's distinct run starts; its second run starts at this boundary.
      expect(f.runs[1].id).not.toBe(f.runs[0].id);
      await tx.insert(productionRunFeedstockDraws).values({
        organizationId, productionRunId: f.runs[1].id, storageLocationId: bin.id, wetMassKg: 20,
      });
      const [movement] = await tx.insert(binMovements).values({
        organizationId, storageLocationId: bin.id, lane: 'feedstock', movementType: 'loss',
        massDeltaKg: -10, reason: 'E2E ingredient date boundary', createdAt: new Date('2026-09-15T22:30:00Z'),
      }).returning();
      for (const zone of ['UTC', 'America/Los_Angeles']) {
        await tx.execute(sql`select set_config('TimeZone', ${zone}, true)`);
        expect(await getIngredientStockBasis(f.ctx, bin.id, '2026-09-15', tx)).toEqual({ wetMassKg: 100, dryMassKg: 50 });
        expect(await getIngredientStockBasis(f.ctx, bin.id, '2026-09-16', tx)).toEqual({ wetMassKg: 70, dryMassKg: 35 });
        await tx.update(binMovements).set({ physicalDate: '2026-09-15' })
          .where(and(eq(binMovements.id, movement.id), eq(binMovements.organizationId, organizationId)));
        expect(await getIngredientStockBasis(f.ctx, bin.id, '2026-09-15', tx)).toEqual({ wetMassKg: 90, dryMassKg: 45 });
        await tx.update(binMovements).set({ physicalDate: '2026-09-17' })
          .where(and(eq(binMovements.id, movement.id), eq(binMovements.organizationId, organizationId)));
        expect(await getIngredientStockBasis(f.ctx, bin.id, '2026-09-16', tx)).toEqual({ wetMassKg: 80, dryMassKg: 40 });
        await tx.update(binMovements).set({ physicalDate: null })
          .where(and(eq(binMovements.id, movement.id), eq(binMovements.organizationId, organizationId)));
      }
      // These ingredient-only children are outside the shared output fixture cleanup.
      await tx.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, organizationId));
      await tx.delete(feedstocks).where(eq(feedstocks.organizationId, organizationId));
    });
  });

  it('only treats counts on or after the facility receipt date as dependencies', async () => {
    const f = await fixture();
    for (const physicalDate of ['2026-09-15', '2026-09-16']) {
      const input = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate, kind: 'count' as const, wetMassKg: 2000, moisturePercent: 0 };
      const preview = await previewOutputStock(f.ctx, input);
      await postOutputStock(f.ctx, { ...input, basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: 'E2E date chronology count' });
      const dependency = db.transaction(tx => getProductionRunDependentProduct(f.ctx, tx, f.runs[0].id));
      if (physicalDate === '2026-09-15') await expect(dependency).resolves.toBeUndefined();
      else await expect(dependency).rejects.toThrow('covered by count');
    }
  });

  it('refuses actual archive for future production and product stock while retaining date-filtered previews', async () => {
    const future = '2099-09-16';
    const f = await fixture(new Date(`${future}T00:00:00Z`));
    await expect(archiveStorageLocation(f.ctx, f.source.id)).rejects.toThrow('Cannot archive');
    const input: ProductStockPreviewInput = { facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: future,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, massKg: 100, moistureContentPercent: 0, waterAddedKg: 0,
      ingredientBins: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, feedstockTypeName: f.ingredientType.name,
        feedstockTypeCategory: f.ingredientType.category, massKg: 0, moistureContentPercent: 0, moistureSource: 'operator_override' }] };
    const [preview] = await previewProductStock(f.ctx, input);
    await createBiocharProduct(f.ctx, { code: `E2E-FUTURE-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: future,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, massKg: 100, moistureContentPercent: 0, waterAddedKg: 0,
      composition: { ingredients: input.ingredientBins },
      idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(100);
    await expect(archiveStorageLocation(f.ctx, f.bin.id)).rejects.toThrow('Cannot archive');
    for (const id of [f.source.id, f.bin.id]) {
      const [bin] = await db.select().from(storageLocations).where(and(eq(storageLocations.id, id), eq(storageLocations.organizationId, f.ctx.organizationId)));
      expect(bin.archivedAt).toBeNull();
    }
  });
});
