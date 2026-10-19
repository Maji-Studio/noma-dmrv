/** Groups the newest-first list by local calendar day, each with its heading ("Today", "Yesterday", or the app date). */
import { format } from "date-fns/format";
import { isToday } from "date-fns/isToday";
import { isYesterday } from "date-fns/isYesterday";
import { formatDate, formatTime } from "@/lib/format-utils";
import type { ActivityItem } from "./activity-display";

const DAY_KEY_FORMAT = "yyyy-MM-dd";

/** Changes by one actor within this long of the burst's newest change read as one burst (a seed, an import, a save). */
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
  return formatTime(date);
}

/** Keeps the incoming order; a day that reappears after another (it cannot, for a sorted list) starts a new group. */
export function groupActivityByDay(items: readonly ActivityItem[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  for (const item of items) {
    const key = format(item.occurredAt, DAY_KEY_FORMAT);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: activityDayLabel(item.occurredAt), clusters: [] };
      groups.push(group);
    }
    const cluster = group.clusters.at(-1);
    // Measured from the cluster head, so a steady stream cannot chain into one long burst.
    const head = cluster?.items[0];
    const joins =
      cluster && head &&
      actorKey(head) === actorKey(item) &&
      Math.abs(head.occurredAt.getTime() - item.occurredAt.getTime()) <= ACTIVITY_CLUSTER_WINDOW_MS;
    if (joins) cluster.items.push(item);
    else group.clusters.push({ key: item.id, items: [item] });
  }
  return groups;
}
