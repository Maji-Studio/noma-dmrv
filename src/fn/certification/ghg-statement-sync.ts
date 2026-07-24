"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  reconcileGhgStatementsForFacility,
  type ReconcileRegistryGhgStatementsResult,
} from "./ghg-statement-reconciliation";

const facilityIdSchema = z.uuid();

export async function reconcileGhgStatementsFromRegistry(
  facilityId: string,
): Promise<ActionResult<ReconcileRegistryGhgStatementsResult>> {
  return withAction(async (orgCtx) => {
    const parsedFacilityId = facilityIdSchema.parse(facilityId);
    return reconcileGhgStatementsForFacility(orgCtx, parsedFacilityId);
  });
}
