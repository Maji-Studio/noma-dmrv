import { SafeError } from "@/lib/errors";
import {
  formatProductionRunFutureTimeError,
  getFutureProductionRunTimeFields,
} from "@/lib/production-runs/time-validation";

export type ProductionRunMutationOptions = {
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
    throw new SafeError(formatProductionRunFutureTimeError(futureFields));
  }
}
