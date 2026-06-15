/**
 * Internal app routes for certification surfaces. Centralized so the links the
 * requirements/health/selection surfaces share can't drift apart (e.g. the
 * connection-settings deep link, previously hard-coded in three components).
 */

/**
 * The facility's certification settings page, deep-linked to a tab. Defaults to
 * the "connection" (registry mapping) tab — the target every unmet
 * mapping/template/facility-setup check points at.
 */
export function certificationSettingsHref(
  facilityId: string,
  tab: string = "connection",
): string {
  return `/certification/settings?tab=${encodeURIComponent(
    tab,
  )}&facility=${encodeURIComponent(facilityId)}`;
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
