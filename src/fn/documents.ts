"use server";

import { BYTES_PER_MB } from "@/lib/format-utils";
import { SafeError } from "@/lib/errors";
import { getStorageProvider, buildStorageKey } from "@/lib/storage";
import {
  confirmUploadSchema,
  deleteDocumentSchema,
  isAllowedMime,
  maxBytesFor,
  requestUploadSchema,
  setVisibilitySchema,
  type DocumentType,
} from "@/schemas/documents";
import {
  deleteDocumentRow,
  getDocumentById,
  insertDocument,
  listDocumentsForEntity,
  updateDocument,
  type DocumentRow,
} from "@/data-access/documents";
import { getDocumentUploadByDocument } from "@/data-access/certifier-document-uploads";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export interface RequestUploadResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
  storageKey: string;
  metadata: Record<string, unknown>;
}

function buildDocumentMetadata(input: {
  documentType: DocumentType;
  capturedAt?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}): Record<string, unknown> {
  if (input.documentType !== "photo" && input.documentType !== "video") {
    return {};
  }

  const missingExif: string[] = [];
  if (!input.capturedAt) missingExif.push("timestamp");
  if (input.gpsLatitude == null || input.gpsLongitude == null) {
    missingExif.push("gps");
  }

  return {
    // Certification readiness uses this generated metadata to identify
    // application photos that carry both timestamp and GPS EXIF.
    geotagStatus: missingExif.length === 0 ? "present" : "missing",
    missingExif,
    exif: {
      capturedAt: input.capturedAt ?? null,
      gps:
        input.gpsLatitude != null && input.gpsLongitude != null
          ? { latitude: input.gpsLatitude, longitude: input.gpsLongitude }
          : null,
    },
  };
}

export async function requestUpload(
  input: unknown
): Promise<ActionResult<RequestUploadResult>> {
  return withAction(async (userId) => {
    // Preserve historical "join all issues with ', '" formatting by parsing
    // explicitly and re-throwing as SafeError — withAction's default ZodError
    // path prefixes with "Validation error:" which would change the user-facing
    // copy here.
    const parsed = requestUploadSchema.safeParse(input);
    if (!parsed.success) {
      throw new SafeError(
        parsed.error.issues.map((i) => i.message).join(", ")
      );
    }

    const docType = parsed.data.documentType as DocumentType;
    if (!isAllowedMime(docType, parsed.data.contentType)) {
      throw new SafeError(
        `Content type ${parsed.data.contentType} not allowed for ${docType}`
      );
    }
    const cap = maxBytesFor(docType);
    if (parsed.data.sizeBytes > cap) {
      throw new SafeError(
        `File exceeds ${Math.round(cap / BYTES_PER_MB)} MB limit for ${docType}`
      );
    }

    const provider = getStorageProvider();
    const storageKey = buildStorageKey({
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      documentType: docType,
      fileName: parsed.data.fileName,
    });

    const presign = await provider.createUploadUrl({
      key: storageKey,
      contentType: parsed.data.contentType,
      maxBytes: cap,
    });

    const metadata = buildDocumentMetadata({
      documentType: docType,
      capturedAt: parsed.data.capturedAt,
      gpsLatitude: parsed.data.gpsLatitude,
      gpsLongitude: parsed.data.gpsLongitude,
    });

    const row = await insertDocument(userId, {
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      documentType: docType,
      storageProvider: provider.name,
      storageBucket: provider.bucket,
      storageKey,
      fileName: parsed.data.fileName,
      fileSizeBytes: parsed.data.sizeBytes,
      mimeType: parsed.data.contentType,
      uploadStatus: "pending",
      visibility: "private",
      capturedAt: parsed.data.capturedAt
        ? new Date(parsed.data.capturedAt)
        : null,
      description: parsed.data.description ?? null,
      metadata,
      createdBy: userId,
    });

    return {
      documentId: row.id,
      uploadUrl: presign.url,
      headers: presign.headers,
      expiresAt: presign.expiresAt.toISOString(),
      storageKey,
      metadata,
    };
  });
}

export async function confirmUpload(
  input: unknown
): Promise<ActionResult<DocumentRow>> {
  return withAction(async (userId) => {
    const { documentId } = confirmUploadSchema.parse(input);

    const row = await getDocumentById(userId, documentId);
    if (!row) throw new SafeError("Document not found");
    if (!row.storageKey) throw new SafeError("Document has no storage key");
    if (row.uploadStatus !== "pending") {
      throw new SafeError(`Document already in '${row.uploadStatus}' state`);
    }

    const provider = getStorageProvider();
    const head = await provider.headObject(row.storageKey);
    if (!head) {
      await updateDocument(userId, row.id, { uploadStatus: "failed" });
      throw new SafeError("Uploaded object not found in storage");
    }

    const docType = row.documentType as DocumentType;
    const cap = maxBytesFor(docType);
    if (head.size > cap) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(userId, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError(
        `Object size ${head.size} exceeds ${cap}-byte cap for ${docType}`
      );
    }
    if (!isAllowedMime(docType, head.contentType)) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(userId, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError(
        `Object content-type ${head.contentType} not allowed for ${docType}`
      );
    }

    const updated = await updateDocument(userId, row.id, {
      uploadStatus: "uploaded",
      fileSizeBytes: head.size,
      mimeType: head.contentType,
    });
    if (!updated) throw new SafeError("Failed to mark document uploaded");
    return updated;
  });
}

export async function setDocumentVisibility(
  input: unknown
): Promise<ActionResult<DocumentRow>> {
  return withAction(async (userId) => {
    const data = setVisibilitySchema.parse(input);

    const updated = await updateDocument(userId, data.documentId, {
      visibility: data.visibility,
    });
    if (!updated) throw new SafeError("Document not found");
    return updated;
  });
}

export async function deleteDocument(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  return withAction(async (userId) => {
    const { documentId } = deleteDocumentSchema.parse(input);

    const row = await getDocumentById(userId, documentId);
    if (!row) throw new SafeError("Document not found");

    // Fast user-facing path; the FK-backed delete below remains the real race
    // guard in case a mirror appears after this check.
    const isometricMirror = await getDocumentUploadByDocument(
      userId,
      ISOMETRIC_PROVIDER,
      row.id,
    );
    if (isometricMirror) {
      throw new SafeError(
        "This document is mirrored to Isometric as a Source. Unlink it from the Removal's Sources panel before deleting.",
      );
    }

    let deleted: DocumentRow | null;
    try {
      deleted = await deleteDocumentRow(userId, row.id);
    } catch (err) {
      const mirror = await getDocumentUploadByDocument(
        userId,
        ISOMETRIC_PROVIDER,
        row.id,
      );
      if (mirror) {
        throw new SafeError(
          "This document is mirrored to Isometric as a Source. Unlink it from the Removal's Sources panel before deleting.",
        );
      }
      throw err;
    }
    if (!deleted) throw new SafeError("Document not found");

    if (row.storageKey) {
      const provider = getStorageProvider();
      try {
        await provider.deleteObject(row.storageKey);
      } catch (err) {
        console.error("Failed to delete storage object", {
          documentId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        let restored = false;
        try {
          await insertDocument(userId, deleted);
          restored = true;
        } catch (restoreErr) {
          console.error("Failed to restore document row after storage error", {
            documentId: row.id,
            error:
              restoreErr instanceof Error
                ? restoreErr.message
                : String(restoreErr),
          });
        }
        throw new SafeError(
          restored
            ? "Failed to delete storage object. The document row was restored; try again."
            : "Failed to delete storage object and restore the document row. Contact support before retrying.",
        );
      }
    }

    return { id: row.id };
  });
}

export async function getDocumentsForEntity(
  entityType: string,
  entityId: string
): Promise<ActionResult<DocumentRow[]>> {
  return withAction((userId) =>
    listDocumentsForEntity(userId, entityType, entityId)
  );
}
