/**
 * Phase 3.5 — Source blob transfer + request-body helpers.
 *
 * Extracted from `sources.ts` to keep that file under the 1000-line limit and
 * to isolate the SSRF-sensitive transfer surface. Pure server-side helpers:
 * build the CreateDocumentSource request body, download the noma-managed
 * bytes, and PUT them to Isometric's presigned URL behind a host allowlist.
 * No exported server actions live here.
 */
import type { DocumentRow } from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import type { CreateDocumentSourceRequest } from "@/lib/isometric";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import {
  assertUploadHostAllowed,
  fetchSignedUploadWithTimeout,
} from "@/lib/isometric/utils/signed-upload";
import { getStorageProvider } from "@/lib/storage";
import { StorageError } from "@/lib/storage/types";

const SOURCE_READ_ERROR =
  "The supporting document could not be read. Upload the file again and retry the submission.";
const SOURCE_READ_TIMEOUT_ERROR =
  "The file transfer timed out. Check your connection and try again.";

export function buildSourceRequestBody(args: {
  externalProjectId: string;
  document: DocumentRow;
  supplierRefId: string;
  isPublic: boolean;
  sourceDescription: string;
}): CreateDocumentSourceRequest {
  const {
    externalProjectId,
    document,
    supplierRefId,
    isPublic,
    sourceDescription,
  } = args;
  // Isometric requires non-null content_length / content_type / file_name. The
  // pre-flight check enforces this; the `!` here is post-validation.
  const contentLength = document.fileSizeBytes!;
  const contentType = document.mimeType!;
  const publishedAt = (document.capturedAt ?? document.createdAt)
    .toISOString()
    .slice(0, 10);
  return {
    __typename: "CreateDocumentSourceRequest",
    content_length: contentLength,
    content_type: contentType,
    description: sourceDescription,
    display_name: document.fileName,
    file_name: document.fileName,
    is_public: isPublic,
    project_id: externalProjectId,
    published_at: publishedAt,
    supplier_reference_id: supplierRefId,
  };
}

export async function downloadDocumentBlob(
  document: DocumentRow,
): Promise<{ blob: Blob; contentType: string }> {
  if (!document.storageKey) {
    throw new SafeError(
      "This document has no managed storage (legacy URL-only). Re-upload it through noma before sending it to Isometric.",
    );
  }
  const provider = getStorageProvider();
  try {
    const object = await provider.getObject({ key: document.storageKey });
    // The Isometric upload URL is signed for the MIME type declared when the
    // Source was created, not whichever type the storage GET happens to emit.
    const contentType = document.mimeType ?? object.contentType;
    return {
      blob: new Blob([new Uint8Array(object.bytes)], {
        type: contentType,
      }),
      contentType,
    };
  } catch (error) {
    logger.error(
      {
        documentId: document.id,
        errorCode: error instanceof StorageError ? error.code : undefined,
        errorMessage: sanitizeErrorMessage(error),
      },
      "Failed to read supporting document from storage",
    );
    if (
      error instanceof StorageError &&
      error.code === "get_object_timeout"
    ) {
      throw new SafeError(SOURCE_READ_TIMEOUT_ERROR);
    }
    throw new SafeError(SOURCE_READ_ERROR);
  }
}

export async function putBlobToSignedUrl(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  assertUploadHostAllowed(uploadUrl);
  const response = await fetchSignedUploadWithTimeout(uploadUrl, {
    method: "PUT",
    body: blob,
    redirect: "error",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
    },
  });
  if (!response.ok) {
    // Do NOT echo the response body — third-party storage gateways can
    // include request fragments in error pages and this message lands in
    // certifier_sync_events. Status code alone is enough to diagnose;
    // detailed body inspection belongs in non-persistent debug logs only.
    throw new SafeError(
      `Isometric did not accept the file (status ${response.status}). Try again.`,
    );
  }
}
