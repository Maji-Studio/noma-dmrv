/**
 * Internal app routes for certification surfaces. Centralized so the links the
 * requirements/health/selection surfaces share can't drift apart (e.g. the
 * connection-settings deep link, previously hard-coded in three components).
 */

/**
 * `?section=` is how /certification/settings is deep-linked. The page is a
 * category rail plus a detail pane, so only the selected section is mounted —
 * a URL fragment would land on a page that has not rendered the target. These
 * values are the section keys in `certification-settings.tsx`.
 */
export const CERTIFICATION_SETTINGS_SECTION_PARAM = "section";
export const CERTIFICATION_SETTINGS_EMISSIONS_SECTION = "emission-estimates";
export const CERTIFICATION_SETTINGS_SOURCES_SECTION = "sources";
export const CERTIFICATION_SETTINGS_DIAGNOSTICS_SECTION = "diagnostics";
export const CERTIFICATION_SETTINGS_TEMPLATE_MAPPING_SECTION =
  "template-mapping";
/**
 * Keys and the facility's project link are one pane — one is useless without
 * the other. `connection` was the key while they were separate categories;
 * `certification-settings.tsx` still resolves it so older links land here.
 */
export const CERTIFICATION_SETTINGS_CERTIFIER_SECTION = "certifier";
export const CERTIFICATION_SETTINGS_LEGACY_CONNECTION_SECTION = "connection";

function certificationSettingsSectionHref(
  facilityId: string,
  section: string,
): string {
  return (
    `/certification/settings` +
    `?${CERTIFICATION_SETTINGS_SECTION_PARAM}=${encodeURIComponent(section)}` +
    `&facility=${encodeURIComponent(facilityId)}`
  );
}

/**
 * The emission-estimates section — the "Open emission estimates" fix link on
 * the credit-batch health strip. Tier-correct by construction: the blocker that
 * emits it is attributed only to 200-year batches, which is the tier the
 * section is configuration for.
 */
export function certificationEmissionEstimatesHref(facilityId: string): string {
  return certificationSettingsSectionHref(
    facilityId,
    CERTIFICATION_SETTINGS_EMISSIONS_SECTION,
  );
}

/**
 * The facility's certification settings, deep-linked to a section. Defaults to
 * the certifier pane — the target every unmet credential/mapping/template/
 * facility-setup check points at.
 */
export function certificationSettingsHref(
  facilityId: string,
  section: string = CERTIFICATION_SETTINGS_CERTIFIER_SECTION,
): string {
  return certificationSettingsSectionHref(facilityId, section);
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
