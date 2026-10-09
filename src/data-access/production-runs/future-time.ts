import type { SnapshotStock } from "../stock-effects";
import { DomainError } from "@/lib/domain-errors";
import {
  formatProductionRunFutureTimeError,
  PRODUCTION_RUN_FUTURE_TIME_MESSAGES,
  getFutureProductionRunTimeFields,
} from "@/lib/production-runs/time-validation";

export type ProductionRunMutationOptions = {
  snapshotStock?: SnapshotStock;
  /** Injectable server clock for exact-boundary tests. */
  now?: Date;
};

export function assertProductionRunTimesNotFuture(
  input: {
    startTime: Date | null | undefined;
    endTime: Date | null | undefined;
  },
  now: Date,
): void {
  const futureFields = getFutureProductionRunTimeFields(input, now);
  if (futureFields.length > 0) {
    throw new DomainError("validation_failed", formatProductionRunFutureTimeError(futureFields), {
      issues: futureFields.map((field) => ({ path: [field], code: "validation_failed", message: PRODUCTION_RUN_FUTURE_TIME_MESSAGES[field] })),
    });
  }
}
