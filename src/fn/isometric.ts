"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import {
  getMethodBEligibilityByReactor,
  type MethodBEligibilitySummary,
} from "@/data-access/isometric";
import {
  reactorSamplingMethodSchema,
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

export type ReactorSamplingEligibilityResult = {
  reactor_id: string;
  sampling_method: "method_a" | "method_b";
  method_b_eligibility: MethodBEligibilitySummary;
};

export async function validateReactorSamplingMethodFn(
  data: z.infer<typeof reactorSamplingMethodSchema>
): Promise<ActionResult<ReactorSamplingEligibilityResult>> {
  try {
    const validated = reactorSamplingMethodSchema.parse(data);

    const eligibility = await getMethodBEligibilityByReactor({
      reactorId: validated.reactor_id,
    });

    const parsedWithEligibility = reactorSamplingMethodSchema.parse({
      ...validated,
      prior_method_a_sample_count: eligibility.priorMethodASampleCount,
    });

    return {
      success: true,
      data: {
        reactor_id: parsedWithEligibility.reactor_id,
        sampling_method: parsedWithEligibility.sampling_method,
        method_b_eligibility: {
          ...eligibility,
          isEligible:
            parsedWithEligibility.sampling_method === "method_a"
              ? true
              : eligibility.isEligible,
        },
      },
    };
  } catch (error) {
    return { success: false, error: mapValidationError(error) };
  }
}

// Backward-compatible alias while callers migrate to reactor-level naming.
export async function validateCreditBatchSamplingMethodFn(
  data: z.infer<typeof reactorSamplingMethodSchema>
): Promise<ActionResult<ReactorSamplingEligibilityResult>> {
  return validateReactorSamplingMethodFn(data);
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
