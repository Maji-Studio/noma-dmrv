import { getDocumentById } from "@/data-access/documents";
import type { GhgStatementReportRow } from "@/data-access/ghg-statement-reports";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError, type DomainErrorCode } from "@/lib/domain-errors";
import { logger } from "@/lib/log";
import { getStorageProvider, isSafeStorageKey, StorageError } from "@/lib/storage";
import { STORAGE_GET_OBJECT_TIMEOUT_MS } from "@/lib/storage/get-object";
import { ghgStatementReportKeyPrefix } from "@/lib/storage/keys";
import { PDF_MIME_TYPE, type InspectedObject } from "@/lib/storage/types";

const READ_SIZE_MARGIN_BYTES = 1;
const CHECK_LABELS = {
  "document record": "stored file",
  "document ownership": "stored file",
  "upload status": "stored file",
  key: "storage key",
  "stored object read": "stored file",
  "MIME type": "file type",
  "byte size": "file size",
  "SHA-256": "report checksum",
  provider: "storage provider",
  bucket: "storage bucket",
} as const;

function classifyReadError(cause: unknown): DomainErrorCode {
  if (cause instanceof StorageError) {
    switch (cause.code) {
      case "storage_misconfigured":
        return "storage_not_configured";
      case "object_access_denied":
      case "object_too_large":
        return "report_verification_failed";
      case "storage_unavailable":
      default:
        return "storage_unavailable";
    }
  }
  return "storage_unavailable";
}

export async function verifyStoredGhgStatementReport(
  orgCtx: OrgContext,
  report: GhgStatementReportRow,
): Promise<void> {
  const failure = (
    check: keyof typeof CHECK_LABELS,
    cause?: unknown,
    code: DomainErrorCode = "report_verification_failed",
  ) => {
    logger.warn({
      reportId: report.id,
      documentId: report.documentId,
      check,
      storageErrorCode: cause instanceof Error && "code" in cause && typeof cause.code === "string"
        ? cause.code : cause instanceof Error ? cause.name : null,
    }, "Stored GHG Statement report check failed");
    const subject = `Version ${report.version} of the GHG Statement report`;
    const message = code === "storage_unavailable"
      ? `${subject} could not be checked because storage is unavailable. Try again.`
      : code === "storage_not_configured"
        ? `${subject} could not be checked because storage is not configured. Contact a Platform Admin to configure storage.`
        : `${subject} failed the ${CHECK_LABELS[check]} check. Generate and approve a new report.`;
    return new DomainError(code, message, { retryable: code === "storage_unavailable", cause });
  };
  const document = await getDocumentById(orgCtx, report.documentId);
  if (!document) throw failure("document record");
  if (
    report.organizationId !== orgCtx.organizationId ||
    document.entityType !== "ghgStatementReport" ||
    document.entityId !== report.id
  ) throw failure("document ownership");
  if (document.uploadStatus !== "uploaded") throw failure("upload status");

  let storage: ReturnType<typeof getStorageProvider>;
  try {
    storage = getStorageProvider();
  } catch (cause) {
    throw failure("provider", cause, "storage_not_configured");
  }
  if (document.storageProvider !== storage.name) throw failure("provider");
  if (document.storageBucket !== storage.bucket) throw failure("bucket");

  // The adapter returns bytes and MIME, not a second key. Bind the saved key
  // to this report's namespace and read that exact logical key (no URL fallback).
  const key = document.storageKey;
  const prefix = ghgStatementReportKeyPrefix(orgCtx.organizationId, report.id);
  if (
    !key || !isSafeStorageKey(key) || !key.startsWith(prefix) ||
    !key.slice(prefix.length) || key.slice(prefix.length).includes("/")
  ) throw failure("key");

  if (document.fileSizeBytes === null || !Number.isSafeInteger(document.fileSizeBytes) || document.fileSizeBytes < 0) {
    throw failure("byte size");
  }
  let object: InspectedObject | null;
  try {
    object = await storage.readObjectBounded({
      key,
      maxBytes: document.fileSizeBytes + READ_SIZE_MARGIN_BYTES,
      signal: AbortSignal.timeout(STORAGE_GET_OBJECT_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === "object_too_large") {
      throw failure("byte size", cause);
    }
    throw failure("stored object read", cause, classifyReadError(cause));
  }
  if (!object) throw failure("stored object read");
  if (document.mimeType !== PDF_MIME_TYPE || object.contentType !== document.mimeType) {
    throw failure("MIME type");
  }
  if (object.bytes.byteLength !== document.fileSizeBytes) throw failure("byte size");
  const checksum = object.sha256;
  if (checksum !== document.checksumSha256 || checksum !== report.contentChecksumSha256) {
    throw failure("SHA-256");
  }
}
