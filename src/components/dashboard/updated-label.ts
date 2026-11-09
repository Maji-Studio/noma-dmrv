import { formatFacilityDate, formatFacilityTime } from "@/lib/date-utils";

/**
 * "Updated 16:16" today, "Updated Nov 9, 16:16" on another day: the page is
 * a snapshot, not live, and the year adds nothing.
 */
export function updatedLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = formatFacilityTime(at, timeZone, "HH:mm");
  if (formatFacilityDate(at, timeZone) === formatFacilityDate(now, timeZone)) return `Updated ${time}`;
  return `Updated ${formatFacilityTime(at, timeZone, "MMM d")}, ${time}`;
}
