import type { CreditBatchPageTab } from "@/lib/credit-batches/batch-page";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";

/** The list's sheet param and, where one exists, the canonical routed page. */
export const RECORD_LINKS = {
  feedstock: { path: "/feedstock-intake", param: "feedstock" },
  productionRun: { path: "/production-runs", param: "run" },
  biocharProduct: { path: "/biochar-products", param: "biocharProduct" },
  order: { path: "/orders", param: "order" },
  delivery: { path: "/deliveries", param: "delivery" },
  application: { path: "/applications", param: "application" },
  creditBatch: { path: "/credit-batches", param: "batch", routed: true },
  sample: { path: "/lab-samples", param: "sample" },
  removal: { path: "/removals", param: "removal" },
  ghgStatement: { path: "/ghg-statements", param: "statement" },
  supplier: { path: "/suppliers", param: "supplier" },
  customer: { path: "/customers", param: "customer" },
  feedstockType: { path: "/feedstock-types", param: "feedstockType" },
  storageBin: { path: "/storage-bins", param: "bin" },
  reactor: { path: "/reactors", param: "reactor" },
  formulation: { path: "/formulations", param: "formulation" },
  // The facility param doubles as the working facility, so a record link also switches it.
  facility: { path: "/facilities", param: "facility" },
  vehicle: { path: "/vehicles", param: "vehicle" },
  driver: { path: "/crew", param: "driver" },
  operator: { path: "/crew", param: "operator" },
} as const;

export type RecordKind = keyof typeof RECORD_LINKS;
type RecordLinkBuilderOptions = {
  facilityId?: string | null;
  mode?: "edit";
  focus?: string;
  preview?: boolean;
  tab?: CreditBatchPageTab;
  locationId?: string | null;
};
export type RecordLinkOptions<K extends RecordKind> = {
  facilityId?: string | null;
  mode?: "edit";
} & (K extends "creditBatch"
  ? { preview?: boolean; tab?: CreditBatchPageTab; focus?: string }
  : { focus?: EntityFocusTarget }) &
  (K extends "supplier" | "customer" ? { locationId?: string | null } : object);

/** Facility always comes first. Routed records opt into their list sheet with preview. */
export function recordHref<K extends RecordKind>(
  kind: K,
  id: string,
  options?: RecordLinkOptions<K>,
): string;
export function recordHref(
  kind: RecordKind,
  id: string,
  options: RecordLinkBuilderOptions = {},
): string {
  const link = RECORD_LINKS[kind];
  const params = new URLSearchParams();
  if (options.facilityId) params.set("facility", options.facilityId);
  const routed = "routed" in link && link.routed && !options.preview;
  const path = routed ? `${link.path}/${encodeURIComponent(id)}` : link.path;
  if (!routed) params.set(link.param, id);
  if (options.tab && options.tab !== "overview") params.set("tab", options.tab);
  if (options.mode) params.set("mode", options.mode);
  if (options.focus) params.set("focus", options.focus);
  if (options.locationId) params.set("location", options.locationId);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

// Aliases kept for existing query readers; the table owns their values.
export const APPLICATION_DEEP_LINK_PARAM = RECORD_LINKS.application.param;
export const BIOCHAR_PRODUCT_DEEP_LINK_PARAM = RECORD_LINKS.biocharProduct.param;
export const CREDIT_BATCH_DEEP_LINK_PARAM = RECORD_LINKS.creditBatch.param;
export const CREDIT_BATCH_TAB_PARAM = "tab";
export const CUSTOMER_DEEP_LINK_PARAM = RECORD_LINKS.customer.param;
export const DELIVERY_DEEP_LINK_PARAM = RECORD_LINKS.delivery.param;
export const FEEDSTOCK_DEEP_LINK_PARAM = RECORD_LINKS.feedstock.param;
export const GHG_STATEMENT_DEEP_LINK_PARAM = RECORD_LINKS.ghgStatement.param;
export const ORDER_DEEP_LINK_PARAM = RECORD_LINKS.order.param;
