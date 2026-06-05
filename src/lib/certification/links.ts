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
  return `/certification/settings?tab=${tab}&facility=${facilityId}`;
}
