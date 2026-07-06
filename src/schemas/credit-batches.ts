import { z } from "zod";
import { getCreditBatchProductionWindowIssue } from "@/lib/credit-batch-production-window";

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
 * Certifier provider options
 */
export const certifierProviders = ["isometric"] as const;
export type CertifierProvider = (typeof certifierProviders)[number];

/**
 * Durability options (Isometric Protocol)
 */
export const durabilityOptions = ["200_year", "1000_year"] as const;
export type DurabilityOption = (typeof durabilityOptions)[number];

/**
 * Tier used when a facility LEFT JOIN yields null while deriving a batch's
 * durability tier (ADR 0021). Every credit batch has a NOT NULL `facility_id`
 * FK, so this branch is unreachable in practice — it only satisfies the join's
 * nullable column type. Kept as one shared constant (matching the facility
 * column default) so the read-path fallbacks don't diverge.
 */
export const DURABILITY_TIER_FALLBACK: DurabilityOption = "1000_year";

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
 * 1. Overview — code, facilityId, startDate, endDate, status
 * 2. Production cohort — productionRunIds (membership via credit_batch_production_runs)
 * 3. Durability — durabilityOption toggle (200-year vs 1000-year) with conditional fields
 * 4. GHG Accounting — buffer pool % (CO2e figures are derived/registry-owned)
 * 5. Verification — registry, value, currency (applied weight is derived)
 */
export const creditBatchFormSchema = z
  .object({
    // === Section 1: Overview ===
    facilityId: z.string().min(1, "Please select a facility").uuid("Invalid facility"),
    // Declared up front (ADR 0016 amendment): resolves the production process +
    // Method A/B and scopes the run cohort to a single feedstock.
    feedstockTypeId: z
      .string()
      .min(1, "Please select a feedstock type")
      .uuid("Invalid feedstock type"),
    startDate: z.coerce.date({ message: "Start date is required" }),
    endDate: z.coerce.date({ message: "End date is required" }),

    // === Section 2: Production cohort (membership) ===
    productionRunIds: z
      .array(z.string().uuid())
      .min(1, "Select at least one production run")
      .default([]),

    // === Section 3: Durability ===
    // The tier is NOT a batch input — it is inherited from the facility
    // (ADR 0021) and shown read-only on the form. The tier-specific evidence
    // fields below gate on the facility tier.

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
    // CO2e stored/emissions/counterfactual are derived or registry-owned
    // (issue #285, ADR 0018) — no longer form inputs.
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
    const windowIssue = getCreditBatchProductionWindowIssue(
      data.startDate,
      data.endDate,
    );
    if (windowIssue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: windowIssue,
      });
    }
    // Durability inputs come from sample aggregation at preview/submission time.
    // Missing lab data is represented in the CO2e preview instead of blocking
    // credit-batch creation.
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
  feedstockTypeId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  productionRunIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one production run")
    .optional(),
  // durabilityOption is inherited from the facility (ADR 0021), not a batch field.
  hToCorgRatio: z.number().min(0).max(1).optional().nullable(),
  meanRandomReflectancePercent: z.number().min(0).max(100).optional().nullable(),
  stdRandomReflectance: z.number().min(0).optional().nullable(),
  meanNonReactiveCarbonPercent: z.number().min(0).max(100).optional().nullable(),
  stdNonReactiveCarbonPercent: z.number().min(0).optional().nullable(),
  fDurableCalculated: z.number().min(0).max(0.95).optional().nullable(),
  bufferPoolPercent: z.number().min(2).max(20).optional().nullable(),
  registry: z.string().max(100).optional().nullable(),
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
 * Format certifier provider for display
 */
export function formatCertifierProvider(
  provider: string | null | undefined
): string {
  if (provider === "isometric" || !provider) {
    return "Isometric";
  }

  if (provider === "puro_earth") {
    return "Puro.earth";
  }

  if (provider === "verra") {
    return "Verra";
  }

  return provider;
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
