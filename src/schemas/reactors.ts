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
    .trim()
    .min(1, "Identifier is required")
    .max(255, "Identifier must be less than 255 characters"),
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
  reactorType: z.enum(reactorTypes, { error: "Reactor type is required" }),

  // Optional fields
  capacityTph: z
    .number()
    .positive("Throughput must be a positive number")
    .optional()
    .nullable(),
  specifications: z.record(z.string(), z.unknown()).optional().nullable(),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a reactor (server action)
 * nominalThroughputTph stores tonnes-per-hour directly
 */
export const createReactorSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  facilityId: z.string().min(1).uuid(),
  reactorType: z.enum(reactorTypes),
  nominalThroughputTph: z.number().positive().optional().nullable(),
  specifications: z.record(z.string(), z.unknown()).optional().nullable(),
});

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
  identifier: z.string().trim().min(1).max(255).optional(),
  facilityId: z.string().uuid().optional(),
  reactorType: z.enum(reactorTypes).optional(),
  nominalThroughputTph: z.number().positive().optional().nullable(),
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

  // Filter by reactor type
  reactorType: z.string().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "identifier", "reactorType", "createdAt", "updatedAt"])
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
