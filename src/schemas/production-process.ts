import { z } from "zod";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { toNumberOrUndefined } from "@/schemas/helpers";

export const MOISTURE_PATHWAYS = [
  "dry_weight_every_batch",
  "consistent_target_moisture",
  "measured_every_batch",
] as const;

export type MoisturePathway = (typeof MOISTURE_PATHWAYS)[number];

export const DEFAULT_MOISTURE_PATHWAY: MoisturePathway = "measured_every_batch";

export const recordMethodBPrerequisitesSchema = z.object({
  processId: z.uuid(),
  agreedBaselineSize: z.preprocess(
    toNumberOrUndefined,
    z
      .number({
        error: (issue) =>
          issue.input === undefined ? "Required" : "Enter a valid number.",
      })
      .int("Enter a whole number of Samples.")
      .min(
        METHOD_B_MINIMUM_METHOD_A_SAMPLES,
        `Enter at least ${METHOD_B_MINIMUM_METHOD_A_SAMPLES} Samples.`,
      ),
  ),
  randomSamplingPlanRef: z
    .string()
    .trim()
    .min(1, "A random-sampling-plan reference is required"),
  moisturePathway: z.enum(MOISTURE_PATHWAYS),
});

export type RecordMethodBPrerequisitesInput = z.infer<
  typeof recordMethodBPrerequisitesSchema
>;

export const startNewProcessSchema = z.object({
  facilityId: z.uuid(),
  feedstockTypeId: z.uuid(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type StartNewProcessInput = z.infer<typeof startNewProcessSchema>;
