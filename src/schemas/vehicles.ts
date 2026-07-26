/**
 * Vehicle Validation Schemas
 * Zod schemas for vehicle CRUD operations
 */

import { z } from "zod";

// ============================================
// Constants
// ============================================

export const vehicleTypes = [
  "truck",
  "tractor",
  "van",
  "pickup",
  "trailer",
] as const;

export type VehicleType = (typeof vehicleTypes)[number];

export const VEHICLE_TYPE_OPTIONS: ReadonlyArray<{ value: VehicleType; label: string }> = [
  { value: "truck", label: "Truck" },
  { value: "tractor", label: "Tractor" },
  { value: "van", label: "Van" },
  { value: "pickup", label: "Pickup" },
  { value: "trailer", label: "Trailer" },
];

/**
 * Display label for a stored `vehicles.vehicle_type` value. The column is free
 * text seeded from the lowercase {@link vehicleTypes} slugs, so read surfaces
 * must never render it raw. Unknown/legacy values fall back to sentence case.
 */
export function formatVehicleType(value: string): string {
  const known = VEHICLE_TYPE_OPTIONS.find((option) => option.value === value);
  if (known) return known.label;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export const fuelTypes = [
  "Diesel",
  "Gasoline",
  "Electric",
  "Hybrid",
  "Biodiesel",
] as const;

export type FuelType = (typeof fuelTypes)[number];

export const FUEL_TYPE_OPTIONS: ReadonlyArray<{ value: FuelType; label: string }> = [
  { value: "Diesel", label: "Diesel" },
  { value: "Gasoline", label: "Gasoline" },
  { value: "Electric", label: "Electric" },
  { value: "Hybrid", label: "Hybrid" },
  { value: "Biodiesel", label: "Biodiesel" },
];

// ============================================
// Vehicle Form Schema (Client-side validation)
// ============================================

export const vehicleFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Vehicle name is required")
    .max(255, "Vehicle name must be less than 255 characters"),
  // Optional: audit/evidence metadata, not used in the certified transport calc.
  identifier: z
    .string()
    .max(50, "Identifier must be less than 50 characters")
    .optional(),
  // Required: the only vehicle field that drives the certified emission factor.
  vehicleType: z
    .string()
    .min(1, "Vehicle type is required")
    .max(50, "Vehicle type must be less than 50 characters"),
  // Optional: operational metadata only.
  fuelType: z
    .string()
    .max(50, "Fuel type must be less than 50 characters")
    .optional(),
  /** Stored as L/100km in the form, converted to L/km before server submission */
  fuelConsumptionLPer100Km: z
    .number()
    .positive("Fuel consumption must be positive")
    .max(1000, "Fuel consumption seems too high")
    .optional()
    .nullable(),
  // Optional: a not-yet-submitted factor-uniformity hedge, not a certified input.
  modelYear: z
    .number()
    .int("Model year must be a whole number")
    .min(1900, "Model year must be 1900 or later")
    .max(new Date().getFullYear() + 1, "Model year cannot be in the future")
    .optional()
    .nullable(),
});

// ============================================
// Server Action Schemas
// ============================================

export const createVehicleSchema = vehicleFormSchema;

export const updateVehicleSchema = z.object({
  vehicleId: z.string().uuid("Invalid vehicle ID"),
  name: z.string().trim().min(1).max(255).optional(),
  identifier: z.string().max(50).optional().nullable(),
  vehicleType: z.string().min(1).max(50).optional(),
  fuelType: z.string().max(50).optional().nullable(),
  fuelConsumptionLPer100Km: z.number().positive().max(1000).optional().nullable(),
  modelYear: z.number().int().min(1900).max(new Date().getFullYear() + 1).optional().nullable(),
});

export const deleteVehicleSchema = z.object({
  vehicleId: z.string().uuid("Invalid vehicle ID"),
});

// ============================================
// Type Inference
// ============================================

export type VehicleFormData = z.infer<typeof vehicleFormSchema>;
export type CreateVehicleData = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleData = z.infer<typeof updateVehicleSchema>;
export type DeleteVehicleData = z.infer<typeof deleteVehicleSchema>;

// ============================================
// Helpers
// ============================================

/** Convert L/100km (user-friendly) to L/km (DB storage) */
export function lPer100KmToLPerKm(lPer100Km: number): number {
  return lPer100Km / 100;
}

/** Convert L/km (DB storage) to L/100km (user-friendly) */
export function lPerKmToLPer100Km(lPerKm: number): number {
  return lPerKm * 100;
}
