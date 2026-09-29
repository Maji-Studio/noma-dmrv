import { z } from 'zod';
import { massKgSchema, stockEventInstantSchema, storedPercentSchema } from './helpers';

/** One sub-bin of a split-bin draw with the moisture read as it was emptied. */
export const orderedSourceSchema = z.object({
  layerId: z.uuid(),
  moisturePercent: storedPercentSchema().finite().min(0).lt(100),
});
export const outputStockPreviewSchema = z.object({
  storageLocationId: z.uuid(),
  facilityId: z.uuid(),
  occurredAt: stockEventInstantSchema(),
  kind: z.enum(['delivery', 'loss', 'count', 'production_draw']),
  wetMassKg: massKgSchema().finite(),
  moisturePercent: storedPercentSchema().finite().min(0).lt(100).nullable().optional(),
  correctsMovementId: z.uuid().optional(),
  /** Split bins: sub-bins in the order they were emptied. Absent means oldest first at one reading. */
  sources: z.array(orderedSourceSchema).min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.kind !== 'count' && value.wetMassKg === 0)
    ctx.addIssue({ code: 'custom', path: ['wetMassKg'], message: 'Wet mass must be greater than zero.' });
  if (value.sources && value.kind === 'count')
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'A count covers the whole bin.' });
  // A correction of a split-bin draw reuses the original readings, so the server decides there.
  if (!(value.kind === 'count' && value.wetMassKg === 0) && !value.sources && !value.correctsMovementId && value.moisturePercent == null)
    ctx.addIssue({ code: 'custom', path: ['moisturePercent'], message: 'Enter the measured moisture.' });
});
export const outputStockPostSchema = outputStockPreviewSchema.safeExtend({
  basisFingerprint: z.string().min(1),
  idempotencyKey: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
});
export const matchingOutputBinsSchema = z.object({ facilityId: z.uuid(), formulationId: z.uuid() });
