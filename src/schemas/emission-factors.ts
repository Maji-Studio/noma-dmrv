/**
 * Facility emission factors: the settings form and its save action share this
 * schema, so client validation and the server trust boundary cannot drift.
 * `organizationId` is never in the payload; it is stamped from the session.
 */
import { z } from "zod";
import {
  EMISSION_FACTOR_INPUT_MAX,
  EMISSION_FACTOR_SOURCE_NOTE_MAX_LENGTH,
} from "@/config/emission-factors";
import { requiredNumber } from "./helpers";

function factorField(requiredMessage: string) {
  return requiredNumber(requiredMessage).pipe(
    z
      .number()
      .min(0, "Enter 0 or more.")
      .max(EMISSION_FACTOR_INPUT_MAX, `Enter ${EMISSION_FACTOR_INPUT_MAX.toLocaleString("en-US")} or less.`),
  );
}

export const facilityEmissionFactorsFormSchema = z.object({
  dieselKgCo2ePerLitre: factorField("Enter a diesel factor."),
  gridKgCo2ePerKwh: factorField("Enter a grid electricity factor."),
  roadFreightKgCo2ePerTonneKm: factorField("Enter a road freight factor."),
  sourceNote: z
    .string()
    .trim()
    .max(
      EMISSION_FACTOR_SOURCE_NOTE_MAX_LENGTH,
      `Source must be ${EMISSION_FACTOR_SOURCE_NOTE_MAX_LENGTH} characters or fewer.`,
    )
    .transform((value) => value || null)
    .nullable(),
});

export const saveFacilityEmissionFactorsSchema =
  facilityEmissionFactorsFormSchema.extend({ facilityId: z.uuid() });

/** What the form holds: numbers arrive as strings from the inputs. */
export type FacilityEmissionFactorsInput = z.input<
  typeof facilityEmissionFactorsFormSchema
>;
export type FacilityEmissionFactorsValues = z.output<
  typeof facilityEmissionFactorsFormSchema
>;
export type SaveFacilityEmissionFactorsData = z.output<
  typeof saveFacilityEmissionFactorsSchema
>;
