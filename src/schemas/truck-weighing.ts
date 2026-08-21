import { z } from "zod";
import { massKgSchema } from "./helpers";

export const optionalTruckMass = z
  .number({ error: "Enter a valid observed truck mass" })
  .pipe(massKgSchema("Observed truck mass must be 0 kg or more"))
  .optional()
  .nullable();

export interface TruckWeighingFields {
  truckMassOnArrivalKg?: number | null;
  truckMassOnDepartureKg?: number | null;
}

export function validateTruckMasses(
  value: TruckWeighingFields,
  ctx: z.RefinementCtx,
): void {
  if (
    value.truckMassOnArrivalKg != null &&
    value.truckMassOnDepartureKg != null &&
    value.truckMassOnDepartureKg > value.truckMassOnArrivalKg
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["truckMassOnDepartureKg"],
      message:
        "Truck mass after unloading cannot exceed truck mass before unloading",
    });
  }
}
