/**
 * Production-process form/action schemas (ADR 0017 Track 2).
 *
 * The Method-B unlock captures three protocol prerequisites a sample count
 * cannot infer (`G-F74T-0` agreed baseline, `R-S8K1-1` random-sampling plan,
 * `R-ADXG-0` moisture pathway). Non-authoritative summary — the registry remains
 * the authority for the credited compute (ADR 0013 / D1); these are the
 * off-system Isometric-agreement declarations noma records at unlock.
 */

import { z } from "zod";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { toNumberOrUndefined } from "@/schemas/helpers";

/** The three `R-ADXG-0` moisture-determination pathways (DB enum order). */
export const MOISTURE_PATHWAYS = [
  "dry_weight_every_batch",
  "consistent_target_moisture",
  "measured_every_batch",
] as const;

export type MoisturePathway = (typeof MOISTURE_PATHWAYS)[number];

/** noma's default pathway: it already records per-run biochar moisture (D7). */
export const DEFAULT_MOISTURE_PATHWAY: MoisturePathway = "measured_every_batch";

/** Short human labels for the `R-ADXG-0` moisture pathways (unlock dialog). */
export const MOISTURE_PATHWAY_LABELS: Record<MoisturePathway, string> = {
  dry_weight_every_batch: "Dry-weight every batch",
  consistent_target_moisture: "Consistent target moisture (SEM < 5%)",
  measured_every_batch: "Moisture measured every batch",
};

/** One-line descriptions shown beneath each pathway option (kept ≤ 64 chars so
 * they render inline under the select rather than collapsing into a tooltip). */
export const MOISTURE_PATHWAY_DESCRIPTIONS: Record<MoisturePathway, string> = {
  dry_weight_every_batch: "Mass recorded dry-weight every batch (volume-traceable).",
  consistent_target_moisture: "Held at a consistent target moisture (SEM < 5%).",
  measured_every_batch: "Moisture measured every batch — noma's default.",
};

/**
 * Method-B unlock input. Validated client-side (the unlock dialog) and again in
 * the server action. The agreed baseline must clear the protocol hard floor; the
 * data-access guard + DB trigger re-assert the actual sample count at unlock.
 */
export const unlockMethodBSchema = z.object({
  processId: z.uuid(),
  agreedBaselineSize: z.preprocess(
    toNumberOrUndefined,
    z
      .number({
        error: (iss) => (iss.input === undefined ? "Required" : "Invalid number"),
      })
      .int("Must be a whole number of samples")
      .min(
        METHOD_B_MINIMUM_METHOD_A_SAMPLES,
        `Must be at least ${METHOD_B_MINIMUM_METHOD_A_SAMPLES} (protocol minimum)`,
      ),
  ),
  randomSamplingPlanRef: z
    .string()
    .trim()
    .min(1, "A random-sampling-plan reference is required"),
  moisturePathway: z.enum(MOISTURE_PATHWAYS),
});

export type UnlockMethodBInput = z.infer<typeof unlockMethodBSchema>;

/**
 * Start-a-new-production-process input (ADR 0017 item 7 / D6). The deliberate,
 * human-confirmed baseline reset. Facility + feedstock come from context; an
 * optional note records the reason (feedstock change, condition change, drift).
 */
export const startNewProcessSchema = z.object({
  facilityId: z.uuid(),
  feedstockTypeId: z.uuid(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type StartNewProcessInput = z.infer<typeof startNewProcessSchema>;
