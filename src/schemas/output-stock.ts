import { z } from 'zod';
import { expectedVersionSchema, massKgSchema, stockEventInstantSchema, storedPercentSchema } from './helpers';

const WET_MASS_REQUIRED = 'Enter the wet mass.';
const MOISTURE_REQUIRED = 'Enter the measured moisture.';
const REASON_REQUIRED = 'Enter a reason.';
/** Longest reason a stock movement keeps. */
export const OUTPUT_STOCK_REASON_MAX_LENGTH = 2000;
/** Longest client request key a stock movement keeps. */
export const OUTPUT_STOCK_REQUEST_KEY_MAX_LENGTH = 200;

// Not `requiredNumber`: the stock forms coerce at the register site
// (`setValueAs: toNumberOrNull`), and docs/forms.md forbids a second layer.
/** Wet mass in kg; a blank or non-numeric entry gets a plain message, not Zod's type error. */
export const wetMassSchema = () => z
  .number({ error: iss => iss.input == null ? WET_MASS_REQUIRED : 'Enter the wet mass as a number.' })
  .pipe(massKgSchema().finite());
/** Moisture percent; blank, non-numeric and out-of-range entries get plain messages, not Zod's. */
export const moistureSchema = () => z
  .number({ error: iss => iss.input == null ? MOISTURE_REQUIRED : 'Enter the moisture as a number.' })
  .pipe(storedPercentSchema().finite().min(0, 'Enter 0% or more.').lt(100, 'Enter less than 100%.'));
export const reasonSchema = (max: number) => z
  .string({ error: REASON_REQUIRED })
  .trim()
  .min(1, REASON_REQUIRED)
  .max(max, `Keep the reason under ${max} characters.`);

/** Bounds the sub-bins or ingredients one stock entry may list, as for run draws. */
export const MAX_STOCK_ENTRY_ITEMS = 200;

/** One sub-bin of a split-bin draw with the moisture read as it was emptied. */
export const orderedSourceSchema = z.object({
  layerId: z.uuid('Choose a sub-bin.').describe('Sub-bin drawn: on a biochar bin, the UUID of the production run that filled it; on a product bin, the UUID of the biochar product placed in it.'),
  moisturePercent: moistureSchema().describe('Measured moisture of this sub-bin as percent of wet mass, below 100.'),
});
/** A split-bin draw's sub-bins in the order they were emptied: at least one, each once. */
export const orderedSourcesSchema = z.array(orderedSourceSchema).min(1).max(MAX_STOCK_ENTRY_ITEMS)
  .refine(sources => new Set(sources.map(source => source.layerId)).size === sources.length, 'Choose each sub-bin once.');
/** The fields every output-stock entry rule reads. */
interface OutputStockEntry {
  kind: string;
  wetMassKg: number;
  moisturePercent?: number | null;
  correctsMovementId?: string;
  sources?: unknown[];
}

/** Cross-field rules shared by the forms and the `record_output_stock_movement` operation. */
export function refineOutputStockEntry(value: OutputStockEntry, ctx: z.RefinementCtx<OutputStockEntry>) {
  if (value.kind !== 'count' && value.wetMassKg === 0)
    ctx.addIssue({ code: 'custom', path: ['wetMassKg'], message: 'Wet mass must be greater than zero.' });
  if (value.sources && value.kind === 'count')
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'A count covers the whole bin.' });
  // A correction may replay the original readings, so the server decides there.
  if (!(value.kind === 'count' && value.wetMassKg === 0) && !value.sources && !value.correctsMovementId && value.moisturePercent == null)
    ctx.addIssue({ code: 'custom', path: ['moisturePercent'], message: MOISTURE_REQUIRED });
}

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
}).superRefine(refineOutputStockEntry);
/**
 * A stock command as the posting seam takes it. The stock basis and the
 * product versions are optional preconditions: without them a command acts on
 * current stock under the bin lock (decision 53).
 */
export const outputStockCommandSchema = outputStockPreviewSchema.safeExtend({
  expectedProductVersions: z.record(z.uuid(), expectedVersionSchema).optional(),
  basisFingerprint: z.string().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(OUTPUT_STOCK_REQUEST_KEY_MAX_LENGTH),
  reason: reasonSchema(OUTPUT_STOCK_REASON_MAX_LENGTH),
});
/** The stock forms always send the preview they showed. */
export const outputStockPostSchema = outputStockCommandSchema.safeExtend({
  expectedProductVersions: z.record(z.uuid(), expectedVersionSchema),
  basisFingerprint: z.string().min(1),
});
export const outputSubBinsSchema = z.object({
  storageLocationId: z.uuid(),
  facilityId: z.uuid(),
  occurredAt: stockEventInstantSchema(),
  correctsMovementId: z.uuid().optional(),
  kind: z.enum(['delivery', 'loss', 'count', 'production_draw']).optional(),
});
export const matchingOutputBinsSchema = z.object({ facilityId: z.uuid(), formulationId: z.uuid() });
