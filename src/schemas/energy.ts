/**
 * Energy page read input: a facility and a facility-local day range. `from`
 * is null for all time.
 */
import { z } from "zod";

export const energyBreakdownInputSchema = z
  .object({
    facilityId: z.uuid(),
    from: z.iso.date().nullable(),
    to: z.iso.date(),
  })
  .refine((input) => input.from == null || input.from <= input.to, {
    message: "The period must start on or before its end.",
    path: ["from"],
  });

export type EnergyBreakdownInput = z.infer<typeof energyBreakdownInputSchema>;
