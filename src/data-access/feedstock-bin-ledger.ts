import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, biocharProducts, feedstocks, productionRunFeedstockDraws, productionRuns, storageLocations, users } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { CANCELLED_PRODUCTION_RUN_STATUS } from '@/lib/production-runs/lifecycle';
import type { FeedstockBinStock, FeedstockLedgerEntry } from '@/types/feedstock-bin-ledger';
import { requireOrgScope } from './utils';

const MASS_DECIMALS = 1_000;
const PERCENT = 100;

const round = (kg: number) => Math.round(kg * MASS_DECIMALS) / MASS_DECIMALS;

/**
 * A feedstock bin's stock as one timeline, oldest first: batches received,
 * production-run and product-ingredient draws, and recorded losses and
 * stock-takes, each with the wet stock before and after it.
 *
 * Wet mass is the bin's stock currency (`deriveLaneStock`). Draws take every
 * complete batch in proportion to its intake mass (`allocateFeedstockWetMass`),
 * so the pile's batch split is the intake split, and its dry estimate is the
 * received batches' dry-to-wet ratio. Both are estimates; the wet figures
 * are the ledger's own.
 */
export async function getFeedstockBinStock(ctx: OrgContext, storageLocationId: string): Promise<FeedstockBinStock> {
  requireOrgScope(ctx);
  const [bin] = await db.select({ type: storageLocations.type, facilityId: storageLocations.facilityId }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  if (bin.type !== 'feedstock_bin') throw new SafeError('This bin does not hold feedstock');

  const [batches, runDraws, products, movements] = await Promise.all([
    db.select({ id: feedstocks.id, code: feedstocks.code, deliveryDate: feedstocks.deliveryDate, createdAt: feedstocks.createdAt,
      wetKg: feedstocks.massWetKg, dryKg: feedstocks.massDryKg, moisturePercent: feedstocks.moistureContentPercent })
      .from(feedstocks)
      .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId), eq(feedstocks.status, 'complete'))),
    db.select({ id: productionRunFeedstockDraws.id, sourceId: productionRuns.id, wetKg: productionRunFeedstockDraws.wetMassKg, code: productionRuns.code,
      startTime: productionRuns.startTime, createdAt: productionRunFeedstockDraws.createdAt })
      .from(productionRunFeedstockDraws)
      .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunFeedstockDraws.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
      .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.storageLocationId, storageLocationId),
        ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS))),
    db.select({ id: biocharProducts.id, code: biocharProducts.code, placedAt: biocharProducts.placedAt, createdAt: biocharProducts.createdAt,
      composition: biocharProducts.composition })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.facilityId, bin.facilityId))),
    db.select({ movement: binMovements, actorName: users.name }).from(binMovements)
      .leftJoin(users, eq(users.id, binMovements.createdBy))
      .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId),
        eq(binMovements.lane, 'feedstock'), inArray(binMovements.movementType, ['loss', 'adjustment']))),
  ]);

  const ingredientDraws = products.map(product => {
    const composition = product.composition as { ingredients?: { storageLocationId?: string; massKg?: number }[] };
    const ingredients = Array.isArray(composition?.ingredients) ? composition.ingredients : [];
    return { ...product, ingredientWetKg: ingredients.reduce((sum, ingredient) =>
      ingredient.storageLocationId === storageLocationId && typeof ingredient.massKg === 'number' && Number.isFinite(ingredient.massKg) && ingredient.massKg > 0
        ? sum + ingredient.massKg : sum, 0) };
  });
  type Draft = Omit<FeedstockLedgerEntry, 'beforeWetKg' | 'afterWetKg' | 'estimatedDryKg'> & { intakeDryKg: number | null };
  const drafts: Draft[] = [
    ...batches.map((b): Draft => ({ id: b.id, sourceId: b.id, kind: 'intake', occurredAt: (b.deliveryDate ?? b.createdAt).toISOString(),
      recordedAt: b.createdAt.toISOString(), actorName: null, code: b.code, reason: '', wetDeltaKg: b.wetKg, countedWetKg: null,
      moisturePercent: b.moisturePercent === null ? null : Number(b.moisturePercent), intakeDryKg: b.dryKg === null ? null : Number(b.dryKg) })),
    ...runDraws.map((d): Draft => ({ id: d.id, sourceId: d.sourceId, kind: 'run_draw', occurredAt: d.startTime.toISOString(), recordedAt: d.createdAt.toISOString(),
      actorName: null, code: d.code, reason: '', wetDeltaKg: -Number(d.wetKg), countedWetKg: null, moisturePercent: null, intakeDryKg: 0 })),
    ...ingredientDraws.filter(p => Number(p.ingredientWetKg ?? 0) > 0).map((p): Draft => ({ id: p.id, sourceId: p.id, kind: 'ingredient_draw', occurredAt: p.placedAt.toISOString(),
      recordedAt: p.createdAt.toISOString(), actorName: null, code: p.code, reason: '', wetDeltaKg: -Number(p.ingredientWetKg), countedWetKg: null,
      moisturePercent: null, intakeDryKg: 0 })),
    ...movements.map(({ movement: m, actorName }): Draft => ({ id: m.id, sourceId: null, kind: m.movementType === 'loss' ? 'loss' : 'count',
      occurredAt: (m.occurredAt ?? m.createdAt).toISOString(), recordedAt: m.createdAt.toISOString(), actorName, code: null, reason: m.reason,
      wetDeltaKg: Number(m.massDeltaKg), countedWetKg: m.countedWetMassKg ?? m.countedMassKg,
      moisturePercent: m.moistureRatioUsed === null ? null : Number(m.moistureRatioUsed) * PERCENT, intakeDryKg: 0 })),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));

  let wetKg = 0;
  let intakeWetKg = 0;
  let intakeDryKg = 0;
  let missingDryBasis = false;
  const entries = drafts.map(({ intakeDryKg: dry, ...draft }): FeedstockLedgerEntry => {
    const beforeWetKg = round(wetKg);
    wetKg += draft.wetDeltaKg ?? 0;
    if (draft.kind === 'intake') {
      intakeWetKg += draft.wetDeltaKg ?? 0;
      intakeDryKg += dry ?? 0;
      missingDryBasis ||= dry === null || (dry > 0 && !(draft.wetDeltaKg != null && draft.wetDeltaKg > 0));
    }
    const ratio = intakeWetKg > 0 && !missingDryBasis ? intakeDryKg / intakeWetKg : null;
    return { ...draft, beforeWetKg, afterWetKg: round(wetKg), estimatedDryKg: wetKg === 0 ? 0 : ratio === null ? null : round(Math.max(wetKg, 0) * ratio) };
  });

  const currentWetKg = round(wetKg);
  const pile = batches.filter(b => Number(b.wetKg ?? 0) > 0)
    .sort((a, b) => (a.deliveryDate ?? a.createdAt).getTime() - (b.deliveryDate ?? b.createdAt).getTime())
    .map(b => ({ id: b.id, code: b.code, receivedAt: (b.deliveryDate ?? b.createdAt).toISOString(),
      wetKg: intakeWetKg > 0 ? round(Math.max(currentWetKg, 0) * Number(b.wetKg) / intakeWetKg) : 0,
      intakeWetKg: Number(b.wetKg), dryKg: missingDryBasis || b.dryKg === null ? null : round(Math.max(currentWetKg, 0) * Number(b.dryKg) / intakeWetKg), moisturePercent: b.moisturePercent === null ? null : Number(b.moisturePercent) }));
  return { currentWetKg, entries, batches: pile };
}
