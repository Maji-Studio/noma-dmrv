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
