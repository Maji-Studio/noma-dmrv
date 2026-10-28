/**
 * Internal app routes for certification surfaces. Centralized so the links the
 * requirements/health/selection surfaces share can't drift apart (e.g. the
 * connection-settings deep link, previously hard-coded in three components).
 */

import {
  SETTINGS_FACILITIES_HREF,
  SETTINGS_REGISTRY_HREF,
  SETTINGS_REMOVAL_TEMPLATES_HREF,
  withFacilityParam,
} from "@/lib/settings/links";

export const OPEN_REMOVAL_TEMPLATES_LINK_LABEL = "Open Removal templates";
/** The link text for template components without a saved decision. */
export const DECIDE_LINES_LINK_LABEL = "Answer in Settings";

/** Narrows the Removal templates pane to one template, even one not yet in use. */
export const REMOVAL_TEMPLATES_TEMPLATE_PARAM = "template";
/** Opens the Removal template setup dialog on the Removal templates pane; its value is the starting step. */
export const REMOVAL_TEMPLATES_SETUP_PARAM = "setup";

/**
 * Settings, Registry: which registry, its organization-wide keys, Source
 * visibility. Where every unmet credential check points.
 */
export function registrySettingsHref(facilityId?: string | null): string {
  return withFacilityParam(SETTINGS_REGISTRY_HREF, facilityId);
}

/**
 * Settings, Facilities for one facility: its registry project link, durability
 * tier and soil reference temperature. Every unmet project-link, default
 * template and soil-reference check points here. The route answers with the
 * Registry pane while the organization has no keys saved, because nothing on
 * the facility pane works before that.
 */
export function facilityCertificationSettingsHref(facilityId: string): string {
  return withFacilityParam(SETTINGS_FACILITIES_HREF, facilityId);
}

/**
 * The Removal template component review, where components to decide are settled.
 * With `templateId` the pane also shows that template's lines when no facility
 * default or credit batch uses it yet.
 */
export function removalTemplatesSettingsHref(
  facilityId: string,
  templateId?: string,
): string {
  const href = withFacilityParam(SETTINGS_REMOVAL_TEMPLATES_HREF, facilityId);
  return templateId
    ? `${href}&${REMOVAL_TEMPLATES_TEMPLATE_PARAM}=${encodeURIComponent(templateId)}`
    : href;
}

/**
 * The Removal templates pane with the setup dialog open. The step defaults to
 * the template list; `templateId` preselects a template.
 */
export function removalTemplateSetupHref(
  facilityId: string,
  { templateId, step = "template" }: { templateId?: string; step?: "template" | "check" } = {},
): string {
  let href = `${withFacilityParam(SETTINGS_REMOVAL_TEMPLATES_HREF, facilityId)}&${REMOVAL_TEMPLATES_SETUP_PARAM}=${step}`;
  if (templateId) href += `&${REMOVAL_TEMPLATES_TEMPLATE_PARAM}=${encodeURIComponent(templateId)}`;
  return href;
}

export type CertificationSearchParams = Record<
  string,
  string | string[] | undefined
>;

/**
 * Removals list and sheet links. Preserve query params, including repeated
 * values and empty strings, with the same semantics as Next.js search params.
 */
export function certificationRemovalsHref(
  searchParams: CertificationSearchParams = {},
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return `/removals${query ? `?${query}` : ""}`;
}

export function productionRunDeepLinkHref(
  productionRunId: string,
  facilityId: string,
): string {
  const params = new URLSearchParams({
    facility: facilityId,
    run: productionRunId,
  });
  return `/production-runs?${params.toString()}`;
}

export function traceabilityApplicationHref(
  creditBatchId: string,
  applicationId: string,
): string {
  const params = new URLSearchParams({
    batch: creditBatchId,
    application: applicationId,
  });
  return `/traceability?${params.toString()}`;
}

/** A credit batch on the Traceability page, in its default view. */
export function traceabilityBatchHref(
  creditBatchId: string,
  facilityId: string,
): string {
  const params = new URLSearchParams({ facility: facilityId, batch: creditBatchId });
  return `/traceability?${params.toString()}`;
}

/** The Traceability view value of the batch Activity segment. */
export const TRACEABILITY_ACTIVITY_VIEW = "activity";

/** A credit batch's Activity segment on the Traceability page. */
export function traceabilityActivityHref(
  creditBatchId: string,
  facilityId: string,
): string {
  const params = new URLSearchParams({
    facility: facilityId,
    batch: creditBatchId,
    view: TRACEABILITY_ACTIVITY_VIEW,
  });
  return `/traceability?${params.toString()}`;
}
