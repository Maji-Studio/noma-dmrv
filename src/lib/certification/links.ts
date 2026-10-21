/**
 * Internal app routes for certification surfaces. Centralized so the links the
 * requirements/health/selection surfaces share can't drift apart (e.g. the
 * connection-settings deep link, previously hard-coded in three components).
 */

import {
  SETTINGS_DIAGNOSTICS_HREF,
  SETTINGS_FACILITIES_HREF,
  SETTINGS_REGISTRY_HREF,
  SETTINGS_REMOVAL_TEMPLATES_HREF,
  SETTINGS_TEMPLATE_MAPPING_HREF,
  withFacilityParam,
} from "@/lib/settings/links";

export const OPEN_REMOVAL_TEMPLATES_LINK_LABEL = "Open Removal templates";
/** The link text for template components without a saved decision. */
export const DECIDE_LINES_LINK_LABEL = "Decide components";

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
  { templateId, step = "template" }: { templateId?: string; step?: "template" | "decisions" | "apply" } = {},
): string {
  let href = `${withFacilityParam(SETTINGS_REMOVAL_TEMPLATES_HREF, facilityId)}&${REMOVAL_TEMPLATES_SETUP_PARAM}=${step}`;
  if (templateId) href += `&${REMOVAL_TEMPLATES_TEMPLATE_PARAM}=${encodeURIComponent(templateId)}`;
  return href;
}

/**
 * `/certification/settings` was a rail of `?section=` panes. It folded into
 * the settings console (#1277); this maps every section key it ever had,
 * including the retired `connection` and `credentials`, onto the pane that
 * absorbed it. Unknown or missing keys land on Registry.
 */
const LEGACY_CERTIFICATION_SECTION_ROUTES: Record<string, string> = {
  certifier: SETTINGS_REGISTRY_HREF,
  connection: SETTINGS_REGISTRY_HREF,
  credentials: SETTINGS_REGISTRY_HREF,
  sources: SETTINGS_REGISTRY_HREF,
  "removal-templates": SETTINGS_REMOVAL_TEMPLATES_HREF,
  "emission-estimates": SETTINGS_FACILITIES_HREF,
  diagnostics: SETTINGS_DIAGNOSTICS_HREF,
  "template-mapping": SETTINGS_TEMPLATE_MAPPING_HREF,
};

/** Platform Admin panes; anyone else lands on Registry instead of a 404. */
const PLATFORM_ONLY_LEGACY_ROUTES: ReadonlySet<string> = new Set([
  SETTINGS_DIAGNOSTICS_HREF,
  SETTINGS_TEMPLATE_MAPPING_HREF,
]);

const LEGACY_SECTION_PARAM = "section";
const FORWARDED_LEGACY_PARAMS = [
  "facility",
  REMOVAL_TEMPLATES_TEMPLATE_PARAM,
  REMOVAL_TEMPLATES_SETUP_PARAM,
] as const;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Where an old `/certification/settings?section=` link goes now. The platform
 * sections were open to the viewers who could see them, so for anyone else
 * the link lands on Registry rather than on a 404.
 */
export function legacyCertificationSettingsRedirect(
  searchParams: CertificationSearchParams = {},
  viewer: { isPlatformAdmin: boolean } = { isPlatformAdmin: false },
): string {
  const section = firstValue(searchParams[LEGACY_SECTION_PARAM]);
  const mapped =
    section && Object.hasOwn(LEGACY_CERTIFICATION_SECTION_ROUTES, section)
      ? LEGACY_CERTIFICATION_SECTION_ROUTES[section]
      : SETTINGS_REGISTRY_HREF;
  const target =
    PLATFORM_ONLY_LEGACY_ROUTES.has(mapped) && !viewer.isPlatformAdmin
      ? SETTINGS_REGISTRY_HREF
      : mapped;
  const params = new URLSearchParams();
  for (const key of FORWARDED_LEGACY_PARAMS) {
    const value = firstValue(searchParams[key]);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${target}?${query}` : target;
}

export type CertificationSearchParams = Record<
  string,
  string | string[] | undefined
>;

/**
 * Compatibility target for the retired certification overview route. Preserve
 * incoming query params, including empty strings, so old scoped bookmarks keep
 * the same URLSearchParams semantics as Next.js supplied.
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
  return `/certification/removals${query ? `?${query}` : ""}`;
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
