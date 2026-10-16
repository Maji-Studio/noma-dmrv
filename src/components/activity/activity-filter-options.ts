/**
 * Filter state for the Activity list: which kinds and record types to offer
 * and how a select value maps back to a server filter. Options come from the
 * summary counts, so a filter never offers a choice with nothing behind it.
 */
import type { CreditBatchActivitySummary } from "@/data-access/credit-batch-activity";
import type { ActivityFilters } from "@/lib/activity-filters";
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KIND_ORDER,
  ACTIVITY_RECORD_TYPE_LABELS,
  ACTIVITY_RECORD_TYPE_ORDER,
} from "./activity-display";

/** The select value for "no filter". */
export const ALL_FILTER_VALUE = "";

export interface ActivityFilterOption {
  value: string;
  label: string;
  count: number;
}

type SummaryCounts = CreditBatchActivitySummary["counts"];

function totalsBy<K extends string>(counts: SummaryCounts, key: (row: SummaryCounts[number]) => K): Map<K, number> {
  const totals = new Map<K, number>();
  for (const row of counts) totals.set(key(row), (totals.get(key(row)) ?? 0) + row.count);
  return totals;
}

/** Changes per kind, in reading order, zero kinds left out. */
export function activityKindTotals(counts: SummaryCounts): ActivityFilterOption[] {
  const totals = totalsBy(counts, (row) => row.action);
  return ACTIVITY_KIND_ORDER
    .filter((kind) => (totals.get(kind) ?? 0) > 0)
    .map((kind) => ({ value: kind, label: ACTIVITY_KIND_LABELS[kind], count: totals.get(kind)! }));
}

/**
 * Record types with activity, in custody order. The selected type stays
 * listed even at zero so the select never shows a value it does not offer.
 */
export function activityRecordTypeOptions(counts: SummaryCounts, selected?: ActivityFilters["entityType"]): ActivityFilterOption[] {
  const totals = totalsBy(counts, (row) => row.entityType);
  return ACTIVITY_RECORD_TYPE_ORDER
    .filter((type) => (totals.get(type) ?? 0) > 0 || type === selected)
    .map((type) => ({ value: type, label: ACTIVITY_RECORD_TYPE_LABELS[type], count: totals.get(type) ?? 0 }));
}

/** The kind options, keeping a selected kind that has no changes. */
export function activityKindOptions(counts: SummaryCounts, selected?: ActivityFilters["action"]): ActivityFilterOption[] {
  const options = activityKindTotals(counts);
  if (!selected || options.some((option) => option.value === selected)) return options;
  return ACTIVITY_KIND_ORDER
    .filter((kind) => kind === selected || options.some((option) => option.value === kind))
    .map((kind) => options.find((option) => option.value === kind) ?? { value: kind, label: ACTIVITY_KIND_LABELS[kind], count: 0 });
}

/** A select's value as a server filter; anything unknown means no filter. */
export function parseActivityFilter<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

export function hasActivityFilters(filters: ActivityFilters): boolean {
  return Boolean(filters.action || filters.entityType);
}

/** "Created (3)": the option text a filter select shows. */
export function activityFilterOptionLabel(option: ActivityFilterOption): string {
  return `${option.label} (${option.count.toLocaleString()})`;
}
