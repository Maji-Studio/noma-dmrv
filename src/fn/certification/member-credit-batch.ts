import type {
  CreditBatchAccounting,
  CreditBatchCo2eStoredPreview,
  CreditBatchRollup,
} from "@/data-access/credit-batch-accounting";
import type {
  CreditBatchSampling,
  DurabilityOption,
} from "@/schemas/credit-batches";

export interface MemberCreditBatch {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  appliedWeightTons: number;
  /** Dry applied mass used by the registry product-mass submission. */
  appliedDryWeightTons: number;
  durabilityOption: DurabilityOption;
  sampling: CreditBatchSampling;
  productionRunCount: number;
  applicationCount: number;
  co2eStoredPreview?: CreditBatchCo2eStoredPreview;
  /** Exact submission blockers, separated by their remediation workflow. */
  durabilityGateBlockers?: string[];
  facilityEmissionsGateBlockers?: string[];
}

function includesCo2ePreview(
  accounting: CreditBatchRollup,
): accounting is CreditBatchAccounting {
  return "co2ePreview" in accounting;
}

export function toMemberCreditBatch(
  accounting: CreditBatchRollup,
): MemberCreditBatch {
  const { batch, lineageFacts } = accounting;
  return {
    id: batch.id,
    code: batch.code,
    startDate: batch.startDate,
    endDate: batch.endDate,
    appliedWeightTons: accounting.appliedWeightTons,
    appliedDryWeightTons: lineageFacts.applications.reduce(
      (total, application) =>
        total + (application.biocharAppliedDryTons ?? 0),
      0,
    ),
    durabilityOption: batch.durabilityOption,
    sampling: batch.sampling,
    productionRunCount: lineageFacts.productionRunIds.length,
    applicationCount: lineageFacts.applicationIds.length,
    co2eStoredPreview: includesCo2ePreview(accounting)
      ? accounting.co2ePreview
      : undefined,
  };
}

export function toMemberCreditBatchView(
  batch: MemberCreditBatch,
): MemberCreditBatch {
  return {
    id: batch.id,
    code: batch.code,
    startDate: batch.startDate,
    endDate: batch.endDate,
    appliedWeightTons: batch.appliedWeightTons,
    appliedDryWeightTons: batch.appliedDryWeightTons,
    durabilityOption: batch.durabilityOption,
    sampling: batch.sampling,
    productionRunCount: batch.productionRunCount,
    applicationCount: batch.applicationCount,
    co2eStoredPreview: batch.co2eStoredPreview,
    durabilityGateBlockers: batch.durabilityGateBlockers,
    facilityEmissionsGateBlockers: batch.facilityEmissionsGateBlockers,
  };
}
