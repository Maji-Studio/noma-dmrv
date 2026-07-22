import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";

export interface MethodBEligibility {
  productionProcessId: string | null;
  eligibleSampleCount: number;
  agreedBaselineSize: number;
  prerequisitesRecorded: boolean;
  randomSamplingPlanRef: string | null;
  moisturePathway: string | null;
  unsampledAllowed: boolean;
}

export function deriveMethodBEligibility(params: {
  productionProcessId: string | null;
  eligibleSampleCount: number;
  agreedBaselineSize: number | null;
  randomSamplingPlanRef: string | null;
  moisturePathway: string | null;
}): MethodBEligibility {
  const prerequisitesRecorded =
    params.agreedBaselineSize !== null &&
    params.randomSamplingPlanRef !== null &&
    params.randomSamplingPlanRef.trim().length > 0 &&
    params.moisturePathway !== null;
  const agreedBaselineSize =
    params.agreedBaselineSize ?? METHOD_B_MINIMUM_METHOD_A_SAMPLES;
  return {
    productionProcessId: params.productionProcessId,
    eligibleSampleCount: params.eligibleSampleCount,
    agreedBaselineSize,
    prerequisitesRecorded,
    randomSamplingPlanRef: params.randomSamplingPlanRef,
    moisturePathway: params.moisturePathway,
    unsampledAllowed:
      prerequisitesRecorded && params.eligibleSampleCount >= agreedBaselineSize,
  };
}
