import { z } from 'zod';
import { massKgSchema, stockEventInstantSchema, storedPercentSchema } from './helpers';

const WET_MASS_REQUIRED = 'Enter the wet mass.';
const MOISTURE_REQUIRED = 'Enter the measured moisture.';
const REASON_REQUIRED = 'Enter a reason.';

// Not `requiredNumber`: the stock forms coerce at the register site
// (`setValueAs: toNumberOrNull`), and docs/forms.md forbids a second layer.
/** Wet mass in kg; a blank or non-numeric entry gets a plain message, not Zod's type error. */
const wetMassSchema = () => z
  .number({ error: iss => iss.input == null ? WET_MASS_REQUIRED : 'Enter the wet mass as a number.' })
  .pipe(massKgSchema().finite());
/** Moisture percent; blank, non-numeric and out-of-range entries get plain messages, not Zod's. */
const moistureSchema = () => z
  .number({ error: iss => iss.input == null ? MOISTURE_REQUIRED : 'Enter the moisture as a number.' })
  .pipe(storedPercentSchema().finite().min(0, 'Enter 0% or more.').lt(100, 'Enter less than 100%.'));
const reasonSchema = (max: number) => z
  .string({ error: REASON_REQUIRED })
  .trim()
  .min(1, REASON_REQUIRED)
  .max(max, `Keep the reason under ${max} characters.`);

/** One sub-bin of a split-bin draw with the moisture read as it was emptied. */
export const orderedSourceSchema = z.object({
  layerId: z.uuid('Choose a sub-bin.'),
  moisturePercent: moistureSchema(),
});
/** A split-bin draw's sub-bins in the order they were emptied: at least one, each once. */
export const orderedSourcesSchema = z.array(orderedSourceSchema).min(1)
  .refine(sources => new Set(sources.map(source => source.layerId)).size === sources.length, 'Choose each sub-bin once.');
export const outputStockPreviewSchema = z.object({
  storageLocationId: z.uuid(),
  facilityId: z.uuid(),
  occurredAt: stockEventInstantSchema(),
  kind: z.enum(['delivery', 'loss', 'count', 'production_draw']),
  wetMassKg: wetMassSchema(),
  moisturePercent: moistureSchema().nullable().optional(),
  correctsMovementId: z.uuid().optional(),
  /** Split bins: sub-bins in the order they were emptied. Absent means oldest first at one reading. */
  sources: orderedSourcesSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.kind !== 'count' && value.wetMassKg === 0)
    ctx.addIssue({ code: 'custom', path: ['wetMassKg'], message: 'Wet mass must be greater than zero.' });
  if (value.sources && value.kind === 'count')
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'A count covers the whole bin.' });
  // A correction may replay the original readings, so the server decides there.
  if (!(value.kind === 'count' && value.wetMassKg === 0) && !value.sources && !value.correctsMovementId && value.moisturePercent == null)
    ctx.addIssue({ code: 'custom', path: ['moisturePercent'], message: MOISTURE_REQUIRED });
});
export const outputStockPostSchema = outputStockPreviewSchema.safeExtend({
  basisFingerprint: z.string().min(1),
  idempotencyKey: z.string().trim().min(1).max(200),
  reason: reasonSchema(2000),
});
export const outputSubBinsSchema = z.object({
  storageLocationId: z.uuid(),
  facilityId: z.uuid(),
  occurredAt: stockEventInstantSchema(),
  correctsMovementId: z.uuid().optional(),
  kind: z.enum(['delivery', 'loss', 'count', 'production_draw']).optional(),
});
export const matchingOutputBinsSchema = z.object({ facilityId: z.uuid(), formulationId: z.uuid() });
