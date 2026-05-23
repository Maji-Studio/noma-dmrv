import { z } from "zod";
import { emptyToNull, toNumberOrUndefined } from "@/schemas/helpers";

const httpsUrlSchema = z
  .string()
  .url({ error: "Enter a valid report URL" })
  .refine((value) => value.startsWith("https://"), {
    error: "Report URL must use HTTPS",
  });

export const saveMappingSchema = z.object({
  facilityId: z.string().uuid(),
  externalProjectId: z.string().min(1, "Pick an Isometric project"),
  protocolSlug: z.string().min(1),
  protocolVersion: emptyToNull.or(z.string().min(1)).nullable().optional(),
  defaultRemovalTemplateId: emptyToNull
    .or(z.string().min(1))
    .nullable()
    .optional(),
  confirmProduction: z.boolean().optional(),
});

export type SaveMappingInput = z.infer<typeof saveMappingSchema>;

// --- Phase 3.7 per-facility emission-estimate config ---

// The three process-stage energy percentages must total this, within a
// small tolerance for floating-point drift / UI rounding (the columns
// are `real`/float4).
export const STAGE_SPLIT_TOTAL_PCT = 100;
export const STAGE_SPLIT_SUM_TOLERANCE = 0.1;

function requiredNumber(label: string) {
  return z.preprocess(
    toNumberOrUndefined,
    z.number({
      error: (iss) =>
        iss.input === undefined ? `${label} is required` : "Invalid number",
    }),
  );
}

export const facilityEmissionConfigSchema = z
  .object({
    facilityId: z.string().uuid("Select a facility"),
    gensetEnergyYieldKwhPerLitre: requiredNumber("Genset energy yield").pipe(
      z.number().positive("Genset energy yield must be greater than 0"),
    ),
    stageSplitBiomassPct: requiredNumber("Biomass processing split").pipe(
      z.number().min(0).max(100, "Split must be between 0 and 100"),
    ),
    stageSplitPyrolysisPct: requiredNumber("Pyrolysis split").pipe(
      z.number().min(0).max(100, "Split must be between 0 and 100"),
    ),
    stageSplitBiocharPct: requiredNumber("Biochar processing split").pipe(
      z.number().min(0).max(100, "Split must be between 0 and 100"),
    ),
  })
  .superRefine((value, ctx) => {
    const sum =
      value.stageSplitBiomassPct +
      value.stageSplitPyrolysisPct +
      value.stageSplitBiocharPct;
    if (Math.abs(sum - STAGE_SPLIT_TOTAL_PCT) > STAGE_SPLIT_SUM_TOLERANCE) {
      for (const path of [
        "stageSplitBiomassPct",
        "stageSplitPyrolysisPct",
        "stageSplitBiocharPct",
      ] as const) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: `Stage splits must sum to ${STAGE_SPLIT_TOTAL_PCT}% (currently ${sum.toFixed(1)}%)`,
        });
      }
    }
  });

export type FacilityEmissionConfigFormData = z.infer<
  typeof facilityEmissionConfigSchema
>;

// Panel-facing submit: the Certify panel lives in the credit-batch side
// sheet. Resolves (lazily creates) the batch's removal, then submits it.
export const submitCreditBatchSchema = z.object({
  creditBatchId: z.string().uuid(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitCreditBatchInput = z.infer<typeof submitCreditBatchSchema>;

// Hub-facing submit: submit an existing removal directly by id.
export const submitRemovalSchema = z.object({
  removalId: z.string().uuid(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitRemovalInput = z.infer<typeof submitRemovalSchema>;

// N:1 grouping — move a credit batch onto a removal, or detach with null.
export const assignCreditBatchToRemovalSchema = z.object({
  creditBatchId: z.string().uuid(),
  removalId: z.string().uuid().nullable(),
});

export type AssignCreditBatchToRemovalInput = z.infer<
  typeof assignCreditBatchToRemovalSchema
>;

export const submitGhgStatementDialogSchema = z.object({
  reportUrl: httpsUrlSchema,
  summaryOfChanges: z.string().optional(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitGhgStatementDialogInput = z.infer<
  typeof submitGhgStatementDialogSchema
>;

export function buildSubmitGhgStatementDialogSchema(args: {
  isResubmit: boolean;
  isProduction: boolean;
}) {
  return submitGhgStatementDialogSchema.check((ctx) => {
    const value = ctx.value;
    if (args.isResubmit && !value.summaryOfChanges?.trim()) {
      ctx.issues.push({
        code: "custom",
        input: value,
        path: ["summaryOfChanges"],
        message: "Summary of changes is required",
      });
    }
    if (args.isProduction && value.confirmProduction !== true) {
      ctx.issues.push({
        code: "custom",
        input: value,
        path: ["confirmProduction"],
        message: "Confirm production submission to continue",
      });
    }
  });
}

export const submitGhgStatementSchema = z.object({
  submissionId: z.string().uuid(),
  reportUrl: httpsUrlSchema,
  summaryOfChanges: emptyToNull.or(z.string().min(1)).nullable().optional(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitGhgStatementInput = z.infer<
  typeof submitGhgStatementSchema
>;

