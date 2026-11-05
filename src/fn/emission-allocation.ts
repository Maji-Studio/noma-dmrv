"use server";

import { z } from "zod";
import { getEmissionAllocation } from "@/data-access/emission-allocation";
import { uuidSchema } from "@/schemas/helpers";
import type { ActionResult } from "@/types/actions";
import type { EmissionAllocation, EmissionAllocationInput } from "@/types/emission-allocation";
import { withAction } from "./with-action";

const inputSchema = z.union([
  z.strictObject({ creditBatchId: uuidSchema() }),
  z.strictObject({ removalId: uuidSchema() }),
]);

export async function getEmissionAllocationFn(input: EmissionAllocationInput): Promise<ActionResult<EmissionAllocation>> {
  return withAction(ctx => getEmissionAllocation(ctx, inputSchema.parse(input)), {
    fallbackMessage: "Allocation could not be loaded.",
  });
}
