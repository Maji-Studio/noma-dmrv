/**
 * Routes of the settings console (`/settings`) and the redirects that keep the
 * retired settings URLs working. Every settings link in the app is built here.
 */

export const SETTINGS_HREF = "/settings";

// You
export const SETTINGS_PROFILE_HREF = "/settings/profile";
export const SETTINGS_CONNECTED_APPS_HREF = "/settings/connected-apps";

// Organization
export const SETTINGS_GENERAL_HREF = "/settings/general";
export const SETTINGS_MEMBERS_HREF = "/settings/members";
export const SETTINGS_DEVELOPERS_HREF = "/settings/developers";

// Certification
export const SETTINGS_REGISTRY_HREF = "/settings/registry";
export const SETTINGS_REMOVAL_TEMPLATES_HREF = "/settings/removal-templates";
export const SETTINGS_FACILITIES_HREF = "/settings/facilities";

// Platform (Platform Admins only)
export { PLATFORM_HOME_HREF as ADMIN_ORGANIZATIONS_HREF } from "@/lib/auth/home-path";
export const SETTINGS_DIAGNOSTICS_HREF = "/settings/diagnostics";
export const SETTINGS_TEMPLATE_MAPPING_HREF = "/settings/template-mapping";

/** Vehicles and crew is a list page under Distribution, not a setting. */
export const VEHICLES_AND_CREW_HREF = "/vehicles-and-crew";

/** The working facility rides along in `?facility=`, as on every sidebar link. */
export const FACILITY_PARAM = "facility";

/** `href` with the working facility appended, keeping any query it already has. */
export function withFacilityParam(href: string, facilityId: string | null | undefined): string {
  if (!facilityId) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${FACILITY_PARAM}=${encodeURIComponent(facilityId)}`;
}

export type SettingsSearchParams = Record<string, string | string[] | undefined>;

/**
 * `target` carrying the incoming query unchanged, for redirects from a retired
 * URL: an old bookmark with `?facility=` keeps its facility.
 */
export function redirectPreservingQuery(target: string, searchParams: SettingsSearchParams = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `${target}?${query}` : target;
}
