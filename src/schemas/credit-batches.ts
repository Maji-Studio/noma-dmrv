import { z } from "zod";
import { emptyToNull } from "./helpers";
import { creditBatchConditionSchema } from "./isometric";

// ============================================
// Constants and Enums
// ============================================

/**
 * Credit batch status options
 */
export const creditBatchStatuses = [
  "draft",
  "pending",
  "verified",
  "issued",
  "rejected",
] as const;
export type CreditBatchStatus = (typeof creditBatchStatuses)[number];

/**
 * Durability options (Isometric Protocol)
 */
export const durabilityOptions = ["200_year", "1000_year"] as const;
export type DurabilityOption = (typeof durabilityOptions)[number];

/**
 * Currency codes (ISO 4217)
 */
export const currencyCodes = ["TZS", "USD", "EUR", "GBP", "KES"] as const;
export type CurrencyCode = (typeof currencyCodes)[number];

// ============================================
// Credit Batch Form Schema (Client-side validation)
// ============================================

/**
 * Schema for credit batch form (client-side validation)
 * Form sections:
 * 1. Overview — code, facilityId, startDate, endDate, certifier, status
 * 2. Applications — applicationIds (M:M via credit_batch_applications)
 * 3. Durability — durabilityOption toggle (200-year vs 1000-year) with conditional fields
 * 4. GHG Accounting — CO2e stored/emissions/counterfactual, buffer pool %
 * 5. Verification — registry, weight, value, currency
 */
export const creditBatchFormSchema = z
  .object({
    // === Section 1: Overview ===
    code: z
      .string()
      .max(50, "Batch code must be less than 50 characters")
      .regex(
        /^[A-Z0-9-]+$/,
        "Batch code must contain only uppercase letters, numbers, and hyphens"
      )
      .optional()
      .or(z.literal("")),
    facilityId: z.string().min(1, "Please select a facility").uuid("Invalid facility"),
    startDate: z.coerce.date({ message: "Start date is required" }),
    endDate: z.coerce.date({ message: "End date is required" }),
    certifier: z
      .string()
      .max(100, "Certifier must be less than 100 characters")
      .optional()
      .or(z.literal("")),
    status: z.enum(creditBatchStatuses).default("draft"),

    // === Section 2: Applications (M:M) ===
    applicationIds: z
      .array(z.string().uuid())
      .min(0, "Select at least one application")
      .default([]),

    // === Section 3: Durability ===
    durabilityOption: z.enum(durabilityOptions).default("200_year"),

    // 200-year durability fields
    hToCorgRatio: z
      .number()
      .min(0, "H:Corg ratio must be positive")
      .max(1, "H:Corg ratio must be at most 1")
      .optional()
      .nullable(),

    // 1000-year durability fields
    meanRandomReflectancePercent: z
      .number()
      .min(0, "Reflectance must be positive")
      .max(100, "Reflectance must be at most 100%")
      .optional()
      .nullable(),
    stdRandomReflectance: z
      .number()
      .min(0, "Standard deviation must be positive")
      .optional()
      .nullable(),
    meanNonReactiveCarbonPercent: z
      .number()
      .min(0, "Non-reactive carbon must be positive")
      .max(100, "Non-reactive carbon must be at most 100%")
      .optional()
      .nullable(),
    stdNonReactiveCarbonPercent: z
      .number()
      .min(0, "Standard deviation must be positive")
      .optional()
      .nullable(),

    // Calculated durability fraction (output)
    fDurableCalculated: z
      .number()
      .min(0)
      .max(0.95)
      .optional()
      .nullable(),

    // === Section 4: GHG Accounting ===
    totalCo2eStoredTons: z
      .number()
      .min(0, "CO2e stored must be positive")
      .optional()
      .nullable(),
    totalCo2eEmissionsTons: z
      .number()
      .min(0, "CO2e emissions must be positive")
      .optional()
      .nullable(),
    totalCo2eCounterfactualTons: z
      .number()
      .min(0, "CO2e counterfactual must be positive")
      .optional()
      .nullable(),
    bufferPoolPercent: z
      .number()
      .min(2, "Buffer pool must be at least 2%")
      .max(20, "Buffer pool must be at most 20%")
      .optional()
      .nullable(),

    // === Section 5: Verification ===
    registry: z
      .string()
      .max(100, "Registry must be less than 100 characters")
      .optional()
      .or(z.literal("")),
    weightTons: z
      .number()
      .min(0, "Weight must be positive")
      .optional()
      .nullable(),
    value: z
      .number()
      .min(0, "Value must be positive")
      .optional()
      .nullable(),
    currency: z.enum(currencyCodes).default("TZS"),

    // === Site Management ===
    siteManagementNotes: z
      .string()
      .max(2000, "Notes must be less than 2000 characters")
      .optional()
      .or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    // Date validation: endDate must be after startDate
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be after start date",
      });
    }

    // Apply conditional validation from isometric schema
    const durabilityResult = creditBatchConditionSchema.safeParse({
      durability_option: data.durabilityOption,
      h_to_c_org_ratio: data.hToCorgRatio,
      mean_random_reflectance_percent: data.meanRandomReflectancePercent,
      mean_non_reactive_carbon_percent: data.meanNonReactiveCarbonPercent,
    });

    if (!durabilityResult.success) {
      for (const issue of durabilityResult.error.issues) {
        // Map isometric schema paths to form field paths
        const pathMap: Record<string, string> = {
          h_to_c_org_ratio: "hToCorgRatio",
          mean_random_reflectance_percent: "meanRandomReflectancePercent",
          mean_non_reactive_carbon_percent: "meanNonReactiveCarbonPercent",
        };
        const formPath = pathMap[issue.path[0] as string] || issue.path[0];
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [formPath as string],
          message: issue.message,
        });
      }
    }
  });

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a credit batch (server action)
 */
export const createCreditBatchSchema = creditBatchFormSchema;

/**
 * Schema for updating a credit batch (server action)
 */
export const updateCreditBatchSchema = z.object({
  creditBatchId: z.string().uuid("Invalid credit batch ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  facilityId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  certifier: z.string().max(100).optional().nullable(),
  status: z.enum(creditBatchStatuses).optional(),
  applicationIds: z.array(z.string().uuid()).optional(),
  durabilityOption: z.enum(durabilityOptions).optional(),
  hToCorgRatio: z.number().min(0).max(1).optional().nullable(),
  meanRandomReflectancePercent: z.number().min(0).max(100).optional().nullable(),
  stdRandomReflectance: z.number().min(0).optional().nullable(),
  meanNonReactiveCarbonPercent: z.number().min(0).max(100).optional().nullable(),
  stdNonReactiveCarbonPercent: z.number().min(0).optional().nullable(),
  fDurableCalculated: z.number().min(0).max(0.95).optional().nullable(),
  totalCo2eStoredTons: z.number().min(0).optional().nullable(),
  totalCo2eEmissionsTons: z.number().min(0).optional().nullable(),
  totalCo2eCounterfactualTons: z.number().min(0).optional().nullable(),
  bufferPoolPercent: z.number().min(2).max(20).optional().nullable(),
  registry: z.string().max(100).optional().nullable(),
  weightTons: z.number().min(0).optional().nullable(),
  value: z.number().min(0).optional().nullable(),
  currency: z.enum(currencyCodes).optional(),
  siteManagementNotes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for deleting a credit batch
 */
export const deleteCreditBatchSchema = z.object({
  creditBatchId: z.string().uuid("Invalid credit batch ID"),
});

// ============================================
// Type Inference
// ============================================

export type CreditBatchFormData = z.infer<typeof creditBatchFormSchema>;
export type CreateCreditBatchData = z.infer<typeof createCreditBatchSchema>;
export type UpdateCreditBatchData = z.infer<typeof updateCreditBatchSchema>;
export type DeleteCreditBatchData = z.infer<typeof deleteCreditBatchSchema>;

// ============================================
// Formatting Helpers
// ============================================

/**
 * Format credit batch status for display
 */
export function formatCreditBatchStatus(status: CreditBatchStatus): string {
  const labels: Record<CreditBatchStatus, string> = {
    draft: "Draft",
    pending: "Pending",
    verified: "Verified",
    issued: "Issued",
    rejected: "Rejected",
  };
  return labels[status];
}

/**
 * Format durability option for display
 */
export function formatDurabilityOption(option: DurabilityOption): string {
  const labels: Record<DurabilityOption, string> = {
    "200_year": "200-Year (H:Corg)",
    "1000_year": "1000-Year (R₀ Reflectance)",
  };
  return labels[option];
}

/**
 * Get status badge color class
 */
export function getStatusColor(status: CreditBatchStatus): {
  bg: string;
  text: string;
} {
  const colors: Record<CreditBatchStatus, { bg: string; text: string }> = {
    draft: {
      bg: "bg-[var(--color-surface-medium)]",
      text: "text-[var(--color-text-secondary)]",
    },
    pending: {
      bg: "bg-[var(--color-warning-light)]",
      text: "text-[var(--color-warning)]",
    },
    verified: {
      bg: "bg-[var(--color-info-light)]",
      text: "text-[var(--color-info)]",
    },
    issued: {
      bg: "bg-[var(--color-success-light)]",
      text: "text-[var(--color-success)]",
    },
    rejected: {
      bg: "bg-[var(--color-error-light)]",
      text: "text-[var(--color-error)]",
    },
  };
  return colors[status];
}
