/** Balance/history parity through real writers. Requires the isolated test DB. */
import { afterAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, productionRuns, storageLocations } from '@/db/schema';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { getOutputSubBins } from '@/data-access/output-sub-bins';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { deleteBiocharProduct } from '@/data-access/biochar-products';
import { replayStock } from '@/lib/output-stock/stock-replay';
import { pileFigures, stockParts } from '@/lib/output-stock/stock-parts';
import { cleanupOutputStockFixture } from './helpers/output-stock-cleanup';
import { seedOutputStockParents } from './helpers/output-stock-fixture';
import { postMeasurement, postProduct, type PostedStockParents } from './helpers/posted-output-stock-fixture';

const READ_AT = '2026-09-20T00:00:00.000Z';
const LOSS_AT = '2026-09-14T12:00:00.000Z';
const COUNT_AT = '2026-09-15T12:00:00.000Z';
const DRY_TOLERANCE_KG = 1e-3;
const FIGURE_TOLERANCE_KG = 1e-6;
const organizations: string[] = [];
afterAll(async () => { for (const id of organizations) await cleanupOutputStockFixture(db, id); });

async function fixture() {
  const f = await seedOutputStockParents(db);
  organizations.push(f.ctx.organizationId);
  return f;
}

function equalKg(actual: number | null, expected: number | null, tolerance = FIGURE_TOLERANCE_KG) {
  if (expected === null) expect(actual).toBeNull();
  else {
    expect(actual).not.toBeNull();
    expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(tolerance);
  }
}

async function parity(f: PostedStockParents, storageLocationId: string) {
  const input = { facilityId: f.facility.id, storageLocationId, occurredAt: READ_AT };
  const preview = await previewOutputStock(f.ctx, { ...input, kind: 'count', wetMassKg: 0 });
  const subBins = await getOutputSubBins(f.ctx, input);
  const history = await getOutputStockHistory(f.ctx, storageLocationId);
  const steps = replayStock(history);
  const end = steps.at(-1)!.after;
  const balance = pileFigures(subBins.subBins, preview.beforeEstimatedWetKg);
  equalKg(end.dryKg, preview.beforeDryKg, DRY_TOLERANCE_KG);
  equalKg(end.dryKg, balance.dryKg, DRY_TOLERANCE_KG);
  equalKg(end.solidsKg, preview.beforeSolidsKg);
  equalKg(end.solidsKg, balance.solidsKg);
  equalKg(end.wetKg, balance.wetKg);
  for (const name of new Set([...end.ingredients.keys(), ...balance.ingredients.keys()])) {
    equalKg(end.ingredients.get(name) ?? 0, balance.ingredients.get(name) ?? 0);
  }
  const replayParts = stockParts(end);
  const balanceParts = stockParts(balance);
  for (const key of ['waterKg', 'ingredientSolidsKg', 'wetKg'] as const) equalKg(replayParts[key], balanceParts[key]);
  // Cancelled placement pairs retain their audit balances (100 -> 40), while
  // the display replay excludes both. Only live intakes have replay parity.
  for (const step of steps.filter(step => step.live && step.entry.kind === 'intake')) {
    equalKg(step.entry.beforeDryKg, step.before.dryKg, DRY_TOLERANCE_KG);
    equalKg(step.entry.afterDryKg, step.after.dryKg, DRY_TOLERANCE_KG);
  }
  return { end, history, balance };
}

it('1: split source loss followed by a count', async () => {
  const f = await fixture();
  await postMeasurement(f, { storageLocationId: f.source.id, occurredAt: LOSS_AT, kind: 'loss', wetMassKg: 100, moisturePercent: 10 });
  await postMeasurement(f, { storageLocationId: f.source.id, occurredAt: COUNT_AT, kind: 'count', wetMassKg: 1500, moisturePercent: 6 });
  expect((await parity(f, f.source.id)).end).toMatchObject({ wetKg: 1500, dryKg: 1410 });
});

it('2: split re-estimate', async () => {
  const f = await fixture();
  await postMeasurement(f, { storageLocationId: f.source.id, occurredAt: LOSS_AT, kind: 'count', wetMassKg: 100, moisturePercent: 20 });
  const input = { facilityId: f.facility.id, storageLocationId: f.source.id, occurredAt: COUNT_AT,
    kind: 'loss' as const, wetMassKg: 50, moisturePercent: 50 };
  expect((await previewOutputStock(f.ctx, input)).reestimate?.moisturePercent).toBe(50);
  await postMeasurement(f, input);
  expect((await parity(f, f.source.id)).end).toMatchObject({ wetKg: 110, dryKg: 55 });
});

it('3: backdated split loss still follows posting order in the balance', async () => {
  const f = await fixture();
  const first = await postMeasurement(f, { storageLocationId: f.source.id, occurredAt: LOSS_AT, kind: 'loss', wetMassKg: 20, moisturePercent: 10 });
  const second = await postMeasurement(f, { storageLocationId: f.source.id, occurredAt: '2026-09-13T12:00:00.000Z', kind: 'loss', wetMassKg: 50, moisturePercent: 10 });
  const movements = await db.select().from(binMovements).where(and(eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.storageLocationId, f.source.id)));
  expect(movements.find(m => m.id === second.movementId)!.postingSequence).toBeGreaterThan(movements.find(m => m.id === first.movementId)!.postingSequence);
  expect((await parity(f, f.source.id)).end).toMatchObject({ wetKg: 1680, solidsKg: 1437 });
});

it('4: a late run cancels a mix re-estimate; history and balance both end at 250 kg', async () => {
  const f = await fixture();
  await db.update(storageLocations).set({ stockMode: 'mix' }).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.source.id)));
  const placedAt = new Date(LOSS_AT);
  await db.update(productionRuns).set({ biocharOutputKg: 100, biocharDryMassKg: 80, biocharMoisturePercent: 20,
    endTime: placedAt, updatedAt: placedAt }).where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[0].id)));
  await db.update(productionRuns).set({ status: 'running', endTime: null, biocharOutputKg: null, biocharDryMassKg: null })
    .where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[1].id)));
  const input = { facilityId: f.facility.id, storageLocationId: f.source.id, occurredAt: COUNT_AT,
    kind: 'loss' as const, wetMassKg: 50, moisturePercent: 50 };
  expect((await previewOutputStock(f.ctx, input)).afterEstimatedWetKg).toBe(110);
  const posted = await postMeasurement(f, input);
  await db.update(binMovements).set({ createdAt: new Date(COUNT_AT) }).where(and(eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.id, posted.movementId)));
  await db.update(productionRuns).set({ status: 'complete', endTime: placedAt, updatedAt: new Date('2026-09-17T12:00:00.000Z'),
    biocharOutputKg: 200, biocharDryMassKg: 80, biocharMoisturePercent: 60 })
    .where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[1].id)));
  const { end, history, balance } = await parity(f, f.source.id);
  expect(end).toMatchObject({ wetKg: 250, solidsKg: 135, dryKg: 135 });
  expect(balance.wetKg).toBe(250);
  expect(history.find(entry => entry.id === posted.movementId)).toMatchObject({ wetDeltaKg: -50, savedWetDeltaKg: 10 });
  expect(replayStock(history).filter(step => step.moves).map(step => step.after.wetKg)).toEqual([100, 300, 250]);
});

it('5: deleted pure product and corrected loss retain parity', async () => {
  const f = await fixture();
  await db.update(storageLocations).set({ formulationId: f.pure.id }).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
  await postProduct(f, { massKg: 40 });
  const removed = await postProduct(f, { massKg: 60 });
  await deleteBiocharProduct(f.ctx, removed.id, removed.version);
  const loss = await postMeasurement(f, { kind: 'loss', wetMassKg: 10, moisturePercent: 0 });
  await postMeasurement(f, { kind: 'loss', wetMassKg: 5, moisturePercent: 0, correctsMovementId: loss.movementId });
  const { end, history } = await parity(f, f.bin.id);
  expect(end).toMatchObject({ dryKg: 35, wetKg: 35 });
  expect(history.find(entry => entry.id.endsWith(':placement'))).toMatchObject({ beforeDryKg: 100, afterDryKg: 40 });
});

it('6: mix products retain compost solids by name through a re-estimate', async () => {
  const f = await fixture();
  await db.update(storageLocations).set({ stockMode: 'mix' }).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
  const ingredient = { formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id,
    feedstockTypeName: f.ingredientType.name, feedstockTypeCategory: f.ingredientType.category, massKg: 20, moistureContentPercent: 25 };
  await postProduct(f, { formulationId: f.recipe.id, massKg: 100, moistureContentPercent: 20, composition: { ingredients: [ingredient] } });
  await postProduct(f, { formulationId: f.recipe.id, placedAt: '2026-09-12T18:00:00.000Z', massKg: 200, moistureContentPercent: 60, composition: { ingredients: [ingredient] } });
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: LOSS_AT,
    kind: 'loss' as const, wetMassKg: 290, moisturePercent: 50 };
  expect((await previewOutputStock(f.ctx, input)).reestimate).not.toBeNull();
  await postMeasurement(f, input);
  const { end, balance } = await parity(f, f.bin.id);
  expect(end.ingredients.has(f.ingredientType.name)).toBe(true);
  equalKg(end.ingredients.get(f.ingredientType.name)!, balance.ingredients.get(f.ingredientType.name)!);
});
