/** Groups activity by the facility calendar, preserving newest-first order. */
import { addDaysIso, facilityToday, formatFacilityDate } from "@/lib/date-utils";
import { formatDayString } from "@/lib/format-utils";
import { activityFieldLines } from "./activity-change-lines";
import { activityChangeSummary, isHiddenActivityField, type ActivityItem } from "./activity-display";

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

/** One row of the feed: the newest of a run of identical events, and how many the run holds. */
export interface ActivityRun {
  item: ActivityItem;
  count: number;
  /** Every event the run holds, newest first, so a caller can find the row an older event landed in. */
  ids: string[];
}

/** What makes two events read the same: who, which record, what happened and the lines shown. */
function activityReadingKey(item: ActivityItem, timeZone: string): string {
  return JSON.stringify([
    item.actor?.id ?? null, item.source, item.entityType, item.entityId, item.action, item.reasonCode,
    item.fromStatus, item.toStatus, item.fromRemote, item.toRemote,
    activityChangeSummary(item), activityFieldLines(item, timeZone),
  ]);
}

/**
 * An update whose every changed field is internal bookkeeping (checksums,
 * upload progress, send reservations) says nothing to an operator, so the feed
 * leaves it out rather than show an empty "updated" row.
 */
export function isEmptyUpdate(item: ActivityItem): boolean {
  if (item.action !== "updated" || activityChangeSummary(item) !== null) return false;
  const fields = [...new Set([...item.changedFields, ...Object.keys(item.changes ?? {})])];
  return fields.length > 0 && fields.every(isHiddenActivityField);
}

/** How many rows the feed draws for these events (after leaving out empty updates and folding repeats). */
export function countActivityRows(items: readonly ActivityItem[], timeZone: string): number {
  return groupActivityByDay(items, timeZone).reduce((total, group) => total + collapseRepeatedActivity(group.items, timeZone).length, 0);
}

/**
 * Folds consecutive events that read the same (same actor, record, action and
 * visible changes) into one run with a count, keeping the newest. Events that
 * are not next to each other stay apart, so the order of history is kept.
 */
export function collapseRepeatedActivity(items: readonly ActivityItem[], timeZone: string): ActivityRun[] {
  const runs: ActivityRun[] = [];
  let lastKey: string | null = null;
  for (const item of items) {
    if (isEmptyUpdate(item)) continue;
    const key = activityReadingKey(item, timeZone);
    const last = runs.at(-1);
    if (last && key === lastKey) {
      last.count += 1;
      last.ids.push(item.id);
    } else runs.push({ item, count: 1, ids: [item.id] });
    lastKey = key;
  }
  return runs;
}

/** Every row the feed draws for these events, in order, across day headings. */
function allRuns(items: readonly ActivityItem[], timeZone: string): ActivityRun[] {
  return groupActivityByDay(items, timeZone).flatMap((group) => collapseRepeatedActivity(group.items, timeZone));
}

export interface ActivityPageLoad {
  /** Rows the page added. */
  addedRows: number;
  /** An existing row's count grew: older repeats joined it. */
  grew: boolean;
  /** The row holding the first newly loaded visible event, or null when the page added none. */
  focusId: string | null;
  /** The last row after loading, for focus when nothing new can take it. */
  lastId: string | null;
}

/** What a "Show older activity" press changed, in rows rather than events. */
export function describePageLoad(before: readonly ActivityItem[], after: readonly ActivityItem[], timeZone: string): ActivityPageLoad {
  const beforeRuns = allRuns(before, timeZone);
  const afterRuns = allRuns(after, timeZone);
  const known = new Set(before.map((item) => item.id));
  const focusRun = afterRuns.find((run) => run.ids.some((id) => !known.has(id)));
  const afterById = new Map(afterRuns.map((run) => [run.item.id, run]));
  const grew = beforeRuns.some((run) => (afterById.get(run.item.id)?.count ?? run.count) > run.count);
  return {
    addedRows: afterRuns.length - beforeRuns.length,
    grew,
    focusId: focusRun?.item.id ?? null,
    lastId: afterRuns.at(-1)?.item.id ?? null,
  };
}
