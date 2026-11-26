import { z } from 'zod';
import { requiredPositiveMassKgSchema, requiredNumber, stockEventInstantSchema, uuidSchema } from './helpers';

const REASON_MAX_LENGTH = 1_000;
const REQUEST_KEY_MAX_LENGTH = 200;
export const RETURN_PERCENT_SCALE = 100;
// fraction columns persist six decimal places, hence four places in percent.
export const RETURN_MOISTURE_PERCENT_STEP = 0.0001;
const reasonSchema = z.string().trim().min(1, 'Enter a reason.').max(REASON_MAX_LENGTH);
const requestKeySchema = z.string().trim().min(1, 'Start a new return entry.').max(REQUEST_KEY_MAX_LENGTH);

export const returnMeasurementSchema = z.object({
  storageLocationId: uuidSchema('Choose a destination bin.'),
  wetMassKg: requiredPositiveMassKgSchema(),
  moisturePercent: requiredNumber('Enter measured moisture.').pipe(z.number().min(0).lt(RETURN_PERCENT_SCALE)
    .multipleOf(RETURN_MOISTURE_PERCENT_STEP)),
  occurredAt: stockEventInstantSchema(),
  reason: reasonSchema,
});
/**
 * The Return to storage form: the server's measurement schema with the
 * wording an operator reads at each field. Same bounds, same helpers.
 */
export const returnFormSchema = returnMeasurementSchema.extend({
  wetMassKg: requiredPositiveMassKgSchema("Enter the wet mass.", "Wet mass must be a number.", "Wet mass must be greater than 0."),
  moisturePercent: requiredNumber("Enter measured moisture.", "Moisture must be a number.").pipe(
    z.number().min(0, "Moisture must be at least 0%.").lt(RETURN_PERCENT_SCALE, "Moisture must be below 100%.")
      .multipleOf(RETURN_MOISTURE_PERCENT_STEP, "Use at most four decimal places."),
  ),
});
export type ReturnFormInput = z.input<typeof returnFormSchema>;
export type ReturnFormData = z.output<typeof returnFormSchema>;

export const recordProductionRunReturnSchema = returnMeasurementSchema.extend({
  sourceProductionRunId: uuidSchema(),
  idempotencyKey: requestKeySchema,
});
export const correctProductionRunReturnSchema = z.object({
  sourceProductionRunId: uuidSchema(),
  storageLocationId: uuidSchema(),
  correctsMovementId: uuidSchema(),
  idempotencyKey: requestKeySchema,
  reason: reasonSchema,
  replacement: returnMeasurementSchema.nullable(),
});
export type ReturnMeasurement = z.infer<typeof returnMeasurementSchema>;
export type RecordProductionRunReturnInput = z.infer<typeof recordProductionRunReturnSchema>;
export type CorrectProductionRunReturnInput = z.infer<typeof correctProductionRunReturnSchema>;
