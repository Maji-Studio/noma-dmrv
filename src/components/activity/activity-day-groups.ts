/** Groups activity by the facility calendar, preserving newest-first order. */
import { addDaysIso, facilityToday, formatFacilityDate } from "@/lib/date-utils";
import { formatDayString } from "@/lib/format-utils";
import type { ActivityItem } from "./activity-display";

const YESTERDAY_OFFSET_DAYS = -1;

export interface ActivityDayGroup {
  key: string;
  label: string;
  items: ActivityItem[];
}

export function activityDayLabel(date: Date, timeZone: string, now = new Date()): string {
  const day = formatFacilityDate(date, timeZone);
  const today = facilityToday(timeZone, now);
  if (day === today) return "Today";
  if (day === addDaysIso(today, YESTERDAY_OFFSET_DAYS)) return "Yesterday";
  return formatDayString(day);
}

/** Keeps the incoming order; a day that reappears after another (it cannot, for a sorted list) starts a new group. */
export function groupActivityByDay(items: readonly ActivityItem[], timeZone: string, now = new Date()): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  for (const item of items) {
    const key = formatFacilityDate(item.occurredAt, timeZone);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: activityDayLabel(item.occurredAt, timeZone, now), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
