import { SafeError } from "@/lib/errors";

export const COMPLETED_PRODUCTION_RUN_STATUS = "complete" as const;
export const CANCELLED_PRODUCTION_RUN_STATUS = "cancelled" as const;

export const PRODUCTION_RUN_STATUSES = [
  "draft",
  "running",
  COMPLETED_PRODUCTION_RUN_STATUS,
  "failed",
  CANCELLED_PRODUCTION_RUN_STATUS,
] as const;

export type ProductionRunStatus = (typeof PRODUCTION_RUN_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ProductionRunStatus, readonly ProductionRunStatus[]> = {
  draft: ["draft", "running", "cancelled"],
  running: ["running", "complete", "failed", "cancelled"],
  complete: ["complete", "running"],
  failed: ["failed", "running"],
  cancelled: ["cancelled"],
};

export function allowedProductionRunStatusesFrom(
  status: ProductionRunStatus,
): readonly ProductionRunStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function assertProductionRunTransition(
  from: ProductionRunStatus,
  to: ProductionRunStatus,
): void {
  if (ALLOWED_TRANSITIONS[from].includes(to)) return;
  throw new SafeError(`Production run cannot move from ${from} to ${to}`);
}

export function assertProductionRunOutcome(input: {
  status: ProductionRunStatus;
  startTime: Date;
  endTime: Date | null;
  consumedFeedstockKg: number;
  biocharOutputKg: number | null;
  cancellationReason: string | null;
}): void {
  if (input.endTime && input.endTime <= input.startTime) {
    throw new SafeError("End time must be after the start time");
  }
  if (input.status === "cancelled") {
    if (!input.cancellationReason?.trim()) {
      throw new SafeError("A cancellation reason is required");
    }
    return;
  }
  if (input.status === "running" && input.endTime) {
    throw new SafeError("A running run cannot have an end time");
  }
  if (input.status !== "complete" && input.status !== "failed") return;
  if (!input.endTime) {
    throw new SafeError(`A ${input.status} run needs an end time`);
  }
  if (!(input.consumedFeedstockKg > 0)) {
    throw new SafeError(`A ${input.status} run must consume feedstock`);
  }
  if (input.status === "complete" && !(input.biocharOutputKg && input.biocharOutputKg > 0)) {
    throw new SafeError("A complete run must record positive biochar output");
  }
}

export function statusOccupiesReactor(status: ProductionRunStatus): boolean {
  return status !== "cancelled";
}

export function statusCountsAsPhysicalProduction(status: ProductionRunStatus): boolean {
  return status === "complete" || status === "failed";
}
