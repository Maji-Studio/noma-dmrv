/** Groups the newest-first list by local calendar day, each with its heading ("Today", "Yesterday", or the app date). */
import { format } from "date-fns/format";
import { isToday } from "date-fns/isToday";
import { isYesterday } from "date-fns/isYesterday";
import { formatDate } from "@/lib/format-utils";
import type { ActivityItem } from "./activity-display";

const DAY_KEY_FORMAT = "yyyy-MM-dd";
const TIME_FORMAT = "HH:mm";

/** Consecutive changes by one actor no further apart than this read as one burst (a seed, an import, a save). */
export const ACTIVITY_CLUSTER_WINDOW_MS = 60_000;

/** One burst: its head is the newest entry, which carries the actor and time once for the rest. */
export interface ActivityCluster {
  key: string;
  items: ActivityItem[];
}

export interface ActivityDayGroup {
  key: string;
  label: string;
  clusters: ActivityCluster[];
}

function actorKey(item: ActivityItem): string {
  return `${item.actor?.id ?? "none"}:${item.source}`;
}

export function activityDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return formatDate(date);
}

/** The time of day on the viewer's clock, as the day heading carries the date. */
export function activityTimeLabel(date: Date): string {
  return format(date, TIME_FORMAT);
}

/** Keeps the incoming order; a day that reappears after another (it cannot, for a sorted list) starts a new group. */
export function groupActivityByDay(items: readonly ActivityItem[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  let previous: ActivityItem | undefined;
  for (const item of items) {
    const key = format(item.occurredAt, DAY_KEY_FORMAT);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: activityDayLabel(item.occurredAt), clusters: [] };
      groups.push(group);
      previous = undefined;
    }
    const cluster = group.clusters.at(-1);
    const joins =
      cluster && previous &&
      actorKey(previous) === actorKey(item) &&
      Math.abs(previous.occurredAt.getTime() - item.occurredAt.getTime()) <= ACTIVITY_CLUSTER_WINDOW_MS;
    if (joins) cluster.items.push(item);
    else group.clusters.push({ key: item.id, items: [item] });
    previous = item;
  }
  return groups;
}
