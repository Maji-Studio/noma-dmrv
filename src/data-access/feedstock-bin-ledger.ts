import { deletedProductIds } from './output-stock-active-movements';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, biocharProducts, feedstocks, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, storageLocations, users } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { CANCELLED_PRODUCTION_RUN_STATUS } from '@/lib/production-runs/lifecycle';
import type { FeedstockBinStock, FeedstockLedgerEntry } from '@/types/feedstock-bin-ledger';
import { feedstockPileTimeline } from '@/lib/feedstock-pile';
import { findFeedstockLossBlocker, formatFeedstockLossLockReason } from '@/lib/feedstock-loss-lock';
import { requireOrgScope } from './utils';
import { formatUtcDate, startOfFacilityDay } from '@/lib/date-utils';
import { getOutputStockFacilityTimezone } from './output-stock-dates';

const MASS_DECIMALS = 1_000;
const PERCENT = 100;

const round = (kg: number) => Math.round(kg * MASS_DECIMALS) / MASS_DECIMALS;

/**
 * A feedstock bin's stock as one timeline, oldest first: batches received,
 * production-run and product-ingredient draws, and recorded losses and
 * stock-takes, each with the wet stock before and after it.
 *
 * Wet mass is the bin's stock currency. Saved run shares are subtracted from
 * their own batches. Draws without batch records are estimated pro rata over
 * stock present at each entry; dry composition uses each intake's dry-to-wet ratio.
 */
export async function getFeedstockBinStock(ctx: OrgContext, storageLocationId: string, reader: Pick<typeof db, 'select'> = db): Promise<FeedstockBinStock> {
  requireOrgScope(ctx);
  const [bin] = await reader.select({ type: storageLocations.type, facilityId: storageLocations.facilityId }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  if (bin.type !== 'feedstock_bin') throw new SafeError('This bin does not hold feedstock');

  const timezone = await getOutputStockFacilityTimezone(ctx, bin.facilityId, reader);

  const [batches, runDraws, products, movements, batchDraws] = await Promise.all([
    reader.select({ id: feedstocks.id, code: feedstocks.code, deliveryDate: feedstocks.deliveryDate, createdAt: feedstocks.createdAt,
      wetKg: feedstocks.massWetKg, dryKg: feedstocks.massDryKg, moisturePercent: feedstocks.moistureContentPercent })
      .from(feedstocks)
      .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId), eq(feedstocks.status, 'complete'))),
    reader.select({ id: productionRunFeedstockDraws.id, sourceId: productionRuns.id, wetKg: productionRunFeedstockDraws.wetMassKg, code: productionRuns.code,
      startTime: productionRuns.startTime, createdAt: productionRunFeedstockDraws.createdAt })
      .from(productionRunFeedstockDraws)
      .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunFeedstockDraws.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
      .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.storageLocationId, storageLocationId),
        ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS))),
    reader.select({ id: biocharProducts.id, code: biocharProducts.code, placedAt: biocharProducts.placedAt, createdAt: biocharProducts.createdAt,
      composition: biocharProducts.composition })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.facilityId, bin.facilityId))),
    reader.select({ movement: binMovements, actorName: users.name }).from(binMovements)
      .leftJoin(users, eq(users.id, binMovements.createdBy))
      .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId),
        eq(binMovements.lane, 'feedstock'), inArray(binMovements.movementType, ['loss', 'adjustment']))),
    reader.select({ feedstockId: productionRunFeedstocks.feedstockId, wetKg: productionRunFeedstocks.wetMassUsedKg, productionRunId: productionRunFeedstocks.productionRunId })
      .from(productionRunFeedstocks)
      .innerJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)))
      .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunFeedstocks.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
      .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId), ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS))),
  ]);

  const deleted = new Set((await deletedProductIds(ctx, reader)).map(row => row.id));
  const reversals = new Map(movements.filter(({ movement }) => movement.movementType === 'adjustment' && movement.correctsMovementId)
    .map(row => [row.movement.correctsMovementId!, row]));
  const replacements = new Map(movements.filter(({ movement }) => movement.movementType === 'loss' && movement.correctsMovementId)
    .map(({ movement }) => [movement.correctsMovementId!, movement.id]));
  const ingredientDraws = products.map(product => {
    const composition = product.composition as { ingredients?: { storageLocationId?: string; massKg?: number }[] };
    const ingredients = Array.isArray(composition?.ingredients) ? composition.ingredients : [];
    return { ...product, ingredientWetKg: ingredients.reduce((sum, ingredient) =>
      ingredient.storageLocationId === storageLocationId && typeof ingredient.massKg === 'number' && Number.isFinite(ingredient.massKg) && ingredient.massKg > 0
        ? sum + ingredient.massKg : sum, 0) };
  });
  // Intake dates encode business days; availability starts at their first valid facility-local instant.
  type Draft = Omit<FeedstockLedgerEntry, 'beforeWetKg' | 'afterWetKg' | 'estimatedDryKg'>;
  const drafts: Draft[] = [
    ...batches.map((b): Draft => ({ id: b.id, sourceId: b.id, kind: 'intake', occurredAt: startOfFacilityDay(formatUtcDate(b.deliveryDate), timezone).toISOString(),
      recordedAt: b.createdAt.toISOString(), actorName: null, code: b.code, reason: '', wetDeltaKg: b.wetKg, countedWetKg: null,
      moisturePercent: b.moisturePercent === null ? null : Number(b.moisturePercent) })),
    ...runDraws.map((d): Draft => ({ id: d.id, sourceId: d.sourceId, kind: 'run_draw', occurredAt: d.startTime.toISOString(), recordedAt: d.createdAt.toISOString(),
      actorName: null, code: d.code, reason: '', wetDeltaKg: -Number(d.wetKg), countedWetKg: null, moisturePercent: null })),
    ...ingredientDraws.filter(p => Number(p.ingredientWetKg ?? 0) > 0).map((p): Draft => ({ id: p.id, sourceId: p.id, kind: 'ingredient_draw', reversed: deleted.has(p.id), occurredAt: p.placedAt.toISOString(),
      recordedAt: p.createdAt.toISOString(), actorName: null, code: p.code, reason: '', wetDeltaKg: -Number(p.ingredientWetKg), countedWetKg: null,
      moisturePercent: null })),
    ...movements.filter(({ movement }) => !(movement.movementType === 'adjustment' && movement.correctsMovementId))
      .map(({ movement: m, actorName }): Draft => {
        const reversal = m.movementType === 'loss' ? reversals.get(m.id) : undefined;
        return { id: m.id, sourceId: null, kind: m.movementType === 'loss' ? 'loss' : 'count',
          correctsMovementId: m.correctsMovementId,
          ...(reversal ? { reversed: true, reversedBy: {
            id: reversal.movement.id, reason: reversal.movement.reason, recordedAt: reversal.movement.createdAt.toISOString(),
            actorName: reversal.actorName, replacementId: replacements.get(m.id) ?? null,
          } } : {}),
          occurredAt: (m.movementType === 'loss' ? m.occurredAt! : m.createdAt).toISOString(), recordedAt: m.createdAt.toISOString(), actorName, code: null, reason: m.reason,
          wetDeltaKg: Number(m.massDeltaKg), countedWetKg: m.countedWetMassKg ?? m.countedMassKg,
          moisturePercent: m.moistureRatioUsed === null ? null : Number(m.moistureRatioUsed) * PERCENT };
      }),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));

  const intakeById = new Map(batches.map(batch => [batch.id, { id: batch.id, wetKg: Number(batch.wetKg), dryKg: Number(batch.dryKg) }]));
  const drawsByRun = new Map<string, { feedstockId: string; wetKg: number }[]>();
  for (const draw of batchDraws) {
    const shares = drawsByRun.get(draw.productionRunId) ?? [];
    shares.push({ feedstockId: draw.feedstockId, wetKg: Number(draw.wetKg) });
    drawsByRun.set(draw.productionRunId, shares);
  }
  const replay = feedstockPileTimeline(drafts.map(draft => ({ wetDeltaKg: draft.reversed ? 0 : draft.wetDeltaKg,
    intake: draft.kind === 'intake' ? intakeById.get(draft.id) : undefined,
    draws: draft.kind === 'run_draw' && draft.sourceId ? drawsByRun.get(draft.sourceId) : undefined,
  })));
  let wetKg = 0;
  const entries = drafts.map((draft, index): FeedstockLedgerEntry => {
    const beforeWetKg = round(wetKg);
    wetKg += draft.reversed ? 0 : draft.wetDeltaKg ?? 0;
    return { ...draft, beforeWetKg, afterWetKg: round(wetKg), estimatedDryKg: replay.points[index].dryKg };
  });

  const currentWetKg = round(wetKg);
  for (const entry of entries) {
    if (entry.kind !== 'loss' || entry.reversed) continue;
    const blocker = findFeedstockLossBlocker(entries, entry.id);
    entry.editLockedReason = blocker ? formatFeedstockLossLockReason(blocker, timezone) : null;
  }
  const shares = new Map(replay.batches.map(batch => [batch.id, batch]));
  const pile = batches.filter(b => Number(b.wetKg) > 0)
    .sort((a, b) => a.deliveryDate.getTime() - b.deliveryDate.getTime()
      || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map(b => ({ id: b.id, code: b.code, receivedAt: b.deliveryDate.toISOString(),
      wetKg: shares.get(b.id)?.wetKg ?? 0,
      intakeWetKg: Number(b.wetKg), dryKg: shares.get(b.id)?.dryKg ?? null, moisturePercent: b.moisturePercent === null ? null : Number(b.moisturePercent) }));
  if (entries.length) entries[entries.length - 1].estimatedDryKg = round(pile.reduce((sum, batch) => sum + (batch.dryKg ?? 0), 0));
  return { currentWetKg, entries, batches: pile };
}
