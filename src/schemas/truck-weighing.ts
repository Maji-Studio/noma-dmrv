import { z } from "zod";

export const optionalTruckMass = z.number().finite().optional().nullable();

export interface TruckWeighingFields {
  truckMassOnArrivalKg?: number | null;
  truckMassOnDepartureKg?: number | null;
}

export function validateTruckMasses(
  value: TruckWeighingFields,
  ctx: z.RefinementCtx,
) {
  if (value.truckMassOnArrivalKg != null && value.truckMassOnArrivalKg < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["truckMassOnArrivalKg"],
      message: "Truck mass on arrival must be >= 0",
    });
  }

  if (value.truckMassOnDepartureKg != null && value.truckMassOnDepartureKg < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["truckMassOnDepartureKg"],
      message: "Truck mass on departure must be >= 0",
    });
  }

  if (
    value.truckMassOnArrivalKg != null &&
    value.truckMassOnDepartureKg != null &&
    value.truckMassOnDepartureKg > value.truckMassOnArrivalKg
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["truckMassOnDepartureKg"],
      message: "Truck mass after unloading cannot exceed mass before unloading",
    });
  }
}
