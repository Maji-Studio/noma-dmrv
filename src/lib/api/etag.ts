import { ApiHttpError } from "./http-error";

// Encode the parser's safe-integer bound in the published string pattern too.
const maxInteger = String(Number.MAX_SAFE_INTEGER);
const smallerPrefixes = [...maxInteger].flatMap((digit, index) => {
  const minimum = index === 0 ? 1 : 0;
  const maximum = Number(digit) - 1;
  if (maximum < minimum) return [];
  const range = maximum === minimum ? String(minimum) : `[${minimum}-${maximum}]`;
  const remaining = maxInteger.length - index - 1;
  return [`${maxInteger.slice(0, index)}${range}\\d{${remaining}}`];
});
const positiveSafeInteger = `(?:[1-9]\\d{0,${maxInteger.length - 2}}|${smallerPrefixes.join("|")}|${maxInteger})`;
export const STRONG_ETAG_PATTERN = new RegExp(`^"(${positiveSafeInteger})\\.(${positiveSafeInteger})"$`);

export function representationEtag(version: number, revision: number): string {
  return `"${version}.${revision}"`;
}

export function parseIfMatch(value: string | null): { version: number; revision: number } {
  if (value === null) throw new ApiHttpError(428, "precondition_required", "Send the resource ETag in If-Match.");
  if (value === "*" || value.startsWith("W/")) {
    throw new ApiHttpError(428, "strong_etag_required", "Send one strong resource ETag in If-Match.");
  }
  const match = STRONG_ETAG_PATTERN.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) {
    throw new ApiHttpError(400, "invalid_etag", "Send one valid resource ETag in If-Match.");
  }
  return { version: Number(match[1]), revision: Number(match[2]) };
}
