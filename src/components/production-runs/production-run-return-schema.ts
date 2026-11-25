import { z } from "zod";
import { requiredNumber, requiredPositiveMassKgSchema } from "@/schemas/helpers";
import { RETURN_MOISTURE_PERCENT_STEP, RETURN_PERCENT_SCALE, returnMeasurementSchema } from "@/schemas/production-run-returns";

/**
 * The Return to storage form: the server's measurement schema with the
 * wording an operator reads at each field. Same bounds, same helpers.
 */
export const returnFormSchema = returnMeasurementSchema.extend({
  storageLocationId: z.uuid({ error: "Choose a destination bin." }),
  wetMassKg: requiredPositiveMassKgSchema("Enter the wet mass.", "Wet mass must be a number.", "Wet mass must be greater than 0."),
  moisturePercent: requiredNumber("Enter measured moisture.", "Moisture must be a number.").pipe(
    z.number().min(0, "Moisture must be at least 0%.").lt(RETURN_PERCENT_SCALE, "Moisture must be below 100%.")
      .multipleOf(RETURN_MOISTURE_PERCENT_STEP, "Use at most four decimal places."),
  ),
});
export type ReturnFormInput = z.input<typeof returnFormSchema>;
export type ReturnFormData = z.output<typeof returnFormSchema>;
