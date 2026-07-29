/**
 * Durability submission gates — the protocol's hard, fail-closed sampling and
 * eligibility blocks evaluated at removal-submission time (decision D3),
 * evaluated at the CREDIT-BATCH grain (ADR 0016: the credit batch IS the
 * protocol production batch; the sampling unit is the batch, never the run):
 *
 *   (a) Eligibility — the batch's POOLED replicate MEAN must satisfy
 *       H/C_org < 0.5 AND O/C_org < 0.2 (module §3 Table 2, judged per D8).
 *       Indeterminate chemistry (a missing ratio) fails closed.
 *   (b) Sampling presence — every batch created as sampled must carry ≥ 1
 *       sample (§8.3). A batch created as unsampled submits through the
 *       unsampled blueprint and is not judged on chemistry here.
 *   (c) Replicate sufficiency — any SAMPLED batch must pool ≥ 3 replicates
 *       (§8.3.1) across its member runs/days.
 *
 * §8.3.1 requires the 3 replicates to be "representative of the full range of
 * physical characteristics (eg. particle size, color) available in the batch" —
 * it does NOT require them to be drawn from distinct production runs or distinct
 * calendar days. (The distinct-days language in §8.3.1 governs Method B's
 * random-sampling cadence ACROSS production batches, a separate requirement.)
 * We therefore do not judge within-batch run/day distribution at all.
 *
 * Post-production sampling from stored material is permitted by §8.3.1 provided
 * the samples cover different parts of the stored batch; operators receive a
 * warning to confirm that with the registry. A sample before the production
 * window is physically impossible and blocks submission.
 *
 * Pure and client-safe — the submission orchestrator (`submit-removal.ts`)
 * assembles the per-batch facts and throws a single SafeError on the blockers.
 * The COA / lab-report Source requirement (D4) lives with the measurement-sample
 * chemistry datapoints (Phase E), not here.
 */
import { pluralize } from "@/lib/copy-utils";

import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  MINIMUM_REPLICATES_PER_BATCH,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  evaluateReplicateCount,
  evaluateRunEligibility,
  type ReplicateRatios,
} from "@/lib/calculations/biochar-eligibility";
import type { CreditBatchSampling } from "@/schemas/credit-batches";

/**
 * Provenance of one pooled replicate, for the production-window checks. The
 * originating production run is deliberately absent: §8.3.1 imposes no
 * within-batch run/day distribution, so no gate reads it.
 */
export interface ReplicateProvenance {
  /** Human-facing sample identifier used in window diagnostics. */
  sampleCode: string;
  /** ISO calendar day (YYYY-MM-DD) the sample was taken; null when unknown. */
  samplingDay: string | null;
}

export interface BatchGateFacts {
  creditBatchId: string;
  creditBatchCode: string;
  /** ISO date-only production window; null skips window checks fail-softly. */
  startDate?: string | null;
  endDate?: string | null;
  /** Immutable sampled/unsampled choice stored at batch creation. */
  sampling: CreditBatchSampling;
  /** Per-replicate stability ratios, pooled across the batch's member runs/days. */
  replicates: ReplicateRatios[];
  /** Parallel to `replicates` — each replicate's run/day, for window diagnostics. */
  replicateProvenance: ReplicateProvenance[];
}

export interface DurabilitySubmissionGateResult {
  ok: boolean;
  /** One human-readable blocker line per failed gate, ready to join into a SafeError. */
  blockers: string[];
  /** Non-blocking advisories — currently the stored-material sampling warning. */
  warnings: string[];
}

/**
 * Evaluate the D3 gates over a removal's credit batches. Returns every blocker
 * (so the operator sees all sampling/eligibility problems at once) plus any
 * non-blocking advisories.
 */
export function evaluateDurabilitySubmissionGates(
  batches: BatchGateFacts[],
): DurabilitySubmissionGateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const batch of batches) {
    const sampleRowCount = batch.replicates.length;

    if (batch.startDate != null && batch.endDate != null) {
      for (const sample of batch.replicateProvenance) {
        if (sample.samplingDay == null) continue;
        if (sample.samplingDay < batch.startDate) {
          blockers.push(
            `Sample ${sample.sampleCode} was taken on ${sample.samplingDay}, before credit batch ${batch.creditBatchCode}'s production window, ${batch.startDate} to ${batch.endDate}. Correct the Sample date before submitting (§8.3.1).`,
          );
        } else if (sample.samplingDay > batch.endDate) {
          warnings.push(
            `Sample ${sample.sampleCode} was taken on ${sample.samplingDay}, after credit batch ${batch.creditBatchCode}'s production window, ${batch.startDate} to ${batch.endDate}. §8.3.1 permits sampling from stored material only when Samples are spatially distributed across the stored batch. Confirm this with the registry.`,
          );
        }
      }
    }

    // An unsampled choice is the regime boundary: incidental sample rows do not
    // reclassify the batch or route it through sampled chemistry gates.
    if (batch.sampling === "unsampled") continue;

    // (b) A batch explicitly created as sampled must carry sample evidence.
    if (sampleRowCount === 0) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} is marked as sampled but has no Samples. Add at least ${MINIMUM_REPLICATES_PER_BATCH} Samples before submitting.`,
      );
      continue;
    }

    const eligibility = evaluateRunEligibility(batch.replicates);

    // (c) Replicate sufficiency — a sampled batch needs ≥ 3 COMPLETE-chemistry
    // replicates pooled across its member runs/days. A row without a usable
    // H/C_org + O/C_org pair doesn't characterise the batch, so count usable
    // replicates, not raw rows (§8.3.1).
    const replicateCheck = evaluateReplicateCount(
      eligibility.usableReplicateCount,
    );
    if (!replicateCheck.meetsMinimum) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} has ${eligibility.usableReplicateCount} ${pluralize(eligibility.usableReplicateCount, "Sample")} with complete H/C_org and O/C_org results. Add complete results to at least ${MINIMUM_REPLICATES_PER_BATCH} Samples before submitting.`,
      );
    }

    // (a) Eligibility — judged on the pooled replicate mean (D8); indeterminate fails closed.
    if (eligibility.eligible === false) {
      const parts: string[] = [];
      if (eligibility.hToCWithinThreshold === false) {
        parts.push(
          `H/C_org mean ${eligibility.meanHToCOrgRatio?.toFixed(3)} ≥ ${H_TO_C_ORG_ELIGIBILITY_MAX}`,
        );
      }
      if (eligibility.oToCWithinThreshold === false) {
        parts.push(
          `O/C_org mean ${eligibility.meanOToCOrgRatio?.toFixed(3)} ≥ ${O_TO_C_ORG_ELIGIBILITY_MAX}`,
        );
      }
      blockers.push(
        `Credit batch ${batch.creditBatchCode} fails biochar eligibility (${parts.join("; ")}), under module §3 Table 2.`,
      );
    } else if (eligibility.eligible === null) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} is missing H/C_org or O/C_org chemistry, so its eligibility under module §3 Table 2 cannot be confirmed. Record both values before submitting.`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
