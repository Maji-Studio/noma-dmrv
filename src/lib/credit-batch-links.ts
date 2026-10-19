import {
  ENTITY_DEEP_LINK_FOCUS_PARAM,
  ENTITY_FOCUS_TARGETS,
} from "@/lib/entity-deep-link";
import type { CreditBatchPageTab } from "@/lib/credit-batches/batch-page";

/**
 * Links to a credit batch. Its canonical URL is the routed page
 * `/credit-batches/<id>?tab=`; the list's side sheet is a preview opened by
 * `?batch=<id>` on `/credit-batches`.
 */

/** The list's preview sheet param (`/credit-batches?batch=<id>`). */
export const CREDIT_BATCH_DEEP_LINK_PARAM = "batch";
/** The page's tab param. Overview is the default and stays out of the URL. */
export const CREDIT_BATCH_TAB_PARAM = "tab";

export interface CreditBatchPageLinkOptions {
  tab?: CreditBatchPageTab;
  /** A row on that tab, or a shared entity focus target. */
  focus?: string;
}

export function creditBatchDeepLinkHref(
  creditBatchId: string,
  facilityId?: string,
  options: CreditBatchPageLinkOptions = {},
): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  if (options.tab && options.tab !== "overview") params.set(CREDIT_BATCH_TAB_PARAM, options.tab);
  if (options.focus) params.set(ENTITY_DEEP_LINK_FOCUS_PARAM, options.focus);
  const query = params.toString();
  return `/credit-batches/${encodeURIComponent(creditBatchId)}${query ? `?${query}` : ""}`;
}

/** The list with the batch's preview sheet open. */
export function creditBatchPreviewHref(creditBatchId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(CREDIT_BATCH_DEEP_LINK_PARAM, creditBatchId);
  return `/credit-batches?${params.toString()}`;
}

/** Opens the batch page on its Removal template, where it can be switched. */
export function creditBatchRemovalTemplateHref(
  creditBatchId: string,
  facilityId: string,
): string {
  return creditBatchDeepLinkHref(creditBatchId, facilityId, {
    focus: ENTITY_FOCUS_TARGETS.removalTemplate,
  });
}
