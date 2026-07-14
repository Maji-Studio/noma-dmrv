"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import {
  getMethodBEligibilityByProcess,
  type MethodBEligibilitySummary,
} from "@/data-access/isometric";
import {
  processSamplingMethodSchema,
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

export type ProcessSamplingEligibilityResult = {
  process_id: string;
  sampling_method: "method_a" | "method_b";
  method_b_eligibility: MethodBEligibilitySummary;
};

/**
 * Validate a Method A/B selection for a PRODUCTION PROCESS and attach its live
 * baseline eligibility (≥30 process-scoped Method-A samples, `G-F74T-0`). The
 * process — not the reactor — carries the sampling method (ADR 0017).
 */
export async function validateProcessSamplingMethodFn(
  data: z.infer<typeof processSamplingMethodSchema>
): Promise<ActionResult<ProcessSamplingEligibilityResult>> {
  return withAction(async (orgCtx) => {
    const validated = processSamplingMethodSchema.parse(data);

    const eligibility = await getMethodBEligibilityByProcess(orgCtx, {
      productionProcessId: validated.process_id,
      asOfDate: new Date(),
    });

    const parsedWithEligibility = processSamplingMethodSchema.parse({
      ...validated,
      prior_method_a_sample_count: eligibility.priorMethodASampleCount,
    });

    return {
      process_id: parsedWithEligibility.process_id,
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
