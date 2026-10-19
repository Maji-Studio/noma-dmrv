/** Groups the newest-first list by local calendar day, each with its heading ("Today", "Yesterday", or the app date). */
import { format } from "date-fns/format";
import { isToday } from "date-fns/isToday";
import { isYesterday } from "date-fns/isYesterday";
import { formatDate } from "@/lib/format-utils";
import type { ActivityItem } from "./activity-display";

const DAY_KEY_FORMAT = "yyyy-MM-dd";

export interface ActivityDayGroup {
  key: string;
  label: string;
  items: ActivityItem[];
}

export function activityDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return formatDate(date);
}

/** Keeps the incoming order; a day that reappears after another (it cannot, for a sorted list) starts a new group. */
export function groupActivityByDay(items: readonly ActivityItem[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  for (const item of items) {
    const key = format(item.occurredAt, DAY_KEY_FORMAT);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: activityDayLabel(item.occurredAt), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
