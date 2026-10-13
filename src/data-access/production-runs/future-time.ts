import type { SnapshotStock } from "../stock-effects";
import { assertEventTimesNotFuture } from "../future-event-time";
import {
  formatProductionRunFutureTimeError,
  PRODUCTION_RUN_FUTURE_TIME_MESSAGES,
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
  assertEventTimesNotFuture(
    { startTime: input.startTime, endTime: input.endTime },
    PRODUCTION_RUN_FUTURE_TIME_MESSAGES,
    now,
    formatProductionRunFutureTimeError,
  );
}
