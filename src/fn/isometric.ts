"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import {
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
