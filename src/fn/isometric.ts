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
  deliveryDryMassSchema,
  sampleConditionSchema,
  transportLegConditionSchema,
} from "@/schemas/isometric";
import { withAction } from "./with-action";

export async function validateTransportLegFn(
  data: z.infer<typeof transportLegConditionSchema>
): Promise<ActionResult<z.infer<typeof transportLegConditionSchema>>> {
  return withAction(async () => transportLegConditionSchema.parse(data));
}

export async function validateCreditBatchFn(
  data: z.infer<typeof creditBatchConditionSchema>
): Promise<ActionResult<z.infer<typeof creditBatchConditionSchema>>> {
  return withAction(async () => creditBatchConditionSchema.parse(data));
}

export type ReactorSamplingEligibilityResult = {
  reactor_id: string;
  sampling_method: "method_a" | "method_b";
  method_b_eligibility: MethodBEligibilitySummary;
};

export async function validateReactorSamplingMethodFn(
  data: z.infer<typeof reactorSamplingMethodSchema>
): Promise<ActionResult<ReactorSamplingEligibilityResult>> {
  return withAction(async (userId) => {
    const validated = reactorSamplingMethodSchema.parse(data);

    const eligibility = await getMethodBEligibilityByReactor(userId, {
      reactorId: validated.reactor_id,
    });

    const parsedWithEligibility = reactorSamplingMethodSchema.parse({
      ...validated,
      prior_method_a_sample_count: eligibility.priorMethodASampleCount,
    });

    return {
      reactor_id: parsedWithEligibility.reactor_id,
      sampling_method: parsedWithEligibility.sampling_method,
      method_b_eligibility: {
        ...eligibility,
        isEligible:
          parsedWithEligibility.sampling_method === "method_a"
            ? true
            : eligibility.isEligible,
      },
    };
  });
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
  return withAction(async () => sampleConditionSchema.parse(data));
}

export async function validateDeliveryDryMassFn(
  data: z.infer<typeof deliveryDryMassSchema>
): Promise<ActionResult<z.infer<typeof deliveryDryMassSchema>>> {
  return withAction(async () => deliveryDryMassSchema.parse(data));
}
