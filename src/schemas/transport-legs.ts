// Transport legs use the Isometric distance-based method (Eq. 3): we record
// distance + cargo mass per leg; the emission factor lives in the Isometric
// component blueprint (not stored here). Required fields mirror the DB check
// `transport_legs_distance_based_requirements` (load mass present).

import { z } from "zod";
import { optionalDistanceSource } from "./distance-source";
import {
  latitudeSchema,
  longitudeSchema,
  optionalPositiveNumber,
  requiredPositiveMassKgSchema,
  toNumberOrUndefined,
} from "./helpers";

// ============================================
// Enums
// ============================================

export const transportEntityTypes = [
  "feedstock",
  "biochar",
  "sample",
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

// The full enum stays valid for storage/back-compat, but the UI only offers
// methods whose emission-factor component is bound in the Isometric biochar
// blueprint. Today that's road only; add others here once the blueprint binds
// them (Transportation v1.1 supports rail/ship/pipeline/aircraft too).
export const selectableTransportMethods = ["road"] as const satisfies readonly TransportMethodValue[];

// Distance-based is the only method: we never meter fuel, so emissions are
// always distance × cargo-mass × (Isometric component factor).
export const emissionsCalculationMethods = ["distance_based"] as const;
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
  // Provenance of distanceKm (audit metadata; defaults to manual at the write
  // boundary — explicit/manual legs own their distance and its source).
  distanceSource: optionalDistanceSource,

  // Transport details. Vehicle type is metadata that maps to the Isometric
  // component's emission factor (Eq. 3) — optional, not a blocker.
  transportMethodType: z
    .enum(transportMethods, { error: () => "Transport method is required" })
    .default("road"),
  vehicleType: z.string().trim().max(255).optional().nullable(),
  modelYear: optionalPositiveNumber,

  // Cargo mass moved on this leg (Eq. 3, W_j) — required on every leg so the
  // Certify aggregator can mass-weight distance across a category.
  loadMassKg: requiredPositiveMassKgSchema(
    "Load mass is required",
    "Load mass must be a number",
    "Load mass must be greater than 0",
  ),

  // Method — distance_based only.
  calculationMethodType: z
    .enum(emissionsCalculationMethods)
    .default("distance_based"),

  // Documentation (Isometric §6 verification evidence — optional, attachable later).
  billOfLading: z.string().trim().max(255).optional().nullable(),
  weighScaleTicketRef: z.string().trim().max(255).optional().nullable(),
};

// ============================================
// Form schema (no entity context)
// ============================================

export const transportLegFormSchema = z.object(baseTransportLegShape);

export type TransportLegFormData = z.infer<typeof transportLegFormSchema>;

// ============================================
// Server-action schemas (entity context attached)
// ============================================

const entityContextShape = {
  entityType: z.enum(transportEntityTypes),
  entityId: z.string().uuid("Invalid entity id"),
};

export const createTransportLegSchema = z.object({
  ...baseTransportLegShape,
  ...entityContextShape,
});

export type CreateTransportLegData = z.infer<typeof createTransportLegSchema>;

export const updateTransportLegSchema = z.object({
  id: z.string().uuid("Invalid transport leg id"),
  ...baseTransportLegShape,
});

export type UpdateTransportLegData = z.infer<typeof updateTransportLegSchema>;

export const deleteTransportLegSchema = z.object({
  id: z.string().uuid("Invalid transport leg id"),
});

export type DeleteTransportLegData = z.infer<typeof deleteTransportLegSchema>;
