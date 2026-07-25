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
  getProductionRunOutcomeViolations,
  PRODUCTION_RUN_STATUSES,
  type ProductionRunStatus,
} from "@/lib/production-runs/lifecycle";
import {
  combineDateAndTime,
  DEFAULT_FACILITY_TIMEZONE,
  formatLocalDate,
  NonexistentLocalTimeError,
} from "@/lib/date-utils";

// ============================================
// Time-window helpers (start/end date + time pairs)
// ============================================

const TIME_ONLY_RE = /^\d{2}:\d{2}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CANCELLATION_REASON_MAX_LENGTH = 2000;
const DRY_MASS_BALANCE_MESSAGE =
  "Dry biochar output cannot exceed dry feedstock input";

/**
 * Outcome of {@link resolveInstant}. `instant` is null both when the pair is
 * incomplete/malformed and when the wall clock does not exist; only the latter
 * sets `nonexistentMessage`, so the caller can tell "nothing to check yet" from
 * "the operator entered a time that never happens".
 */
type ResolvedInstant = {
  instant: Date | null;
  nonexistentMessage: string | null;
};

const UNRESOLVED_INSTANT: ResolvedInstant = { instant: null, nonexistentMessage: null };

/**
 * Resolve a calendar-date value + a time value into a single instant, robust to
 * either shape the schema produces: on the client the date field has been
 * transformed to a `Date` (local midnight) and the time is an "HH:MM" string;
 * on server re-validation the time is already a combined `Date`. Returns a null
 * instant when either part is missing/malformed (the field-level validators
 * surface the specific error).
 *
 * `timeZone` must be the facility's IANA zone, matching what the form submits
 * via `combineDateAndTime`. Resolving here in the browser's zone while the
 * submitted instant is built in the facility's zone lets the two disagree
 * across a DST boundary that only one of the zones observes (a run that is
 * valid when saved can be rejected by the client, or vice versa). Sharing the
 * combiner also means the two share its DST gap/fold policy, so validation
 * rejects exactly the wall clocks the submit path would refuse to build.
 */
function resolveInstant(
  dateVal: unknown,
  timeVal: unknown,
  timeZone: string
): ResolvedInstant {
  if (timeVal instanceof Date) {
    return { instant: timeVal, nonexistentMessage: null };
  }
  if (typeof timeVal !== "string" || !TIME_ONLY_RE.test(timeVal)) {
    return UNRESOLVED_INSTANT;
  }

  // `requiredDateOnly`/`optionalDateOnly` parse "YYYY-MM-DD" at local midnight,
  // so reading the calendar day back off the Date is the exact inverse.
  let dateStr: string | null = null;
  if (dateVal instanceof Date) {
    dateStr = formatLocalDate(dateVal);
  } else if (typeof dateVal === "string" && DATE_ONLY_RE.test(dateVal)) {
    dateStr = dateVal;
  }
  if (!dateStr) return UNRESOLVED_INSTANT;

  try {
    return {
      instant: combineDateAndTime(dateStr, timeVal, timeZone),
      nonexistentMessage: null,
    };
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError) {
      return { instant: null, nonexistentMessage: error.message };
    }
    throw error;
  }
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
 * Field shape for the production run form. Timing cross-field checks live in
 * {@link makeProductionRunFormSchema}, which binds them to a facility timezone.
 */
const productionRunFormObject = z.object({
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
});

/**
 * Schema for the production run form (client-side validation), bound to the
 * IANA timezone of the run's facility.
 *
 * The zone is a parameter rather than a schema field because it is not user
 * input — it is a property of the facility, and putting it on the wire would
 * let a client override how its own times are interpreted. Callers that hold a
 * facility (the form) pass its zone; the exported {@link productionRunFormSchema}
 * binds {@link DEFAULT_FACILITY_TIMEZONE} for the server-action path, where the
 * start/end values have already been combined into `Date` instants by the
 * client and the zone is therefore never consulted.
 */
export function makeProductionRunFormSchema(timeZone: string) {
  return productionRunFormObject.superRefine((data, ctx) => {
    const start = resolveInstant(data.startDate, data.startTime, timeZone);
    const endPresent = hasEndTime(data.endTime);
    const endDateVal = data.endDate ?? data.startDate;
    const end = endPresent
      ? resolveInstant(endDateVal, data.endTime, timeZone)
      : UNRESOLVED_INSTANT;

    // A wall clock inside the facility's spring-forward gap never happened, so
    // it is reported on its own field and then treated as unresolved. The
    // downstream window checks all guard on a non-null instant, so they stay
    // silent rather than piling a second, misleading message onto the same
    // field ("End must be after start" for a time that has no instant at all).
    if (start.nonexistentMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: start.nonexistentMessage,
      });
    }
    if (end.nonexistentMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: end.nonexistentMessage,
      });
    }

    const violations = getProductionRunOutcomeViolations({
      status: data.status,
      startTime: start.instant,
      endTime: end.instant,
      endTimePresent: endPresent,
      cancellationReason: data.cancellationReason,
      biocharOutputKg: data.biocharOutputKg,
      biocharMoisturePercent: data.biocharMoisturePercent,
      feedstockWetMassKg: data.feedstockWetMassKg,
      feedstockMoisturePercent: data.feedstockMoisturePercent,
      feedstock: {
        basis: "form-inputs",
        storageLocationId: data.feedstockStorageLocationId,
      },
    });

    for (const violation of violations) {
      switch (violation.code) {
        case "end-not-after-start":
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endTime"],
            message: "End must be after start — check the end date for overnight runs.",
          });
          break;
        case "terminal-end-required":
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endTime"],
            message: `A ${violation.status} run needs an end date and time.`,
          });
          break;
        case "complete-output-required":
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["biocharOutputKg"],
            message: "A complete run needs positive biochar output.",
          });
          break;
        case "feedstock-required":
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["feedstockWetMassKg"],
            message: `A ${violation.status} run needs a source bin, moisture %, and wet mass to compute consumed feedstock.`,
          });
          break;
        case "cancellation-reason-required":
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cancellationReason"],
            message: "Enter a cancellation reason.",
          });
          break;
        case "dry-mass-balance-exceeded":
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["biocharOutputKg"],
            message: DRY_MASS_BALANCE_MESSAGE,
          });
          break;
        case "running-end-forbidden":
          // Pre-existing adapter divergence: the mutation rejects this state,
          // while the form schema has historically allowed it.
          break;
      }
    }
  });
}

/**
 * Server-action / default-bound instance of the form schema. See
 * {@link makeProductionRunFormSchema} for why the zone defaults here.
 */
export const productionRunFormSchema = makeProductionRunFormSchema(
  DEFAULT_FACILITY_TIMEZONE,
);

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
    message:
      "A new production run can only start as Draft, Running, Complete, or Cancelled.",
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
  // Exact-record deep link from certification readiness.
  ids: z.array(z.uuid()).max(100).optional(),

  // Text search across code
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by credit-batch membership
  creditBatchId: z.string().uuid().optional(),

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
// Type Inference
// ============================================

export type ProductionRunFormData = z.infer<typeof productionRunFormSchema>;
export type CreateProductionRunData = z.infer<typeof createProductionRunSchema>;
export type UpdateProductionRunData = z.infer<typeof updateProductionRunSchema>;
export type DeleteProductionRunData = z.infer<typeof deleteProductionRunSchema>;
export type ProductionRunFilterData = z.infer<typeof productionRunFilterSchema>;
export type ProductionRunSelectData = z.infer<typeof productionRunSelectSchema>;

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
