import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, feedstocks, productionRunFeedstockDraws, productionRuns } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireOrgScope } from './utils';

const PERCENT = 100;

/** Remaining wet/dry basis, after saved withdrawals. Shared by prefill and posting. */
export async function getIngredientMoistureBasis(ctx: OrgContext, storageLocationId: string, physicalDate?: string, reader: Pick<DbTransaction, 'select'> = db, excludeProductId?: string) {
  requireOrgScope(ctx);
  if (physicalDate) z.iso.date().parse(physicalDate);
  const intakes = await reader.select({ wet: feedstocks.massWetKg, dry: feedstocks.massDryKg }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId),
      eq(feedstocks.status, 'complete'), isNull(feedstocks.archivedAt),
      physicalDate ? lte(feedstocks.deliveryDate, new Date(`${physicalDate}T23:59:59.999Z`)) : undefined));
  const products = await reader.select({ composition: biocharProducts.composition }).from(biocharProducts)
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), excludeProductId ? ne(biocharProducts.id, excludeProductId) : undefined,
      sql`${biocharProducts.composition}->'ingredients' @> ${JSON.stringify([{ storageLocationId }])}::jsonb`));
  const draws = await reader.select({ wet: productionRunFeedstockDraws.wetMassKg, moisture: productionRuns.feedstockMoisturePercent })
    .from(productionRunFeedstockDraws).innerJoin(productionRuns, and(eq(productionRuns.id, productionRunFeedstockDraws.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.storageLocationId, storageLocationId), ne(productionRuns.status, 'cancelled')));
  const movements = await reader.select({ wet: binMovements.massDeltaKg }).from(binMovements)
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.lane, 'feedstock')));
  let wetMassKg = 0;
  let dryMassKg = 0;
  for (const intake of intakes) {
    if (intake.wet == null || intake.dry == null || !Number.isFinite(intake.wet) || !Number.isFinite(intake.dry)) return null;
    wetMassKg += intake.wet;
    dryMassKg += intake.dry;
  }
  for (const product of products) {
    const ingredients = (product.composition as { ingredients?: { storageLocationId?: string; massKg: number; massDryKg?: number | null }[] }).ingredients ?? [];
    for (const ingredient of ingredients) {
      if (ingredient.storageLocationId !== storageLocationId || !(ingredient.massKg > 0)) continue;
      if (ingredient.massDryKg == null || !Number.isFinite(ingredient.massDryKg)) return null;
      wetMassKg -= ingredient.massKg;
      dryMassKg -= ingredient.massDryKg;
    }
  }
  for (const draw of draws) {
    if (draw.moisture == null || !Number.isFinite(draw.moisture)) return null;
    wetMassKg -= draw.wet;
    dryMassKg -= draw.wet * (1 - draw.moisture / PERCENT);
  }
  // Feedstock movements retain wet stock semantics. Count moisture is metadata;
  // preserve the remaining pile ratio for this pro-rata stock adjustment.
  const dryFraction = wetMassKg > 0 ? dryMassKg / wetMassKg : null;
  for (const movement of movements) {
    if (dryFraction == null) return null;
    wetMassKg += movement.wet;
    dryMassKg += movement.wet * dryFraction;
  }
  if (!Number.isFinite(wetMassKg) || !Number.isFinite(dryMassKg) || wetMassKg <= 0 || dryMassKg < 0 || dryMassKg > wetMassKg) return null;
  return { wetMassKg, dryMassKg, moisturePercent: (wetMassKg - dryMassKg) / wetMassKg * PERCENT };
}
