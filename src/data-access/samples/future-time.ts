import { SAMPLE_FUTURE_TIME_MESSAGES } from "@/lib/sample-domain-errors";
import { assertEventTimesNotFuture } from "../future-event-time";

/**
 * Refuses a sampling time after `now` (decision 56; round 7 Q51) as
 * `validation_failed` on `/samplingTime`. Backdating stays allowed; the
 * production-window lower bound is a separate check.
 */
export function assertSamplingTimeNotFuture(samplingTime: Date, now: Date): void {
  assertEventTimesNotFuture({ samplingTime }, SAMPLE_FUTURE_TIME_MESSAGES, now);
}
