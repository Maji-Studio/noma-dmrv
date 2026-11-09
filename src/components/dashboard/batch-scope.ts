/**
 * The credit batch scope as a pure function. `DashboardBatchScopeView` is the
 * shape one batch (or all of them) contributes: the batch ids, each stage's
 * record count, the four KPI figures and the ids of every record in the
 * batches' roll-ups (and the Removals holding them). `applyBatchScope`
 * narrows the facility overview to it: the stage counts and labels, the KPIs
 * with hints that name the scope, only the To do rows that represent its records,
 * its scoped activity, and each stage's open-items bubble. Grouped rows keep
 * their in-scope records; structural gaps are facility setup and stay out
 * (Kenji, Q13: To do follows the filter).
 */
import type {
  DashboardAttentionItem,
  DashboardKpi,
  DashboardOverview,
} from "@/data-access/dashboard-overview";
import type { DashboardBatchScope } from "@/data-access/dashboard-batch-scope";
import { plural, STATION_COUNT_WORDS } from "@/lib/dashboard-links";

/** The server read's shape (`getDashboardBatchScope`). */
export type DashboardBatchScopeView = DashboardBatchScope;

/** The list filter param grouped rows link with (`facilityListHref`). */
const IDS_PARAM = "ids";

/** Removals and credit batches: their reasons belong to no stage, so they count on Production. */
const BATCH_REASON_PATHS = ["/credit-batches", "/removals"];

function batchKpiHints(subject: string): Record<DashboardKpi["key"], string> {
  return {
    feedstockProcessed: `Dry feedstock mass into ${subject} production runs.`,
    biocharProduced: `Dry biochar mass out of ${subject} production runs.`,
    appliedToSoil: `Dry mass of ${subject} biochar applied to soil.`,
    co2eStored: `Carbon stored in ${subject} biochar, before project emissions are subtracted.`,
  };
}

/** A grouped row's list link (`?ids=`) narrowed to the in-scope records, so its count and its list agree. */
function withScopedIds(href: string, ids: readonly string[]): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  if (!params.has(IDS_PARAM)) return href;
  params.set(IDS_PARAM, ids.join(","));
  return `${path}?${params.toString().replaceAll("%2C", ",")}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function pathOf(href: string): string {
  return href.split("?")[0] ?? href;
}

function scopedKpis(base: DashboardKpi[], scope: DashboardBatchScopeView): DashboardKpi[] {
  // The possessive, so the hints read "this credit batch's" and "the credit batches'".
  const subject = scope.batchIds.length === 1 ? "this credit batch's" : "the credit batches'";
  const hints = batchKpiHints(subject);
  const values: Record<DashboardKpi["key"], number | null> = {
    feedstockProcessed: scope.kpis.feedstockProcessedDryTonnes,
    biocharProduced: scope.kpis.biocharProducedDryTonnes,
    appliedToSoil: scope.kpis.appliedToSoilDryTonnes,
    co2eStored: scope.kpis.co2eStoredTonnes,
  };
  // The band shows no detail line, so `detail` stays empty.
  return base.map((kpi) => ({ ...kpi, hint: hints[kpi.key], value: values[kpi.key], deltaPercent: null, detail: "" }));
}

export function applyBatchScope(overview: DashboardOverview, scope: DashboardBatchScopeView): DashboardOverview {
  const recordIds = scope.recordIds;
  const inScope = (href: string) => recordIds.some((id) => href.includes(id));
  const scopedIds = new Set(recordIds);
  const attention = overview.attention.flatMap((item): DashboardAttentionItem[] => {
    if (item.count == null) return inScope(item.href) ? [item] : [];
    const ids = item.recordIds?.filter((id) => scopedIds.has(id)) ?? [];
    if (ids.length === 0) return [];
    const recordItems = item.recordItems?.filter((record) => record.recordIds?.some((id) => scopedIds.has(id)));
    const single = ids.length === 1 ? recordItems?.find((record) => record.recordIds?.includes(ids[0])) : undefined;
    if (single) return [single];
    return [{ ...item, href: withScopedIds(item.href, ids), recordIds: ids, ...(recordItems ? { recordItems } : {}), count: ids.length }];
  });
  const stations = overview.stations.map((station) => {
    const listPath = pathOf(station.href);
    const own = attention.filter(
      (item) =>
        pathOf(item.href) === listPath ||
        (station.key === "production" && BATCH_REASON_PATHS.some((path) => pathOf(item.href).startsWith(path))),
    );
    const reasons = own.map((item) => ({
      state: "warning" as const,
      // A grouped row says how many, as To do does ("Production runs: 3 affected, missing mass data").
      text: item.count == null ? `${item.entityCode}: ${item.title}` : `${item.entityCode}: ${item.count} affected, ${lowerFirst(item.title)}`,
      href: item.href,
    }));
    const total = scope.stationTotals[station.key];
    const [one, many] = STATION_COUNT_WORDS[station.key];
    // The bubble counts records, so a grouped row adds its count.
    const openRecords = own.reduce((sum, item) => sum + (item.count ?? 1), 0);
    return { ...station, total, totalLabel: plural(total, one, many), attention: openRecords, reasons };
  });
  return {
    ...overview,
    stations,
    kpis: scopedKpis(overview.kpis, scope),
    attention,
    structuralGaps: [],
    attentionTotal: attention.length,
    activity: scope.activity,
  };
}
