/** Throwaway synthetic form only. Never use as an accounting or mutation schema. */
import { z } from "zod";
import { requiredMassKgSchema, optionalPercent } from "./helpers";
const mass = requiredMassKgSchema();
const moisture = optionalPercent.transform((value, ctx) => {
  if (value == null) {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  return value;
});
const commonFields = z.object({
  placedAt: z.iso.date({ error: "Enter a valid date." }),
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
