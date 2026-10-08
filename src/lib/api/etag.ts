import { ApiHttpError } from "./http-error";

export function representationEtag(version: number, revision: number): string {
  return `"${version}.${revision}"`;
}

export function parseIfMatch(value: string | null): { version: number; revision: number } {
  if (value === null) throw new ApiHttpError(428, "precondition_required", "Send the resource ETag in If-Match.");
  if (value === "*" || value.startsWith("W/")) {
    throw new ApiHttpError(428, "strong_etag_required", "Send one strong resource ETag in If-Match.");
  }
  const match = /^"([1-9]\d*)\.([1-9]\d*)"$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) {
    throw new ApiHttpError(400, "invalid_etag", "Send one valid resource ETag in If-Match.");
  }
  return { version: Number(match[1]), revision: Number(match[2]) };
}
