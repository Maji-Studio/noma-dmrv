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
 * `context` adds parameters the list reads to pre-fill the form, such as the
 * bin a new product or run goes into.
 */
export function createIntentHref(listPath: string, facilityId: string, context: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    facility: facilityId,
    [CREATE_INTENT_PARAM]: "true",
    ...context,
  });
  return `${listPath}?${params.toString()}`;
}
