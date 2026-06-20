"use server";

import type { ActionResult } from "@/types/actions";
import {
  getProductionProcessSummariesByFacility,
  type ProductionProcessSummary,
} from "@/data-access/production-processes";
import { withAction } from "./with-action";

/**
 * Read-only operator view of a facility's production processes (ADR 0017
 * Track 1.5): sampling method, Method-B baseline progress, and cadence status
 * per (facility, feedstock) process.
 */
export async function getProductionProcessSummariesByFacilityFn(
  facilityId: string,
): Promise<ActionResult<ProductionProcessSummary[]>> {
  return withAction((userId) =>
    getProductionProcessSummariesByFacility(userId, facilityId),
  );
}
