/**
 * Production Runs Validation Schemas
 * Zod schemas for production run forms, server actions, and filtering
 * Bin-based feedstock selection with proportional M:M allocation
 */

import { z } from "zod";
import { emptyToNull, toNumberOrNull, toIntOrNull } from "./helpers";

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
// Production Run Form Schema (Client-side validation)
// ============================================

/**
 * Schema for production run form (client-side validation)
 * Used in ProductionRunForm component for creating/editing runs
 */
export const productionRunFormSchema = z.object({
  // Required fields
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
  date: z.union([
    z.date(),
    z.string().min(1, "Please enter a date").transform((val, ctx) => {
      // Accept "YYYY-MM-DD" strings (from form input, converted to Date in submit handler)
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
        return z.NEVER;
      }
      return date;
    }),
  ]),
  reactorId: z.string().min(1, "Please select a reactor").uuid("Please select a valid reactor"),

  // Status
  status: z.enum(productionRunStatuses).default("draft"),

  // Timing — accepts Date objects (from submit handler) or time strings "HH:MM" (from form)
  startTime: z.union([
    z.date(),
    z.string().min(1, "Please enter a start time").transform((val, ctx) => {
      // Accept "HH:MM" time-only strings (passed through as-is for combine in submit handler)
      if (/^\d{2}:\d{2}$/.test(val)) return val;
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start time" });
        return z.NEVER;
      }
      return date;
    }),
  ]),
  endTime: z.union([
    z.date(),
    z.string().min(1, "Please enter an end time").transform((val, ctx) => {
      if (/^\d{2}:\d{2}$/.test(val)) return val;
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid end time" });
        return z.NEVER;
      }
      return date;
    }),
  ]),

  // Operator (optional)
  operatorId: emptyToNull.or(z.string().uuid()).nullable().optional(),

  // Feedstock Input (bin-based: system auto-allocates to M:M from bin contents)
  feedstockMassUsedKg: z.preprocess(toNumberOrNull, z.number().positive("Mass must be a positive number").nullable()).optional(),

  // Processing Parameters (Isometric Protocol Section 9)
  feedingRateKgHr: z.preprocess(toNumberOrNull, z.number().positive("Feeding rate must be positive").nullable()).optional(),
  residenceTimeMinutes: z.preprocess(toIntOrNull, z.number().int().positive("Residence time must be a positive integer").nullable()).optional(),

  // Energy Inputs (Isometric: Energy Use Accounting Module, Eq.6)
  dieselOperationLiters: z.preprocess(toNumberOrNull, z.number().min(0, "Diesel operation must be non-negative").nullable()).optional(),
  dieselGensetLiters: z.preprocess(toNumberOrNull, z.number().min(0, "Diesel genset must be non-negative").nullable()).optional(),
  preprocessingFuelLiters: z.preprocess(toNumberOrNull, z.number().min(0, "Preprocessing fuel must be non-negative").nullable()).optional(),
  electricityKwh: z.preprocess(toNumberOrNull, z.number().min(0, "Electricity must be non-negative").nullable()).optional(),

  // Biochar Output
  biocharOutputKg: z.preprocess(toNumberOrNull, z.number().positive("Biochar output must be positive").nullable()).optional(),
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
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
        return z.NEVER;
      }
      return date;
    }),
  ]).optional(),
  reactorId: z.string().uuid().optional(),
  status: z.enum(productionRunStatuses).optional(),
  startTime: z.union([
    z.date(),
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start time" });
        return z.NEVER;
      }
      return date;
    }),
  ]).optional(),
  endTime: z.union([
    z.date(),
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid end time" });
        return z.NEVER;
      }
      return date;
    }),
  ]).optional(),
  operatorId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstockMassUsedKg: z.number().positive().optional().nullable(),
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
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid timestamp" });
        return z.NEVER;
      }
      return date;
    }),
  ]),
  temperatureC: z.preprocess(toNumberOrNull, z.number().nullable()).optional(),
  pressureBar: z.preprocess(toNumberOrNull, z.number().nullable()).optional(),
  gasFlowRate: z.preprocess(toNumberOrNull, z.number().nullable()).optional(),
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
