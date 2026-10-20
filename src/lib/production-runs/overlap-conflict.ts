/**
 * Client-safe carrier for a production-run overlap conflict (issue #259).
 *
 * The server action returns `{ success: false, error, conflict }` on an
 * overlapping time window. The React Query mutation hooks re-throw that as this
 * typed error so the form can pull the message onto the start-time field and
 * link straight to the conflicting run. Kept free of server-only imports so it
 * is safe to use in client components.
 */

import { formatFacilityDate, formatFacilityTime } from "@/lib/date-utils";
import type { ConflictRef } from "@/lib/conflict-ref";

const OVERLAP_CLOCK_FORMAT = "HH:mm";

export type RunConflict = ConflictRef;

export class ProductionRunConflictError extends Error {
  readonly conflict: RunConflict;
  constructor(message: string, conflict: RunConflict) {
    super(message);
    this.name = "ProductionRunConflictError";
    this.conflict = conflict;
  }
}

/** Return the conflict payload if `err` is a production-run overlap error. */
export function getRunConflict(err: unknown): RunConflict | null {
  return err instanceof ProductionRunConflictError ? err.conflict : null;
}

/** Build the overlap refusal using the conflicting run's facility calendar. */
export function formatProductionRunOverlapMessage(conflict: {
  code: string;
  startTime: Date;
  endTime: Date | null;
  facilityTimezone: string;
}): string {
  if (!conflict.endTime) {
    return `Production run ${conflict.code} on this reactor is unfinished. Set its end time before adding another run.`;
  }
  const { startTime, endTime, facilityTimezone } = conflict;
  const startDay = formatFacilityDate(startTime, facilityTimezone);
  const endDay = formatFacilityDate(endTime, facilityTimezone);
  const startClock = formatFacilityTime(startTime, facilityTimezone, OVERLAP_CLOCK_FORMAT);
  const endClock = formatFacilityTime(endTime, facilityTimezone, OVERLAP_CLOCK_FORMAT);
  const window = startDay === endDay
    ? `${startDay} ${startClock} to ${endClock}`
    : `${startDay} ${startClock} to ${endDay} ${endClock}`;
  return `Overlaps run ${conflict.code} (${window}) on this reactor`;
}
