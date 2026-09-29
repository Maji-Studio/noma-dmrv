import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, feedstocks, productionRunFeedstockDraws, productionRuns } from '@/db/schema';
import { GRAMS_PER_KILOGRAM, toPersistedMassGrams } from '@/lib/biochar-composition/composition';
import type { OrgContext } from '@/lib/auth/server';
import { and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { STORED_PERCENT_INPUT_STEP } from '@/schemas/helpers';
import { requireOrgScope } from './utils';

const PERCENT = 100;

/** Remaining wet/dry basis, after saved withdrawals. Shared by prefill and posting. */
export async function getIngredientStockBasis(ctx: OrgContext, storageLocationId: string, occurredAt?: string, reader: Pick<DbTransaction, 'select'> = db, excludeProductId?: string) {
  requireOrgScope(ctx);
  const at = occurredAt ? new Date(z.iso.datetime().parse(occurredAt)) : undefined;
  const intakes = await reader.select({ wet: feedstocks.massWetKg, dry: feedstocks.massDryKg }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId),
      eq(feedstocks.status, 'complete'), isNull(feedstocks.archivedAt),
      at ? lte(feedstocks.deliveryDate, at) : undefined));
  const products = await reader.select({ composition: biocharProducts.composition }).from(biocharProducts)
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), excludeProductId ? ne(biocharProducts.id, excludeProductId) : undefined,
      at ? lte(biocharProducts.placedAt, at) : undefined,
      sql`${biocharProducts.composition}->'ingredients' @> ${JSON.stringify([{ storageLocationId }])}::jsonb`));
  const draws = await reader.select({ wet: productionRunFeedstockDraws.wetMassKg })
    .from(productionRunFeedstockDraws).innerJoin(productionRuns, and(eq(productionRuns.id, productionRunFeedstockDraws.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.storageLocationId, storageLocationId), ne(productionRuns.status, 'cancelled'),
      at ? lte(productionRuns.startTime, at) : undefined));
  // created_at is a UTC timestamp without zone; read it as UTC, never in the session zone.
  const movements = await reader.select({ wet: binMovements.massDeltaKg }).from(binMovements)
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.lane, 'feedstock'),
      at ? sql`coalesce(${binMovements.occurredAt}, ${binMovements.createdAt} at time zone 'UTC') <= ${at.toISOString()}::timestamptz` : undefined));
  // Stored masses have gram precision. Integer sums make the basis independent
  // of query row order without rounding the remaining solids ratio.
  let intakeWetGrams = 0;
  let intakeDryGrams = 0;
  let hasDryBasis = true;
  for (const intake of intakes) {
    if (intake.wet == null || !Number.isFinite(intake.wet)) return null;
    intakeWetGrams += toPersistedMassGrams(intake.wet);
    if (intake.dry == null || !Number.isFinite(intake.dry) || intake.dry < 0 || intake.dry > intake.wet) hasDryBasis = false;
    else intakeDryGrams += toPersistedMassGrams(intake.dry);
  }
  let remainingWetGrams = intakeWetGrams;
  for (const product of products) {
    const ingredients = (product.composition as { ingredients?: { storageLocationId?: string; massKg: number }[] }).ingredients ?? [];
    for (const ingredient of ingredients) {
      if (ingredient.storageLocationId === storageLocationId && ingredient.massKg > 0) remainingWetGrams -= toPersistedMassGrams(ingredient.massKg);
    }
  }
  for (const draw of draws) remainingWetGrams -= toPersistedMassGrams(draw.wet);
  for (const movement of movements) remainingWetGrams += toPersistedMassGrams(movement.wet);
  const wetMassKg = remainingWetGrams / GRAMS_PER_KILOGRAM;
  if (!Number.isFinite(wetMassKg)) return null;
  // Same pro-rata remaining estimate as deriveLaneStock: processing measurements
  // never subtract solids from the pile. Keep the ratio unrounded internally.
  const dryMassKg = hasDryBasis && intakeWetGrams > 0 ? wetMassKg * (intakeDryGrams / intakeWetGrams) : null;
  return { wetMassKg, dryMassKg };
}

/** Stored-precision prefill; callers calculating solids must use the mass ratio. */
export async function getIngredientMoistureBasis(ctx: OrgContext, storageLocationId: string, occurredAt?: string, reader: Pick<DbTransaction, 'select'> = db, excludeProductId?: string) {
  requireOrgScope(ctx);
  const basis = await getIngredientStockBasis(ctx, storageLocationId, occurredAt, reader, excludeProductId);
  if (!basis || basis.wetMassKg <= 0 || basis.dryMassKg === null || basis.dryMassKg < 0 || basis.dryMassKg > basis.wetMassKg) return null;
  const precisionFactor = 1 / STORED_PERCENT_INPUT_STEP;
  const moisturePercent = Math.round((basis.wetMassKg - basis.dryMassKg) / basis.wetMassKg * PERCENT * precisionFactor) / precisionFactor;
  return { ...basis, dryMassKg: basis.dryMassKg, moisturePercent };
}
