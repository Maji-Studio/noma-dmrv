/**
 * Production Runs Validation Schemas
 * Zod schemas for production run forms, server actions, and filtering
 * Includes multi-select feedstocks with M:M relationship
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

// ============================================
// Constants and Enums
// ============================================

/**
 * Valid production run statuses
 */
export const productionRunStatuses = [
  "draft",
  "running",
  "complete",
  "void",
] as const;

export type ProductionRunStatus = (typeof productionRunStatuses)[number];

// ============================================
// Feedstock Selection Schema (M:M relationship)
// ============================================

/**
 * Schema for individual feedstock selection with mass
 * Used in the multi-select feedstock picker
 */
export const productionRunFeedstockSchema = z.object({
  feedstockId: z.string().uuid("Please select a valid feedstock"),
  massUsedKg: z
    .number()
    .positive("Mass must be a positive number")
    .max(1000000, "Mass must be less than 1,000,000 kg"),
});

export type ProductionRunFeedstockData = z.infer<typeof productionRunFeedstockSchema>;

// ============================================
// Production Run Form Schema (Client-side validation)
// ============================================

/**
 * Schema for production run form (client-side validation)
 * Used in ProductionRunForm component for creating/editing runs
 */
export const productionRunFormSchema = z.object({
  // Required fields
  code: z
    .string()
    .max(50, "Code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
  date: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]),
  reactorId: z.string().min(1, "Please select a reactor").uuid("Please select a valid reactor"),

  // Status
  status: z.enum(productionRunStatuses).default("draft"),

  // Timing
  startTime: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]),
  endTime: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]),

  // Operator (optional)
  operatorId: emptyToNull.or(z.string().uuid()).nullable().optional(),

  // Multi-select feedstocks (M:M relationship)
  feedstocks: z
    .array(productionRunFeedstockSchema)
    .min(1, "At least one feedstock is required"),

  // Processing Parameters (Isometric Protocol Section 9)
  feedingRateKgHr: z.union([
    z.number().positive("Feeding rate must be positive"),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  residenceTimeMinutes: z.union([
    z.number().int().positive("Residence time must be a positive integer"),
    z.string().transform((val) => (val === "" ? null : parseInt(val, 10))),
    z.null(),
  ]).optional().nullable(),

  // Energy Inputs (Isometric: Energy Use Accounting Module, Eq.6)
  dieselOperationLiters: z.union([
    z.number().min(0, "Diesel operation must be non-negative"),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  dieselGensetLiters: z.union([
    z.number().min(0, "Diesel genset must be non-negative"),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  preprocessingFuelLiters: z.union([
    z.number().min(0, "Preprocessing fuel must be non-negative"),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  electricityKwh: z.union([
    z.number().min(0, "Electricity must be non-negative"),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),

  // Biochar Output
  biocharOutputKg: z.union([
    z.number().positive("Biochar output must be positive"),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  biocharStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstockStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),

  // Metadata
  plcDataFileUrl: z
    .string()
    .max(2000, "URL must be less than 2000 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a production run (server action)
 */
export const createProductionRunSchema = productionRunFormSchema;

/**
 * Schema for updating a production run (server action)
 * All fields optional except productionRunId
 */
export const updateProductionRunSchema = z.object({
  productionRunId: z.string().uuid("Invalid production run ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  facilityId: z.string().uuid().optional(),
  date: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]).optional(),
  reactorId: z.string().uuid().optional(),
  status: z.enum(productionRunStatuses).optional(),
  startTime: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]).optional(),
  endTime: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]).optional(),
  operatorId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstocks: z.array(productionRunFeedstockSchema).min(1).optional(),
  feedingRateKgHr: z.number().positive().optional().nullable(),
  residenceTimeMinutes: z.number().int().positive().optional().nullable(),
  dieselOperationLiters: z.number().min(0).optional().nullable(),
  dieselGensetLiters: z.number().min(0).optional().nullable(),
  preprocessingFuelLiters: z.number().min(0).optional().nullable(),
  electricityKwh: z.number().min(0).optional().nullable(),
  biocharOutputKg: z.number().positive().optional().nullable(),
  biocharStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstockStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  plcDataFileUrl: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for deleting a production run
 */
export const deleteProductionRunSchema = z.object({
  productionRunId: z.string().uuid("Invalid production run ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering production runs in list views
 * Used for search, pagination, and filtering
 */
export const productionRunFilterSchema = z.object({
  // Text search across code
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by reactor
  reactorId: z.string().uuid().optional(),

  // Filter by status
  status: z.enum(productionRunStatuses).optional(),

  // Date range filter
  startDate: z.date().optional(),
  endDate: z.date().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "date", "status", "biocharOutputKg", "createdAt", "updatedAt"])
    .default("date"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Schema for selecting a production run (e.g., in dropdowns)
 */
export const productionRunSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  date: z.date(),
  status: z.enum(productionRunStatuses),
});

// ============================================
// Production Run Reading Schema (Time-series data)
// ============================================

/**
 * Schema for production run readings (monitoring data)
 */
export const productionRunReadingSchema = z.object({
  productionRunId: z.string().uuid("Invalid production run ID"),
  timestamp: z.union([
    z.date(),
    z.string().transform((val) => new Date(val)),
  ]),
  temperatureC: z.union([
    z.number(),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  pressureBar: z.union([
    z.number(),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
  gasFlowRate: z.union([
    z.number(),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ]).optional().nullable(),
});

// ============================================
// Type Inference
// ============================================

export type ProductionRunFormData = z.infer<typeof productionRunFormSchema>;
export type CreateProductionRunData = z.infer<typeof createProductionRunSchema>;
export type UpdateProductionRunData = z.infer<typeof updateProductionRunSchema>;
export type DeleteProductionRunData = z.infer<typeof deleteProductionRunSchema>;
export type ProductionRunFilterData = z.infer<typeof productionRunFilterSchema>;
export type ProductionRunSelectData = z.infer<typeof productionRunSelectSchema>;
export type ProductionRunReadingData = z.infer<typeof productionRunReadingSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Format production run status for display
 */
export function formatProductionRunStatus(status: ProductionRunStatus): string {
  const labels: Record<ProductionRunStatus, string> = {
    draft: "Draft",
    running: "Running",
    complete: "Complete",
    void: "Void",
  };
  return labels[status];
}

/**
 * Get status color class for UI display
 */
export function getStatusColorClass(status: ProductionRunStatus): string {
  const colors: Record<ProductionRunStatus, string> = {
    draft: "text-[var(--color-text-secondary)] bg-[var(--color-surface-light)]",
    running: "text-[var(--color-signal-yellow)] bg-[var(--color-signal-yellow)]/10",
    complete: "text-[var(--color-signal-green)] bg-[var(--color-signal-green)]/10",
    void: "text-[var(--color-signal-red)] bg-[var(--color-signal-red)]/10",
  };
  return colors[status];
}
