/** Throwaway synthetic form only. Never use as an accounting or mutation schema. */
import { z } from "zod";
import { requiredNumber, MASS_INPUT_MAX_KG } from "./helpers";
const PERCENT_MAX = 100;
const mass = requiredNumber().pipe(z.number().min(0).max(MASS_INPUT_MAX_KG));
const moisture = requiredNumber().pipe(z.number().min(0).max(PERCENT_MAX));
const commonFields = z.object({
  sourceWet: mass,
  sourceMoisture: moisture,
  water: mass,
  requestedWet: mass,
  destination: z.enum(["A", "B"]),
});
export const productOrderPrototypeSchema = z.discriminatedUnion("formulation", [
  commonFields.extend({
    formulation: z.literal("blend"),
    ingredientWet: mass,
    ingredientMoisture: moisture,
  }),
  commonFields.extend({
    formulation: z.literal("plain"),
    ingredientWet: z.unknown().transform(() => 0),
    ingredientMoisture: z.unknown().transform(() => 0),
  }),
]);
export type ProductOrderPrototypeInput = z.input<typeof productOrderPrototypeSchema>;
