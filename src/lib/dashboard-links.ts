/**
 * Shared copy and link helpers for the dashboard read: one plural rule and
 * one facility list link, so station totals, reasons, grouped attention rows
 * and GPS gaps word and link the same way.
 */
import type { DashboardStationKey } from "@/data-access/dashboard-overview";
import { EXACT_ID_FILTER_MAX } from "@/lib/exact-id-filter";

/** Shared nouns for station totals in facility and credit batch scopes. */
export const STATION_COUNT_WORDS: Record<DashboardStationKey, [string, string]> = {
  suppliers: ["supplier", "suppliers"],
  feedstock: ["feedstock", "feedstocks"],
  production: ["run", "runs"],
  products: ["product", "products"],
  deliveries: ["delivery", "deliveries"],
  applications: ["application", "applications"],
};

/** "1 run", "3 runs"; pass the plural for irregular words ("deliveries"). */
export function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? `${singular}s`)}`;
}

/**
 * A facility-scoped list link. `ids` filters a list that takes `?ids=` to
 * those records, while they fit the filter's limit; past it the link opens
 * the plain list rather than one the list would refuse.
 */
export function facilityListHref(path: string, facilityId: string, ids?: readonly string[]): string {
  const params = new URLSearchParams({ facility: facilityId });
  if (ids && ids.length > 0 && ids.length <= EXACT_ID_FILTER_MAX) params.set("ids", ids.join(","));
  return `${path}?${params.toString()}`;
}
