"use server";

import type { ActionResult } from "@/types/actions";
import {
  getProcessComplianceDrift,
  getProductionProcessSummariesByFacility,
  getUnsampledCarbonPreviewForProcess,
  startNewProductionProcess,
  unlockMethodBForProcess,
  type ProcessCarbonPreview,
  type ProcessComplianceDriftResult,
  type ProductionProcessSummary,
} from "@/data-access/production-processes";
import type { ProductionProcess } from "@/db/schema";
import {
  startNewProcessSchema,
  unlockMethodBSchema,
} from "@/schemas/production-process";
import { withAction } from "./with-action";

/**
 * Read-only operator view of a facility's production processes (ADR 0017
 * Track 1.5): sampling method, Method-B baseline progress, and cadence status
 * per (facility, feedstock) process.
 */
export async function getProductionProcessSummariesByFacilityFn(
  facilityId: string,
): Promise<ActionResult<ProductionProcessSummary[]>> {
  return withAction((ctx) =>
    getProductionProcessSummariesByFacility(ctx, facilityId),
  );
}

/**
 * Unlock Method B for a production process (ADR 0017 Track 2): flip the sampling
 * method, stamp the unlock, and persist the three captured protocol
 * prerequisites. Validates the input, then the data-access layer re-asserts the
 * ≥30 baseline (app guard + DB trigger backstop).
 */
export async function unlockMethodBFn(
  input: unknown,
): Promise<ActionResult<ProductionProcess>> {
  return withAction((ctx) =>
    unlockMethodBForProcess(ctx, unlockMethodBSchema.parse(input)),
  );
}

/**
 * Non-authoritative unsampled-carbon preview (Eq 4/5) for a production process
 * (ADR 0017 Track 2, item 6). Optional `asOfDateIso` anchors the eligible window
 * on a specific batch's production date; defaults to now. The registry computes
 * the credited number (D1) — this is an operator preview only.
 */
export async function getUnsampledCarbonPreviewFn(
  productionProcessId: string,
  asOfDateIso?: string,
): Promise<ActionResult<ProcessCarbonPreview>> {
  return withAction((ctx) =>
    getUnsampledCarbonPreviewForProcess(
      ctx,
      productionProcessId,
      asOfDateIso ? new Date(asOfDateIso) : undefined,
    ),
  );
}

/**
 * The two trailing-window compliance counters for a process (ADR 0017 item 7):
 * missed required samplings + sub-3σ measurements. Warn-only.
 */
export async function getProcessComplianceDriftFn(
  productionProcessId: string,
  asOfDateIso?: string,
): Promise<ActionResult<ProcessComplianceDriftResult>> {
  return withAction((ctx) =>
    getProcessComplianceDrift(
      ctx,
      productionProcessId,
      asOfDateIso ? new Date(asOfDateIso) : undefined,
    ),
  );
}

/**
 * Start a new production process (ADR 0017 item 7 / D6): the deliberate,
 * human-confirmed baseline reset back to Method A. Facility + feedstock come from
 * context; an optional note records the reason.
 */
export async function startNewProductionProcessFn(
  input: unknown,
): Promise<ActionResult<ProductionProcess>> {
  return withAction((ctx) =>
    startNewProductionProcess(ctx, startNewProcessSchema.parse(input)),
  );
}
