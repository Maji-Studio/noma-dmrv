import { replayFeedstockBinStock } from './feedstock-bin-ledger';
import { db, type DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { z } from 'zod';
import { STORED_PERCENT_INPUT_STEP } from '@/schemas/helpers';
import { requireOrgScope } from './utils';

const PERCENT = 100;

/** Remaining wet/dry basis, after saved withdrawals. Shared by prefill and posting. */
export async function getIngredientStockBasis(ctx: OrgContext, storageLocationId: string, occurredAt?: string, reader: Pick<DbTransaction, 'select'> = db, excludeProductId?: string, drawWetKg?: number) {
  requireOrgScope(ctx);
  const at = occurredAt ? new Date(z.iso.datetime().parse(occurredAt)) : undefined;
  const stock = await replayFeedstockBinStock(ctx, storageLocationId, reader, { occurredAt: at?.toISOString(), excludeProductId, drawWetKg });
  return { wetMassKg: stock.currentWetKg, dryMassKg: stock.remainingDryKg, ...(drawWetKg === undefined ? {} : { estimatedDrawDryKg: stock.estimatedDrawDryKg }) };
}

/** Stored-precision prefill; callers calculating solids must use the mass ratio. */
export async function getIngredientMoistureBasis(ctx: OrgContext, storageLocationId: string, occurredAt?: string, reader: Pick<DbTransaction, 'select'> = db, excludeProductId?: string, drawWetKg?: number) {
  requireOrgScope(ctx);
  const stock = await getIngredientStockBasis(ctx, storageLocationId, occurredAt, reader, excludeProductId, drawWetKg);
  const basis = drawWetKg === undefined ? { wetMassKg: stock.wetMassKg, dryMassKg: stock.dryMassKg }
    : { wetMassKg: drawWetKg, dryMassKg: stock.estimatedDrawDryKg ?? null };
  if (!basis || basis.wetMassKg <= 0 || basis.dryMassKg === null || basis.dryMassKg < 0 || basis.dryMassKg > basis.wetMassKg) return null;
  const precisionFactor = 1 / STORED_PERCENT_INPUT_STEP;
  const moisturePercent = Math.round((basis.wetMassKg - basis.dryMassKg) / basis.wetMassKg * PERCENT * precisionFactor) / precisionFactor;
  return { ...basis, dryMassKg: basis.dryMassKg, moisturePercent };
}
