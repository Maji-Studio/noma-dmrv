export const CREATE_INTENT_PARAM = "create";

export function isCreateIntentValue(
  value: string | string[] | null | undefined,
): boolean {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved === "true" || resolved === "1";
}

/**
 * Link to a list page that opens its create sheet on arrival, scoped to one
 * facility (`?facility=` picks the facility, as the sidebar links do).
 */
export function createIntentHref(listPath: string, facilityId: string): string {
  const params = new URLSearchParams({
    facility: facilityId,
    [CREATE_INTENT_PARAM]: "true",
  });
  return `${listPath}?${params.toString()}`;
}
