"use server";

import { z } from "zod";
import {
  getMethodBEligibility,
  recordMethodBPrerequisites,
  startNewProductionProcess,
  type MethodBEligibility,
} from "@/data-access/production-processes";
import type { ProductionProcess } from "@/db/schema";
import { requireOrgRole } from "@/lib/auth/server";
import {
  recordMethodBPrerequisitesSchema,
  startNewProcessSchema,
} from "@/schemas/production-process";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const methodBEligibilityInputSchema = z.object({
  facilityId: z.uuid(),
  feedstockTypeId: z.uuid(),
});

export async function getMethodBEligibilityFn(
  input: unknown,
): Promise<ActionResult<MethodBEligibility>> {
  return withAction((ctx) =>
    getMethodBEligibility(ctx, methodBEligibilityInputSchema.parse(input)),
  );
}

export async function recordMethodBPrerequisitesFn(
  input: unknown,
): Promise<ActionResult<ProductionProcess>> {
  return withAction((ctx) => {
    requireOrgRole(ctx, "admin");
    return recordMethodBPrerequisites(
      ctx,
      recordMethodBPrerequisitesSchema.parse(input),
    );
  });
}

export async function startNewProductionProcessFn(
  input: unknown,
): Promise<ActionResult<ProductionProcess>> {
  return withAction((ctx) => {
    requireOrgRole(ctx, "admin");
    return startNewProductionProcess(ctx, startNewProcessSchema.parse(input));
  });
}
