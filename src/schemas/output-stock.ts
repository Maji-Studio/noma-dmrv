import { z } from 'zod';
import { massKgSchema, storedPercentSchema } from './helpers';

export const outputStockPreviewSchema = z.object({
  storageLocationId: z.uuid(),
  facilityId: z.uuid(),
  physicalDate: z.iso.date(),
  kind: z.enum(['delivery', 'loss', 'count', 'production_draw']),
  wetMassKg: massKgSchema().finite(),
  moisturePercent: storedPercentSchema().finite().min(0).lt(100).nullable().optional(),
  correctsMovementId: z.uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.kind !== 'count' && value.wetMassKg === 0)
    ctx.addIssue({ code: 'custom', path: ['wetMassKg'], message: 'Wet mass must be greater than zero.' });
  if (!(value.kind === 'count' && value.wetMassKg === 0) && value.moisturePercent == null)
    ctx.addIssue({ code: 'custom', path: ['moisturePercent'], message: 'Enter the measured moisture.' });
});
export const outputStockPostSchema = outputStockPreviewSchema.safeExtend({
  basisFingerprint: z.string().min(1),
  idempotencyKey: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
});
export const matchingOutputBinsSchema = z.object({ facilityId: z.uuid(), formulationId: z.uuid() });
