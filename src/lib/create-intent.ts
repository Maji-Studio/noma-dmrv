export const CREATE_INTENT_PARAM = "create";

export function isCreateIntentValue(
  value: string | string[] | null | undefined,
): boolean {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved === "true" || resolved === "1";
}
