// Conditional required-field rules mirror the DB check constraints
// `transport_legs_energy_usage_requirements` and
// `transport_legs_distance_based_requirements`.

import { z } from "zod";
import {
  latitudeSchema,
  longitudeSchema,
  optionalNumber,
  optionalPositiveNumber,
  toNumberOrUndefined,
} from "./helpers";

// ============================================
// Enums
// ============================================

export const transportEntityTypes = [
  "feedstock",
  "biochar",
  "sample",
  "delivery",
] as const;
export type TransportEntityTypeValue = (typeof transportEntityTypes)[number];

export const transportMethods = [
  "road",
  "rail",
  "ship",
  "pipeline",
  "aircraft",
] as const;
export type TransportMethodValue = (typeof transportMethods)[number];

export const emissionsCalculationMethods = [
  "energy_usage",
  "distance_based",
] as const;
export type EmissionsCalculationMethodValue =
  (typeof emissionsCalculationMethods)[number];

// ============================================
// Base shape
// ============================================

const baseTransportLegShape = {
  // Route
  originGpsLatitude: latitudeSchema,
  originGpsLongitude: longitudeSchema,
  originName: z.string().trim().max(255).optional().nullable(),
  destinationGpsLatitude: latitudeSchema,
  destinationGpsLongitude: longitudeSchema,
  destinationName: z.string().trim().max(255).optional().nullable(),
  distanceKm: z.preprocess(
    toNumberOrUndefined,
    z
      .number({
        error: (iss) =>
          iss.input === undefined
            ? "Distance is required"
            : "Distance must be a number",
      })
      .positive("Distance must be greater than 0"),
  ),

  // Transport details
  transportMethodType: z.enum(transportMethods, {
    error: () => "Transport method is required",
  }),
  vehicleType: z.string().trim().max(255).optional().nullable(),
  modelYear: optionalPositiveNumber,

  // Fuel / energy (energy_usage method)
  fuelType: z.string().trim().max(64).optional().nullable(),
  fuelConsumedLiters: optionalPositiveNumber,
  electricityKwh: optionalPositiveNumber,

  // Load mass — required on every leg regardless of calculation method.
  // The Certify aggregator mass-weights distance across a category so that
  // `distance × Σmass × factor = Σⱼ(distⱼ × massⱼ × factor)` (Transportation
  // v1.1 §5), which requires a per-leg mass even for energy_usage legs.
  loadMassKg: z.preprocess(
    toNumberOrUndefined,
    z
      .number({
        error: (iss) =>
          iss.input === undefined
            ? "Load mass is required"
            : "Load mass must be a number",
      })
      .positive("Load mass must be greater than 0"),
  ),

  // Emissions
  calculationMethodType: z.enum(emissionsCalculationMethods, {
    error: () => "Calculation method is required",
  }),
  emissionFactorUsed: optionalNumber,
  emissionFactorSource: z.string().trim().max(500).optional().nullable(),
  transportEmissionsCo2eKg: optionalNumber,

  // Documentation
  billOfLading: z.string().trim().max(255).optional().nullable(),
  weighScaleTicketRef: z.string().trim().max(255).optional().nullable(),
};

// ============================================
// Conditional validators
// ============================================

function refineMethodRequirements(
  data: {
    calculationMethodType: EmissionsCalculationMethodValue;
    fuelType?: string | null;
    fuelConsumedLiters?: number | null;
    electricityKwh?: number | null;
    vehicleType?: string | null;
    emissionFactorUsed?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (data.calculationMethodType === "energy_usage") {
    if (!data.fuelType?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["fuelType"],
        message: "Fuel type is required for energy-usage method",
      });
    }
    const hasFuelOrElectricity =
      (data.fuelConsumedLiters ?? null) !== null ||
      (data.electricityKwh ?? null) !== null;
    if (!hasFuelOrElectricity) {
      ctx.addIssue({
        code: "custom",
        path: ["fuelConsumedLiters"],
        message:
          "Provide either fuel consumed (L) or electricity used (kWh)",
      });
    }
    if ((data.emissionFactorUsed ?? null) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["emissionFactorUsed"],
        message: "Emission factor is required for energy-usage method",
      });
    }
  }

  if (data.calculationMethodType === "distance_based") {
    if (!data.vehicleType?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["vehicleType"],
        message: "Vehicle type is required for distance-based method",
      });
    }
    if ((data.emissionFactorUsed ?? null) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["emissionFactorUsed"],
        message: "Emission factor is required for distance-based method",
      });
    }
  }
}

// ============================================
// Form schema (no entity context)
// ============================================

export const transportLegFormSchema = z
  .object(baseTransportLegShape)
  .superRefine(refineMethodRequirements);

export type TransportLegFormData = z.infer<typeof transportLegFormSchema>;

// ============================================
// Server-action schemas (entity context attached)
// ============================================

const entityContextShape = {
  entityType: z.enum(transportEntityTypes),
  entityId: z.string().uuid("Invalid entity id"),
};

export const createTransportLegSchema = z
  .object({
    ...baseTransportLegShape,
    ...entityContextShape,
  })
  .superRefine(refineMethodRequirements);

export type CreateTransportLegData = z.infer<typeof createTransportLegSchema>;

export const updateTransportLegSchema = z
  .object({
    id: z.string().uuid("Invalid transport leg id"),
    ...baseTransportLegShape,
  })
  .superRefine(refineMethodRequirements);

export type UpdateTransportLegData = z.infer<typeof updateTransportLegSchema>;

export const deleteTransportLegSchema = z.object({
  id: z.string().uuid("Invalid transport leg id"),
});

export type DeleteTransportLegData = z.infer<typeof deleteTransportLegSchema>;
