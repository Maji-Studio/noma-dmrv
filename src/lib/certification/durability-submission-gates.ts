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
 *   (d) Paired submission: eligibility is judged on paired replicates, but
 *       the submitted H/C_org mean pools every usable H/C_org
 *       (`buildPerBatchDurabilityData`). A replicate with a usable H/C_org and
 *       no usable O/C_org blocks, so clearing O/C_org cannot hide an adverse
 *       H/C_org from eligibility while it still reaches the registry
 *       (round 7 Q54).
 *
 * §8.3.1 requires the 3 replicates to be "representative of the full range of
 * physical characteristics (eg. particle size, color) available in the batch" —
 * it does NOT require them to be drawn from distinct production runs or distinct
 * calendar days. (The distinct-days language in §8.3.1 governs Method B's
 * random-sampling cadence ACROSS production batches, a separate requirement.)
 * We therefore do not judge within-batch run/day distribution at all.
 *
 * A sample after the production window only warns: §8.3.1 asks for biochar in its
 * "final pre-storage condition" (before blending when co-applied), not by the end
 * date, so the operator confirms the Sample represents that condition. A sample
 * before the production window is physically impossible and blocks submission.
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
 * The unpaired-H/C_org explanation shared by blocker (d) and the readiness
 * chip, so both surfaces name the same Samples in the same order and words.
 */
export function describeUnpairedHToCSamples(sampleCodes: string[]): string {
  const count = sampleCodes.length;
  const sorted = [...sampleCodes].sort((left, right) =>
    left.localeCompare(right),
  );
  return `${count} ${pluralize(count, "Sample")} with H/C_org but no O/C_org: ${sorted.join(", ")}. Eligibility is judged only on Samples with both ratios, so ${count === 1 ? "this H/C_org goes" : "these H/C_org values go"} unchecked. Record the O/C_org or correct the ${pluralize(count, "Sample")} before submitting.`;
}

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
  /**
   * Parallel to `replicates` (same index): each replicate's Sample code and
   * day, for window diagnostics and the paired-submission blocker.
   */
  replicateProvenance: ReplicateProvenance[];
}

export interface DurabilitySubmissionGateResult {
  ok: boolean;
  /** One human-readable blocker line per failed gate, ready to join into a SafeError. */
  blockers: string[];
  /** Non-blocking advisories: currently the after-window sampling warning. */
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
            `Sample ${sample.sampleCode} was taken on ${sample.samplingDay}, after credit batch ${batch.creditBatchCode}'s production window, ${batch.startDate} to ${batch.endDate}. §8.3.1 says biochar should be sampled in its final pre-storage condition, after processing and at typical moisture levels, and before blending when it is applied with other substances such as compost. Confirm this Sample represents the batch in that condition.`,
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

    // (d) Paired submission: the submitted H/C_org population (same
    // `isUsableNumber` predicate as the aggregation) minus the paired replicates
    // eligibility already judged.
    const unpairedSampleCodes = eligibility.unpairedHToCReplicateIndexes.map(
      (index) => batch.replicateProvenance[index].sampleCode,
    );
    if (unpairedSampleCodes.length > 0) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} has ${describeUnpairedHToCSamples(unpairedSampleCodes)}`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
