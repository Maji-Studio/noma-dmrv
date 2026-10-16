import { StorageError } from "./types";

const CONFIGURATION_ERRORS = new Set([
  "InvalidAccessKeyId", "NoSuchBucket", "SignatureDoesNotMatch",
  "CredentialsProviderError", "ExpiredToken", "InvalidToken", "EACCES", "EPERM",
]);
const MISSING_OBJECT_ERRORS = new Set(["NoSuchKey", "NotFound"]);
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;

/** Normalize only bounded reads; other provider operations keep their contracts. */
export function boundedReadError(cause: unknown, provider: "s3" | "local-fs"): StorageError {
  if (cause instanceof StorageError) return cause;
  const error = cause && typeof cause === "object"
    ? cause as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } }
    : {};
  const identifiers = [error.code ?? "", error.name ?? ""];
  if (identifiers.some((id) => CONFIGURATION_ERRORS.has(id))) {
    return new StorageError("Storage is not configured", "storage_misconfigured");
  }
  if (provider === "s3") {
    if (identifiers.some((id) => MISSING_OBJECT_ERRORS.has(id)) || error.$metadata?.httpStatusCode === HTTP_NOT_FOUND) {
      return new StorageError("Stored object not found", "object_not_found");
    }
    // Without ListBucket, S3 can deny a read of a key that was never written.
    if (identifiers.includes("AccessDenied") || error.$metadata?.httpStatusCode === HTTP_FORBIDDEN) {
      return new StorageError("Stored object access denied", "object_access_denied");
    }
  } else if (error.code === "ENOENT") {
    return new StorageError("Stored object not found", "object_not_found");
  }
  // Includes timeouts, aborts, network/stream failures, 5xx and unknown errors.
  return new StorageError("Storage read unavailable", "storage_unavailable");
}
