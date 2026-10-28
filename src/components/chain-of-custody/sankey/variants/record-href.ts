/**
 * PROTOTYPE: the one place the Sankey variants build record links, so the
 * swap to `recordHref(kind, id, { facilityId })` from `@/lib/record-links`
 * (PR #1482) is a one-file change. Mirrors the list pages' deep-link params.
 */
import type { LineageNodeKind } from "../../chain-constants";

const LIST_ROUTES: Record<LineageNodeKind, string> = {
  feedstock: "/feedstock-intake",
  productionRun: "/production-runs",
  reactor: "/reactors",
  biocharProduct: "/biochar-products",
  order: "/orders",
  delivery: "/deliveries",
  application: "/applications",
};

const DEEP_LINK_PARAMS: Record<LineageNodeKind, string> = {
  feedstock: "feedstock",
  productionRun: "run",
  reactor: "reactor",
  biocharProduct: "biocharProduct",
  order: "order",
  delivery: "delivery",
  application: "application",
};

/** The list page behind a column ("See details"). */
export function recordListHref(kind: LineageNodeKind, facilityId: string | null): string {
  const route = LIST_ROUTES[kind];
  return facilityId ? `${route}?facility=${facilityId}` : route;
}

/** One record, opened in its list page's side sheet. */
export function recordHref(kind: LineageNodeKind, id: string, facilityId: string | null): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(DEEP_LINK_PARAMS[kind], id);
  return `${LIST_ROUTES[kind]}?${params.toString()}`;
}
