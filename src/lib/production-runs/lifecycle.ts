import { DomainError, type DomainIssue } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { dryOutputExceedsDryInput } from "@/lib/calculations/mass-dry";

export const COMPLETED_PRODUCTION_RUN_STATUS = "complete" as const;
export const CANCELLED_PRODUCTION_RUN_STATUS = "cancelled" as const;
export const DRY_MASS_BALANCE_MESSAGE =
  "Dry output exceeds dry input. Reduce the biochar output or correct the moisture values.";

export const COMPLETE_OUTPUT_MOISTURE_MESSAGE = "Enter biochar moisture for a complete run.";
export const COMPLETE_OUTPUT_BIN_MESSAGE = "Select a biochar output bin for a complete run.";
export const RUNNING_END_FORBIDDEN_MESSAGE = "Choose Complete or clear the end time for a Running run.";

export const PRODUCTION_RUN_STATUSES = [
  "running",
  COMPLETED_PRODUCTION_RUN_STATUS,
  "failed",
  CANCELLED_PRODUCTION_RUN_STATUS,
] as const;

export type ProductionRunStatus = (typeof PRODUCTION_RUN_STATUSES)[number];

export const PRODUCTION_RUN_CREATE_STATUSES = ["running", "complete"] as const;
export const PRODUCTION_RUN_CREATE_STATUS_MESSAGE =
  "A new production run can only start as Running or Complete.";

export function assertProductionRunCreateStatus(status: ProductionRunStatus): void {
  if (PRODUCTION_RUN_CREATE_STATUSES.some((allowed) => allowed === status)) return;
  throw new DomainError("validation_failed", PRODUCTION_RUN_CREATE_STATUS_MESSAGE, {
    issues: [{ path: ["status"], code: "validation_failed", message: PRODUCTION_RUN_CREATE_STATUS_MESSAGE }],
  });
}

type TerminalProductionRunStatus = Extract<
  ProductionRunStatus,
  "complete" | "failed"
>;

export function isTerminalProductionRunStatus(
  status: ProductionRunStatus,
): status is TerminalProductionRunStatus {
  return status === "complete" || status === "failed";
}

export type ProductionRunOutcomeInput = {
  status: ProductionRunStatus;
  startTime: Date | null;
  endTime: Date | null;
  endTimePresent: boolean;
  cancellationReason: string | null | undefined;
  biocharOutputKg: number | null | undefined;
  biocharStorageLocationId: string | null | undefined;
  biocharMoisturePercent: number | null | undefined;
  feedstockWetMassKg: number | null | undefined;
  feedstockMoisturePercent: number | null | undefined;
  feedstock:
    | {
      basis: "form-inputs";
        drawCount?: number;
      }
    | {
        basis: "consumed-mass";
        consumedFeedstockWetKg: number;
      };
};

export type ProductionRunOutcomeViolation =
  | { code: "end-not-after-start" }
  | {
      code: "terminal-end-required";
      status: TerminalProductionRunStatus;
    }
  | { code: "complete-output-required" }
  | { code: "complete-output-bin-required" }
  | { code: "complete-output-moisture-required" }
  | {
      code: "feedstock-required";
      status: TerminalProductionRunStatus;
      basis: ProductionRunOutcomeInput["feedstock"]["basis"];
    }
  | { code: "cancellation-reason-required" }
  | { code: "running-end-forbidden" }
  | { code: "dry-mass-balance-exceeded" };

const ALLOWED_TRANSITIONS: Record<ProductionRunStatus, readonly ProductionRunStatus[]> = {
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

export function shouldIncludeProductionRunEndTime(input: {
  endFieldsTouched: boolean;
  from: ProductionRunStatus;
  to: ProductionRunStatus;
}): boolean {
  return (
    input.endFieldsTouched ||
    (!statusCountsAsPhysicalProduction(input.from) && statusCountsAsPhysicalProduction(input.to))
  );
}

/** Explicitly clear a terminal run's end time when reopening it. */
export function shouldClearProductionRunEndTime(input: {
  from: ProductionRunStatus;
  to: ProductionRunStatus;
  existingEndTime: Date | string | null | undefined;
}): boolean {
  return (
    statusCountsAsPhysicalProduction(input.from) &&
    input.to === "running" &&
    input.existingEndTime != null
  );
}

export function assertProductionRunTransition(
  from: ProductionRunStatus,
  to: ProductionRunStatus,
): void {
  if (ALLOWED_TRANSITIONS[from].includes(to)) return;
  const message = `Production run cannot move from ${from} to ${to}`;
  throw new DomainError("validation_failed", message, {
    issues: [{ path: ["status"], code: "validation_failed", message }],
  });
}

export function getProductionRunOutcomeViolations(
  input: ProductionRunOutcomeInput,
): ProductionRunOutcomeViolation[] {
  const violations: ProductionRunOutcomeViolation[] = [];
  const terminalStatus = isTerminalProductionRunStatus(input.status)
    ? input.status
    : null;

  if (
    input.startTime &&
    input.endTime &&
    input.endTime.getTime() <= input.startTime.getTime()
  ) {
    violations.push({ code: "end-not-after-start" });
  }

  if (terminalStatus && !input.endTimePresent) {
    violations.push({ code: "terminal-end-required", status: terminalStatus });
  }

  if (
    input.status === "complete" &&
    !(input.biocharOutputKg && input.biocharOutputKg > 0)
  ) {
    violations.push({ code: "complete-output-required" });
  }

  if (input.status === "complete" && !input.biocharStorageLocationId) {
    violations.push({ code: "complete-output-bin-required" });
  }

  if (input.status === "complete" && input.biocharMoisturePercent == null) {
    violations.push({ code: "complete-output-moisture-required" });
  }

  if (terminalStatus) {
    const feedstockIsMissing =
      input.feedstock.basis === "form-inputs"
        ? !(
            input.feedstockWetMassKg &&
            input.feedstockWetMassKg > 0 &&
            (input.feedstock.drawCount ?? 0) > 0 &&
            input.feedstockMoisturePercent != null
          )
        : !(input.feedstock.consumedFeedstockWetKg > 0);

    if (feedstockIsMissing) {
      violations.push({
        code: "feedstock-required",
        status: terminalStatus,
        basis: input.feedstock.basis,
      });
    }
  }

  if (input.status === "cancelled" && !input.cancellationReason?.trim()) {
    violations.push({ code: "cancellation-reason-required" });
  }

  if (input.status === "running" && input.endTimePresent) {
    violations.push({ code: "running-end-forbidden" });
  }

  if (dryOutputExceedsDryInput(input)) {
    violations.push({ code: "dry-mass-balance-exceeded" });
  }

  return violations;
}

const MUTATION_VIOLATION_PRIORITY: readonly ProductionRunOutcomeViolation["code"][] = [
  "end-not-after-start",
  "dry-mass-balance-exceeded",
  "cancellation-reason-required",
  "running-end-forbidden",
  "terminal-end-required",
  "feedstock-required",
  "complete-output-required",
  "complete-output-bin-required",
  "complete-output-moisture-required",
];

export function assertProductionRunOutcome(
  input: ProductionRunOutcomeInput,
  options: {
    only?: readonly ProductionRunOutcomeViolation["code"][];
  } = {},
): void {
  const violations = getProductionRunOutcomeViolations(input);
  // Missing terminal input is actionable before comparing dry masses derived
  // from an empty draw list. Keep consumed-mass refusal ordering unchanged.
  const priority = input.feedstock.basis === "form-inputs"
    ? ["end-not-after-start", "feedstock-required", ...MUTATION_VIOLATION_PRIORITY] as const
    : MUTATION_VIOLATION_PRIORITY;
  const violation = priority
    .filter((code) => !options.only || options.only.includes(code))
    .map((code) => violations.find((candidate) => candidate.code === code))
    .find((candidate) => candidate !== undefined);

  if (!violation) return;

  switch (violation.code) {
    case "end-not-after-start":
      throw new SafeError("End time must be after the start time");
    case "dry-mass-balance-exceeded":
      throw new SafeError(DRY_MASS_BALANCE_MESSAGE);
    case "cancellation-reason-required":
      throw new SafeError("A cancellation reason is required");
    case "running-end-forbidden":
      throw new DomainError("validation_failed", RUNNING_END_FORBIDDEN_MESSAGE, {
        issues: [{ path: ["endTime"], code: "validation_failed", message: RUNNING_END_FORBIDDEN_MESSAGE }],
      });
    case "terminal-end-required":
      throw new SafeError(`A ${violation.status} run needs an end time`);
    case "feedstock-required": {
      if (input.feedstock.basis === "form-inputs") {
        const issues: DomainIssue[] = [];
        if (!input.feedstock.drawCount) {
          issues.push({ path: ["feedstockDraws"], code: "validation_failed", message: "Add at least one feedstock source." });
        }
        if (input.feedstockMoisturePercent == null) {
          issues.push({ path: ["feedstockMoisturePercent"], code: "validation_failed", message: "Enter feedstock moisture." });
        }
        if (issues.length) throw new DomainError("validation_failed", issues[0].message, { issues });
      }
      throw new SafeError(`A ${violation.status} run must consume feedstock`);
    }
    case "complete-output-moisture-required":
      throw new DomainError("validation_failed", COMPLETE_OUTPUT_MOISTURE_MESSAGE, {
        issues: [{ path: ["biocharMoisturePercent"], code: "validation_failed", message: COMPLETE_OUTPUT_MOISTURE_MESSAGE }],
      });
    case "complete-output-bin-required":
      throw new DomainError("validation_failed", COMPLETE_OUTPUT_BIN_MESSAGE, {
        issues: [{ path: ["biocharStorageLocationId"], code: "validation_failed", message: COMPLETE_OUTPUT_BIN_MESSAGE }],
      });
    case "complete-output-required":
      throw new SafeError("A complete run must record positive biochar output");
  }
}

export function statusOccupiesReactor(status: ProductionRunStatus): boolean {
  return status !== "cancelled";
}

export function statusCountsAsPhysicalProduction(status: ProductionRunStatus): boolean {
  return status === "complete" || status === "failed";
}
