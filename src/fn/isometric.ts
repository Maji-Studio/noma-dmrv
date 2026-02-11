"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import {
  getMethodBEligibilityByReactor,
  type MethodBEligibilitySummary,
} from "@/data-access/isometric";
import {
  creditBatchSamplingMethodSchema,
  creditBatchConditionSchema,
  continuousGasMeasurementSchema,
  deliveryDryMassSchema,
  sampleConditionSchema,
  transportLegConditionSchema,
} from "@/schemas/isometric";

function mapValidationError(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : "Validation failed";
  }

  return error.issues
    .map((issue) => issue.message)
    .filter(Boolean)
    .join("; ");
}

export async function validateTransportLegFn(
  data: z.infer<typeof transportLegConditionSchema>
): Promise<ActionResult<z.infer<typeof transportLegConditionSchema>>> {
  try {
    return { success: true, data: transportLegConditionSchema.parse(data) };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}

export async function validateCreditBatchFn(
  data: z.infer<typeof creditBatchConditionSchema>
): Promise<ActionResult<z.infer<typeof creditBatchConditionSchema>>> {
  try {
    return { success: true, data: creditBatchConditionSchema.parse(data) };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}

export type CreditBatchSamplingEligibilityResult = {
  sampling_method: "method_a" | "method_b";
  reactor_id: string | null;
  reporting_period_start: string;
  reporting_period_end: string;
  method_b_eligibility: MethodBEligibilitySummary | null;
};

export async function validateCreditBatchSamplingMethodFn(
  data: z.infer<typeof creditBatchSamplingMethodSchema>
): Promise<ActionResult<CreditBatchSamplingEligibilityResult>> {
  try {
    const validated = creditBatchSamplingMethodSchema.parse(data);

    if (validated.sampling_method === "method_a") {
      return {
        success: true,
        data: {
          sampling_method: validated.sampling_method,
          reactor_id: validated.reactor_id ?? null,
          reporting_period_start: validated.reporting_period_start,
          reporting_period_end: validated.reporting_period_end,
          method_b_eligibility: null,
        },
      };
    }

    if (!validated.reactor_id) {
      return {
        success: false,
        error: "reactor_id is required when sampling_method=method_b",
      };
    }

    const eligibility = await getMethodBEligibilityByReactor({
      reactorId: validated.reactor_id,
      reportingPeriodStart: validated.reporting_period_start,
      reportingPeriodEnd: validated.reporting_period_end,
    });

    const parsedWithEligibility = creditBatchSamplingMethodSchema.parse({
      ...validated,
      prior_method_a_sample_count: eligibility.priorMethodASampleCount,
      reporting_period_run_count: eligibility.reportingPeriodRunCount,
      reporting_period_sampled_run_count: eligibility.reportingPeriodSampledRunCount,
    });

    return {
      success: true,
      data: {
        sampling_method: parsedWithEligibility.sampling_method,
        reactor_id: parsedWithEligibility.reactor_id ?? null,
        reporting_period_start: parsedWithEligibility.reporting_period_start,
        reporting_period_end: parsedWithEligibility.reporting_period_end,
        method_b_eligibility: eligibility,
      },
    };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}

export async function validateSampleConditionsFn(
  data: z.infer<typeof sampleConditionSchema>
): Promise<ActionResult<z.infer<typeof sampleConditionSchema>>> {
  try {
    return { success: true, data: sampleConditionSchema.parse(data) };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}

export async function validateContinuousGasMeasurementFn(
  data: z.infer<typeof continuousGasMeasurementSchema>
): Promise<ActionResult<z.infer<typeof continuousGasMeasurementSchema>>> {
  try {
    return {
      success: true,
      data: continuousGasMeasurementSchema.parse(data),
    };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}

export async function validateDeliveryDryMassFn(
  data: z.infer<typeof deliveryDryMassSchema>
): Promise<ActionResult<z.infer<typeof deliveryDryMassSchema>>> {
  try {
    return { success: true, data: deliveryDryMassSchema.parse(data) };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}
