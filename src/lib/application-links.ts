/**
 * Deep link to an application's view side sheet on the application list,
 * which reads `?application=` and opens the sheet (`application-list.tsx`).
 */

export const APPLICATION_DEEP_LINK_PARAM = "application";

export function applicationDeepLinkHref(applicationId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(APPLICATION_DEEP_LINK_PARAM, applicationId);
  return `/applications?${params.toString()}`;
}
