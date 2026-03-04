import { z } from "zod";

// ============================================
// Constants and Enums
// ============================================

/**
 * Valid reactor types for pyrolysis equipment
 */
export const reactorTypes = [
  "fixed-bed",
  "auger",
  "rotary-kiln",
  "batch",
  "continuous",
] as const;

export type ReactorType = (typeof reactorTypes)[number];

/**
 * Sampling methods from the Isometric Protocol
 * Method A: Sample every production batch
 * Method B: Sample at least 1 in 10 production batches (requires 30 prior Method A samples)
 */
export const samplingMethods = ["method_a", "method_b"] as const;

export type SamplingMethod = (typeof samplingMethods)[number];

// ============================================
// Reactor Form Schema (Client-side validation)
// ============================================

/**
 * Schema for reactor form (client-side validation)
 * Used in ReactorForm component for creating/editing reactors
 */
export const reactorFormSchema = z.object({
  // Required fields
  identifier: z
    .string()
    .min(1, "Identifier is required")
    .max(255, "Identifier must be less than 255 characters"),
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
  reactorType: z
    .string()
    .min(1, "Reactor type is required"),
  type: z
    .string()
    .min(1, "Type is required")
    .max(255, "Type must be less than 255 characters"),

  // Optional fields
  samplingMethod: z.enum(samplingMethods).default("method_a"),
  capacityKg: z
    .number()
    .positive("Capacity must be a positive number")
    .optional()
    .nullable(),
  specifications: z.record(z.string(), z.unknown()).optional().nullable(),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a reactor (server action)
 * Same as form schema - all required fields must be present
 */
export const createReactorSchema = reactorFormSchema;

/**
 * Schema for updating a reactor (server action)
 * All fields optional except reactorId
 */
export const updateReactorSchema = z.object({
  reactorId: z.string().uuid("Invalid reactor ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  identifier: z.string().min(1).max(255).optional(),
  facilityId: z.string().uuid().optional(),
  reactorType: z.string().min(1).optional(),
  type: z.string().min(1).max(255).optional(),
  samplingMethod: z.enum(samplingMethods).optional(),
  capacityKg: z.number().positive().optional().nullable(),
  specifications: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * Schema for deleting a reactor
 */
export const deleteReactorSchema = z.object({
  reactorId: z.string().uuid("Invalid reactor ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering reactors in list views
 * Used for search, pagination, and filtering
 */
export const reactorFilterSchema = z.object({
  // Text search across code, identifier, type
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by sampling method
  samplingMethod: z.enum(samplingMethods).optional(),

  // Filter by reactor type
  reactorType: z.string().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "identifier", "type", "reactorType", "createdAt", "updatedAt"])
    .default("code"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Schema for selecting a reactor (e.g., in dropdowns)
 */
export const reactorSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  identifier: z.string(),
  facilityId: z.string().uuid(),
  type: z.string(),
  reactorType: z.string(),
});

// ============================================
// Type Inference
// ============================================

export type ReactorFormData = z.infer<typeof reactorFormSchema>;
export type CreateReactorData = z.infer<typeof createReactorSchema>;
export type UpdateReactorData = z.infer<typeof updateReactorSchema>;
export type DeleteReactorData = z.infer<typeof deleteReactorSchema>;
export type ReactorFilterData = z.infer<typeof reactorFilterSchema>;
export type ReactorSelectData = z.infer<typeof reactorSelectSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Format reactor type for display
 */
export function formatReactorType(type: string): string {
  const labels: Record<string, string> = {
    "fixed-bed": "Fixed Bed",
    "auger": "Auger",
    "rotary-kiln": "Rotary Kiln",
    "batch": "Batch",
    "continuous": "Continuous",
  };
  return labels[type] || type;
}

/**
 * Format sampling method for display
 */
export function formatSamplingMethod(method: SamplingMethod): string {
  const labels: Record<SamplingMethod, string> = {
    method_a: "Method A (Every Batch)",
    method_b: "Method B (Every 10th Batch)",
  };
  return labels[method];
}
