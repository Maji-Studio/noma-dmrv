import { formatFacilityDate } from "@/lib/date-utils";
import { formatFacilityClockTime, formatFacilityShortDateTime } from "@/lib/format-utils";

/**
 * "Updated 16:16" today, "Updated Nov 9, 16:16" on another day: the page is
 * a snapshot, not live, and the year adds nothing.
 */
export function updatedLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (formatFacilityDate(at, timeZone) === formatFacilityDate(now, timeZone)) {
    return `Updated ${formatFacilityClockTime(at, timeZone)}`;
  }
  return `Updated ${formatFacilityShortDateTime(at, timeZone, now)}`;
}
