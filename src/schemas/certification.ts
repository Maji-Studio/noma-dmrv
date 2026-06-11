import { z } from "zod";
import { emptyToNull, requiredNumber } from "@/schemas/helpers";

// Hard cap on the free-text "summary of changes" the operator writes when
// resubmitting a GHG statement. 2 kB is enough for the audit-trail context
// we ask for (what changed and why) without letting an oversized blob hit
// the registry; keep this in sync with any column length on the persisted
// side if/when one is added.
const SUMMARY_OF_CHANGES_MAX_LENGTH = 2000;

// Rejects shapes that pass the YYYY-MM-DD regex but aren't real calendar
// dates (e.g. 2026-02-31, 2023-02-29). Same Date.UTC round-trip used in
// `src/schemas/project-emissions.ts` so the two surfaces validate dates
// identically — diverging would surprise an operator who hits one of them.
function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

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
  defaultRemovalTemplateId: emptyToNull
    .or(z.string().min(1))
    .nullable()
    .optional(),
  // Phase 5 Slice A — Isometric facility id (fcl_…). Optional because
  // it's only required for the telemetry pipeline; mapping was usable
  // without it before Slice A and remains so for Removal/GHG flows.
  // Enforced shape on the truthy path so an operator can't paste a
  // project or sensor id by mistake.
  externalFacilityId: emptyToNull
    .or(
      z
        .string()
        .startsWith("fcl_", {
          error:
            "Isometric facility ID must start with 'fcl_' — copy it from the Certify UI.",
        })
        .min(5),
    )
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

export const facilityEmissionConfigSchema = z
  .object({
    facilityId: z.string().uuid("Select a facility"),
    gensetEnergyYieldKwhPerLitre: requiredNumber("Genset energy yield is required").pipe(
      z.number().positive("Genset energy yield must be greater than 0"),
    ),
    stageSplitBiomassPct: requiredNumber("Biomass processing split is required").pipe(
      z.number().min(0).max(100, "Split must be between 0 and 100"),
    ),
    stageSplitPyrolysisPct: requiredNumber("Pyrolysis split is required").pipe(
      z.number().min(0).max(100, "Split must be between 0 and 100"),
    ),
    stageSplitBiocharPct: requiredNumber("Biochar processing split is required").pipe(
      z.number().min(0).max(100, "Split must be between 0 and 100"),
    ),
    defaultSoilTemperatureC: emptyToNull
      .or(
        z.coerce
          .number()
          .min(-50, "Soil temperature must be between -50 and 60 °C")
          .max(60, "Soil temperature must be between -50 and 60 °C"),
      )
      .nullable()
      .optional(),
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

// Hub-facing submit: submit an existing removal directly by id.
export const submitRemovalSchema = z.object({
  removalId: z.string().uuid(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitRemovalInput = z.infer<typeof submitRemovalSchema>;

// Deferred-create: spin up a new removal in a facility from a confirmed set of
// healthy credit batches (the New-Removal wizard's "Confirm" step). The server
// re-derives each batch's health before writing — this is the input contract,
// not the authorization.
export const createRemovalWithBatchesSchema = z.object({
  facilityId: z.string().uuid(),
  creditBatchIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one credit batch."),
});

export type CreateRemovalWithBatchesInput = z.infer<
  typeof createRemovalWithBatchesSchema
>;

export const submitGhgStatementDialogSchema = z.object({
  reportUrl: httpsUrlSchema,
  summaryOfChanges: z
    .string()
    .max(
      SUMMARY_OF_CHANGES_MAX_LENGTH,
      `Keep the summary under ${SUMMARY_OF_CHANGES_MAX_LENGTH} characters`,
    )
    .optional(),
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

// Period-first GHG-statement creation. Isometric creates a statement from
// only { project_id, end_on }; the user picks the period end and the server
// reconciles the linked removals afterward.
export const createGhgStatementSchema = z.object({
  facilityId: z.string().uuid(),
  reportingPeriodEndOn: z
    .string()
    .refine(isValidCalendarDate, "Pick a valid period end date"),
  confirmProduction: z.boolean().optional(),
});

export type CreateGhgStatementInput = z.infer<typeof createGhgStatementSchema>;
