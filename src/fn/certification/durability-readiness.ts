import type { OrgContext } from "@/lib/auth/server";
import {
  getCreditBatchesWithSamples,
  type CreditBatchWithSamples,
} from "@/data-access/credit-batch-samples";
import {
  evaluateDurabilitySubmissionGates,
  type BatchGateFacts,
} from "@/lib/certification/durability-submission-gates";
import { formatFacilityDate } from "@/lib/date-utils";

export interface DurabilityGateResult {
  /** Fail-closed blockers — the exact list the submit pipeline blocks on. */
  blockers: string[];
  /** Non-blocking §8.3.1 representative-sampling advisories. */
  warnings: string[];
}

export interface DurabilityBatchData extends DurabilityGateResult {
  /** Member credit batches with pooled Samples, runs scoped to the applied set. */
  batchesWithSamples: CreditBatchWithSamples[];
  /** Exact submission-gate blockers keyed to the batch that produced them. */
  blockersByBatchId: Record<string, string[]>;
}

/**
 * Load the credit-batch-grained durability data plane (ADR 0016) for a removal:
 * pool each member batch's lab Samples (by `samples.creditBatchId`), scope each
 * batch's member runs to the removal's applied run set so product mass stays
 * attribution-correct, then run the D3 gates. One call returns the batches (for
 * the per-batch measurement-sample submission, Phase 3) plus the gate blockers
 * and the §8.3.1 representative-sampling warnings. Keeps
 * `certify-context-core` lean.
 */
export async function loadDurabilityBatchData(
  orgCtx: OrgContext,
  memberBatchIds: string[],
  appliedRunIds: ReadonlySet<string>,
): Promise<DurabilityBatchData> {
  const loaded = await getCreditBatchesWithSamples(orgCtx, memberBatchIds);
  const batchesWithSamples = loaded.map((batch) => ({
    ...batch,
    runs: batch.runs.filter((run) => appliedRunIds.has(run.id)),
  }));
  const gates = buildDurabilityBatchGates(batchesWithSamples);
  return { batchesWithSamples, ...gates };
}

export function buildDurabilityBatchGates(
  batchesWithSamples: CreditBatchWithSamples[],
): DurabilityGateResult & Pick<DurabilityBatchData, "blockersByBatchId"> {
  const perBatchGates = batchesWithSamples.map((batch) => ({
    creditBatchId: batch.creditBatchId,
    gates: buildDurabilityGates([batch]),
  }));
  return {
    blockers: perBatchGates.flatMap(({ gates }) => gates.blockers),
    warnings: perBatchGates.flatMap(({ gates }) => gates.warnings),
    blockersByBatchId: Object.fromEntries(
      perBatchGates.map(({ creditBatchId, gates }) => [
        creditBatchId,
        gates.blockers,
      ]),
    ),
  };
}

function isoSamplingDay(
  samplingTime: Date | null | undefined,
  facilityTimezone: string,
): string | null {
  if (!samplingTime) return null;
  const day = formatFacilityDate(samplingTime, facilityTimezone);
  return day || null;
}

/**
 * Evaluate the D3 durability gates (eligibility + sampled-choice evidence + ≥3
 * representative replicates) over a removal's CREDIT BATCHES
 * (ADR 0016: the credit batch is the protocol production batch and the sampling
 * unit). The immutable sampling choice comes from each batch (D6). The single
 * computation behind BOTH the readiness
 * surfaces and the submit pipeline's hard block — `submitRemoval` throws on this
 * same `blockers` list, so the pre-flight can never disagree with the gate.
 * Returns empty lists when there are no batches (nothing to sample yet). Lives
 * outside `certify-context-core` to keep that file under the line cap.
 */
export function buildDurabilityGates(
  batches: CreditBatchWithSamples[],
): DurabilityGateResult {
  if (batches.length === 0) return { blockers: [], warnings: [] };
  const facts: BatchGateFacts[] = batches.map((batch) => ({
    creditBatchId: batch.creditBatchId,
    creditBatchCode: batch.creditBatchCode,
    startDate: batch.startDate,
    endDate: batch.endDate,
    sampling: batch.sampling,
    replicates: batch.samples.map((s) => ({
      hToCOrgRatio: s.hToCOrgRatio,
      oToCOrgRatio: s.oToCOrgRatio,
    })),
    replicateProvenance: batch.samples.map((s) => ({
      sampleCode: s.sampleCode,
      samplingDay: isoSamplingDay(s.samplingTime, batch.facilityTimezone),
    })),
  }));
  const result = evaluateDurabilitySubmissionGates(facts);
  return { blockers: result.blockers, warnings: result.warnings };
}
