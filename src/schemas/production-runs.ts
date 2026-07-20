/**
 * Production Runs Validation Schemas
 * Zod schemas for production run forms, server actions, and filtering
 * Bin-based feedstock selection with proportional M:M allocation
 */

import { z } from "zod";
import {
  emptyToNull,
  MASS_INPUT_MAX_KG,
  MASS_MAX_KG_MESSAGE,
  optionalDateOnly,
  optionalPercent,
  PG_INTEGER_MAX,
  requiredDateOnly,
  toIntOrNull,
  toNumberOrNull,
} from "./helpers";
import {
  allowedProductionRunStatusesFrom,
  PRODUCTION_RUN_STATUSES,
  type ProductionRunStatus,
} from "@/lib/production-runs/lifecycle";
import { dryOutputExceedsDryInput } from "@/lib/calculations/mass-dry";

// ============================================
// Time-window helpers (start/end date + time pairs)
// ============================================

const TIME_ONLY_RE = /^\d{2}:\d{2}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CANCELLATION_REASON_MAX_LENGTH = 2000;
const DRY_MASS_BALANCE_MESSAGE =
  "Dry biochar output cannot exceed dry feedstock input";

/**
 * Resolve a calendar-date value + a time value into a single instant, robust to
 * either shape the schema produces: on the client the date field has been
 * transformed to a `Date` (local midnight) and the time is an "HH:MM" string;
 * on server re-validation the time is already a combined `Date`. Returns null
 * when either part is missing/malformed (the field-level validators surface the
 * specific error).
 */
function resolveInstant(dateVal: unknown, timeVal: unknown): Date | null {
  if (timeVal instanceof Date) return timeVal;
  if (typeof timeVal !== "string" || !TIME_ONLY_RE.test(timeVal)) return null;

  let base: Date | null = null;
  if (dateVal instanceof Date) {
    base = dateVal;
  } else if (typeof dateVal === "string" && DATE_ONLY_RE.test(dateVal)) {
    const [y, m, d] = dateVal.split("-").map(Number);
    base = new Date(y, m - 1, d);
  }
  if (!base) return null;

  const [hh, mm] = timeVal.split(":").map(Number);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm);
}

/** Whether an end-time value is actually present (Date or non-empty "HH:MM"). */
function hasEndTime(value: unknown): boolean {
  return value instanceof Date || (typeof value === "string" && value !== "");
}

// ============================================
// Constants and Enums
// ============================================

/**
 * Valid production run statuses
 */
export const productionRunStatuses = PRODUCTION_RUN_STATUSES;
export type { ProductionRunStatus };

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
  reactorId: z.string().min(1, "Please select a reactor").uuid("Please select a valid reactor"),

  // Status
  status: z.enum(productionRunStatuses).default("draft"),
  cancellationReason: z.string().max(CANCELLATION_REASON_MAX_LENGTH).optional().or(z.literal("")),

  // Timing — explicit date + time pairs. The run's start (date + time) is
  // required; the end pair is optional (a blank end = the run has not finished
  // yet). `endDate` defaults to `startDate` when only an end time is entered;
  // an overnight run sets `endDate` to the next day (no implicit day rollover).
  startDate: requiredDateOnly,
  endDate: optionalDateOnly,
  // Time values accept "HH:MM" strings (from the form) or Date objects (server
  // re-validation of an already-combined instant).
  startTime: z.union([
    z.date(),
    z.string().min(1, "Please enter a start time").transform((val, ctx) => {
      if (TIME_ONLY_RE.test(val)) return val;
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
    z.string(),
  ])
    .optional()
    .transform((val, ctx) => {
      if (val === undefined || val === null || val === "") return undefined;
      if (typeof val === "string" && TIME_ONLY_RE.test(val)) return val;
      if (typeof val === "string") {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid end time" });
          return z.NEVER;
        }
        return date;
      }
      return val;
    }),

  // Operator (optional)
  operatorId: emptyToNull.or(z.string().uuid()).nullable().optional(),

  // Feedstock Input (bin-based: system auto-allocates to M:M from bin contents)
  feedstockWetMassKg: z.preprocess(toNumberOrNull, z.number().positive("Wet mass must be a positive number").max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE).nullable()).optional(),
  feedstockMoisturePercent: optionalPercent,

  // Processing Parameters (Isometric Protocol Section 9)
  feedingRateKgHr: z.preprocess(toNumberOrNull, z.number().positive("Feeding rate must be positive").nullable()).optional(),
  residenceTimeMinutes: z.preprocess(toIntOrNull, z.number().int().positive("Residence time must be a positive integer").max(PG_INTEGER_MAX, "Residence time is too large").nullable()).optional(),

  // Energy Inputs (Isometric: Energy Use Accounting Module, Eq.6)
  dieselOperationLiters: z.preprocess(toNumberOrNull, z.number().min(0, "Diesel operation must be non-negative").nullable()).optional(),
  dieselGensetLiters: z.preprocess(toNumberOrNull, z.number().min(0, "Diesel genset must be non-negative").nullable()).optional(),
  preprocessingFuelLiters: z.preprocess(toNumberOrNull, z.number().min(0, "Preprocessing fuel must be non-negative").nullable()).optional(),
  electricityKwh: z.preprocess(toNumberOrNull, z.number().min(0, "Electricity must be non-negative").nullable()).optional(),

  // Biochar Output
  biocharOutputKg: z.preprocess(toNumberOrNull, z.number().nonnegative("Biochar output must be non-negative").max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE).nullable()).optional(),
  biocharMoisturePercent: optionalPercent,
  biocharStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstockStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
})
  .superRefine((data, ctx) => {
    const start = resolveInstant(data.startDate, data.startTime);
    const endPresent = hasEndTime(data.endTime);

    if (endPresent) {
      const endDateVal = data.endDate ?? data.startDate;
      const end = resolveInstant(endDateVal, data.endTime);
      if (start && end && end.getTime() <= start.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endTime"],
          message: "End must be after start — check the end date for overnight runs.",
        });
      }
    }

    // A run cannot be marked Complete without an end time (a complete run has
    // finished). Mirrors the server-side data-access guard.
    if ((data.status === "complete" || data.status === "failed") && !endPresent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: `A ${data.status} run needs an end date and time.`,
      });
    }
    if (data.status === "complete" && !(data.biocharOutputKg && data.biocharOutputKg > 0)) {
      ctx.addIssue({ code: "custom", path: ["biocharOutputKg"], message: "A complete run needs positive biochar output." });
    }
    if (
      (data.status === "complete" || data.status === "failed") &&
      !(
        data.feedstockWetMassKg &&
        data.feedstockWetMassKg > 0 &&
        data.feedstockStorageLocationId &&
        data.feedstockMoisturePercent != null
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["feedstockWetMassKg"],
        message: `A ${data.status} run needs a source bin, moisture %, and wet mass to compute consumed feedstock.`,
      });
    }
    if (data.status === "cancelled" && !data.cancellationReason?.trim()) {
      ctx.addIssue({ code: "custom", path: ["cancellationReason"], message: "Enter a cancellation reason." });
    }
    if (dryOutputExceedsDryInput(data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["biocharOutputKg"],
        message: DRY_MASS_BALANCE_MESSAGE,
      });
    }
  });

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a production run (server action)
 */
export const createProductionRunSchema = productionRunFormSchema.refine(
  (data) => allowedProductionRunStatusesFrom("draft").includes(data.status),
  {
    path: ["status"],
    message: "A new production run can only start as Draft, Running, or Cancelled.",
  },
);

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
  reactorId: z.string().uuid().optional(),
  status: z.enum(productionRunStatuses).optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
  cancellationReason: z.string().max(CANCELLATION_REASON_MAX_LENGTH).nullable().optional(),
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
  // Nullable: an explicit null clears the end time (reopens the run). Undefined
  // leaves it unchanged.
  endTime: z.union([
    z.date(),
    z.null(),
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
  feedstockWetMassKg: z.number().positive().max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE).optional().nullable(),
  feedstockMoisturePercent: z.number().min(0).max(100).optional().nullable(),
  feedingRateKgHr: z.number().positive().optional().nullable(),
  residenceTimeMinutes: z.number().int().positive().max(PG_INTEGER_MAX, "Residence time is too large").optional().nullable(),
  dieselOperationLiters: z.number().min(0).optional().nullable(),
  dieselGensetLiters: z.number().min(0).optional().nullable(),
  preprocessingFuelLiters: z.number().min(0).optional().nullable(),
  electricityKwh: z.number().min(0).optional().nullable(),
  biocharOutputKg: z.number().nonnegative().max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE).optional().nullable(),
  biocharMoisturePercent: z.number().min(0).max(100).optional().nullable(),
  biocharStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstockStorageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
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
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status];
}
