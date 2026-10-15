/**
 * Feedstock Validation Schemas
 * Unified schemas for the combined delivery + bin allocation workflow.
 */

import { z } from "zod";
import { optionalDistanceSource } from "./distance-source";
import { exceedsMassWithTolerance } from "@/lib/calculations/mass-dry";
import {
  calendarDateSchema,
  clearablePositiveNumber,
  emptyToNull,
  expectedVersionSchema,
  optionalPositiveNumber,
  pipeToCanonicalNumber,
  positiveMassKgSchema,
  requiredNumber,
  requiredPositiveMassKgSchema,
  storedPercentSchema,
  uuidSchema,
} from "./helpers";

// ============================================
// Shared numeric field helpers
// ============================================

const MOISTURE_MIN = 0;
const MOISTURE_MAX = 100;
const ALLOCATION_OVERAGE_JUSTIFICATION_MESSAGE =
  "Enter a justification when allocated wet mass exceeds the declared delivery mass";

// A feedstock delivery records a physical intake: a zero-mass delivery or bin
// allocation is an auditable no-op record, so both bounds are strictly
// positive. This schema is also the edit resolver, so a record already stored
// with zero mass has to be given a positive mass before it saves — intended,
// since the only way to hold one is a deliberate pre-fix entry and there is no
// production data to grandfather. `updateFeedstockSchema` below applies the
// same positive bound to a wet mass that is present, so the invariant holds at
// the server boundary too. The database requires all intake measurements.
const requiredPositiveMass = requiredPositiveMassKgSchema(
  "Required",
  "Enter a valid number.",
  "Must be greater than 0",
);

const requiredMoisturePercent = pipeToCanonicalNumber(
  requiredNumber(),
  storedPercentSchema()
    .min(MOISTURE_MIN, "Moisture must be at least 0 and below 100")
    .lt(MOISTURE_MAX, "Moisture must be below 100"),
);

// A business date: the day the truck arrived, never an instant (section 3.2
// of the data-entry API plan). Strict so `2026-02-31` cannot roll into March.
const deliveryDateSchema = calendarDateSchema().describe("Facility-local delivery business date, YYYY-MM-DD, never an instant.");

// ============================================
// Bin Allocation Schema
// ============================================

export const binAllocationSchema = z.object({
  storageLocationId: z
    .string()
    .min(1, "Select a storage bin.")
    .uuid("Choose a valid storage bin.").toLowerCase()
    .describe("Receiving storage bin identifier, UUID."),
  allocatedWetMassKg: requiredPositiveMass.describe("Wet mass allocated to this bin in kilograms."),
});

export type BinAllocation = z.infer<typeof binAllocationSchema>;

// ============================================
// Feedstock Form Schema (Client-side)
// ============================================

export const feedstockFormSchema = z.object({
  // --- Delivery fields ---
  facilityId: z
    .string()
    .min(1, "Select a facility.")
    .uuid("Choose a valid facility.").toLowerCase()
    .describe("Receiving facility identifier, UUID."),
  deliveryDate: deliveryDateSchema.describe("Facility-local delivery business date, YYYY-MM-DD, never an instant."),
  supplierId: z
    .string()
    .min(1, "Select a supplier.")
    .uuid("Choose a valid supplier.").toLowerCase()
    .describe("Supplier identifier, UUID."),

  // Optional transport
  vehicleId: emptyToNull.or(uuidSchema()).nullable().optional().describe("Vehicle identifier, UUID, or null when unspecified."),
  // Road distance (km) for the feedstock transport leg — autofills from the
  // supplier's default location distance-to-facility, overridable per delivery. Both fields are
  // transient (not feedstock columns) — they flow into the derived transport
  // leg at sync time.
  transportDistanceKm: optionalPositiveNumber.describe("Transport road distance in kilometres; null clears the distance."),
  transportDistanceSource: optionalDistanceSource.describe("Distance evidence: map_estimate is a mapped route, manual is operator-entered, document is documented evidence; null when unspecified."),

  // --- Material ---
  feedstockTypeId: z
    .string()
    .min(1, "Select a feedstock type.")
    .uuid("Choose a valid feedstock type.").toLowerCase()
    .describe("Feedstock type identifier, UUID."),
  totalWetMassKg: requiredPositiveMass.describe("Declared delivery wet mass in kilograms."),
  moisturePercent: requiredMoisturePercent.describe("Water as percent of wet mass, 0 inclusive to 100 exclusive, not a fraction."),

  // --- Bin Allocations ---
  allocations: z
    .array(binAllocationSchema)
    .min(1, "At least one bin allocation is required")
    .describe("Bin allocations; over-allocation requires overrideJustification."),

  // --- Override ---
  overrideJustification: z
    .string()
    .max(2000, "Justification must be less than 2000 characters")
    .optional()
    .or(z.literal(""))
    .describe("Override justification, plain text."),

  // --- Documentation ---
  notes: z
    .string()
    .max(2000, "Notes must be less than 2000 characters")
    .optional()
    .or(z.literal(""))
    .describe("Operator notes, untrusted plain text."),
}).superRefine((value, ctx) => {
  const allocatedWetMassKg = value.allocations.reduce(
    (sum, allocation) => sum + allocation.allocatedWetMassKg,
    0,
  );

  if (
    exceedsMassWithTolerance(allocatedWetMassKg, value.totalWetMassKg) &&
    !value.overrideJustification?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["overrideJustification"],
      message: ALLOCATION_OVERAGE_JUSTIFICATION_MESSAGE,
    });
  }
});

// ============================================
// Server Action Schemas
// ============================================

export const createFeedstockSchema = feedstockFormSchema.safeExtend({
  deliveryDate: deliveryDateSchema,
});

export const updateFeedstockSchema = z.object({
  feedstockId: uuidSchema("Choose a valid feedstock.").describe("Target feedstock identifier, UUID."),
  expectedVersion: expectedVersionSchema.describe("Positive integer row version loaded before this write."),
  facilityId: uuidSchema().optional().describe("Receiving facility identifier, UUID."),
  deliveryDate: calendarDateSchema().optional().describe("Facility-local delivery business date, YYYY-MM-DD, never an instant."),
  supplierId: uuidSchema().optional().describe("Supplier identifier, UUID."),
  vehicleId: emptyToNull.or(uuidSchema()).nullable().optional().describe("Vehicle identifier, UUID, or null when unspecified."),
  // Clearable, not optional-null: `syncFeedstockTransportLeg` preserves the
  // leg's stored distance only when this key is absent, so an omitted patch
  // must stay `undefined` instead of collapsing to an explicit clear.
  transportDistanceKm: clearablePositiveNumber.describe("Transport road distance in kilometres; null clears the distance."),
  transportDistanceSource: optionalDistanceSource.describe("Distance evidence: map_estimate is a mapped route, manual is operator-entered, document is documented evidence; null when unspecified."),
  feedstockTypeId: uuidSchema().optional().describe("Feedstock type identifier, UUID."),
  massWetKg: positiveMassKgSchema("Must be greater than 0").optional().describe("Allocated wet mass in kilograms."),
  moistureContentPercent: storedPercentSchema().min(MOISTURE_MIN).lt(MOISTURE_MAX).optional().describe("Water as percent of wet mass, 0 inclusive to 100 exclusive, not a fraction."),
  storageLocationId: uuidSchema().optional().describe("Receiving bin identifier, UUID; omitted keeps the current bin."),
  overrideJustification: z.string().max(2000).optional().nullable().or(z.literal(""))
    .describe("Override justification, plain text."),
  notes: z.string().max(2000).optional().nullable().or(z.literal(""))
    .describe("Operator notes, untrusted plain text."),
});

export const deleteFeedstockSchema = z.object({
  expectedVersion: expectedVersionSchema.describe("Positive integer row version loaded before this write."),
  feedstockId: uuidSchema("Choose a valid feedstock.").describe("Target feedstock identifier, UUID."),
});

// ============================================
// Filter Schema
// ============================================

export const feedstockFilterSchema = z.object({
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),
  facilityId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  feedstockTypeId: z.string().uuid().optional(),
  status: z.enum(["missing_data", "complete"]).optional(),
  storageLocationId: z.string().uuid().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["code", "deliveryDate", "massDryKg", "massWetKg", "createdAt", "updatedAt"])
    .default("deliveryDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Scope for the feedstock KPI strip. It is the subset of the list filters that
 * the stat cards honour, so the cards can only ever summarise records the list
 * is also showing.
 */
export const feedstockStatsFilterSchema = feedstockFilterSchema.pick({
  facilityId: true,
  feedstockTypeId: true,
});

// ============================================
// Type Inference
// ============================================

export type FeedstockFormData = z.infer<typeof feedstockFormSchema>;
export type CreateFeedstockData = z.infer<typeof createFeedstockSchema>;
export type UpdateFeedstockData = z.infer<typeof updateFeedstockSchema>;
export type FeedstockFilterData = z.infer<typeof feedstockFilterSchema>;
export type FeedstockStatsFilterData = z.infer<
  typeof feedstockStatsFilterSchema
>;

export type DeleteFeedstockData = z.infer<typeof deleteFeedstockSchema>;
