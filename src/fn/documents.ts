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
  updateApplicationEvidenceMetadataSchema,
  type DocumentType,
} from "@/schemas/documents";
import {
  deleteDocumentRow,
  getDocumentById,
  insertDocument,
  listDocumentsForEntity,
  updateDocument,
  assertCanManageDocumentEntity,
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
  entityType: string;
  documentType: DocumentType;
  capturedAt?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  applicationEvidenceRole?: string;
  applicationLogbookEvidenceType?: string;
}): Record<string, unknown> {
  const applicationMetadata =
    input.entityType === "application"
      ? {
          ...(input.applicationEvidenceRole
            ? { evidenceRole: input.applicationEvidenceRole }
            : {}),
          ...(input.applicationLogbookEvidenceType
            ? { logbookEvidenceType: input.applicationLogbookEvidenceType }
            : {}),
        }
      : {};

  if (input.documentType !== "photo" && input.documentType !== "video") {
    return applicationMetadata;
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
    ...applicationMetadata,
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

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export async function requestUpload(
  input: unknown
): Promise<ActionResult<RequestUploadResult>> {
  return withAction(async (ctx) => {
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
    await assertCanManageDocumentEntity(
      ctx, parsed.data.entityType,
      parsed.data.entityId,
    );

    const provider = getStorageProvider();
    const storageKey = `org/${ctx.organizationId}/${buildStorageKey({
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      documentType: docType,
      fileName: parsed.data.fileName,
    })}`;

    const presign = await provider.createUploadUrl({
      key: storageKey,
      contentType: parsed.data.contentType,
      maxBytes: cap,
    });

    const metadata = buildDocumentMetadata({
      entityType: parsed.data.entityType,
      documentType: docType,
      capturedAt: parsed.data.capturedAt,
      gpsLatitude: parsed.data.gpsLatitude,
      gpsLongitude: parsed.data.gpsLongitude,
      applicationEvidenceRole: parsed.data.applicationEvidenceRole,
      applicationLogbookEvidenceType:
        parsed.data.applicationLogbookEvidenceType,
    });

    const row = await insertDocument(ctx, {
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
      createdBy: ctx.userId,
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
  return withAction(async (ctx) => {
    const { documentId } = confirmUploadSchema.parse(input);

    const row = await getDocumentById(ctx, documentId);
    if (!row) throw new SafeError("Document not found");
    await assertCanManageDocumentEntity(ctx, row.entityType, row.entityId);
    if (!row.storageKey) throw new SafeError("Document has no storage key");
    if (row.uploadStatus !== "pending") {
      throw new SafeError(`Document already in '${row.uploadStatus}' state`);
    }

    const provider = getStorageProvider();
    const head = await provider.headObject(row.storageKey);
    if (!head) {
      await updateDocument(ctx, row.id, { uploadStatus: "failed" });
      throw new SafeError("Uploaded object not found in storage");
    }

    const docType = row.documentType as DocumentType;
    const cap = maxBytesFor(docType);
    if (head.size > cap) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(ctx, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError(
        `Object size ${head.size} exceeds ${cap}-byte cap for ${docType}`
      );
    }
    if (!isAllowedMime(docType, head.contentType)) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(ctx, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError(
        `Object content-type ${head.contentType} not allowed for ${docType}`
      );
    }

    const updated = await updateDocument(ctx, row.id, {
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
  return withAction(async (ctx) => {
    const data = setVisibilitySchema.parse(input);

    const updated = await updateDocument(ctx, data.documentId, {
      visibility: data.visibility,
    });
    if (!updated) throw new SafeError("Document not found");
    return updated;
  });
}

export async function updateApplicationEvidenceMetadata(
  input: unknown
): Promise<ActionResult<DocumentRow>> {
  return withAction(async (ctx) => {
    const data = updateApplicationEvidenceMetadataSchema.parse(input);

    const row = await getDocumentById(ctx, data.documentId);
    if (!row) throw new SafeError("Document not found");
    await assertCanManageDocumentEntity(ctx, row.entityType, row.entityId);
    if (row.entityType !== "application") {
      throw new SafeError("Evidence classification is only available for applications");
    }

    const patch: Record<string, unknown> = {};
    if (data.applicationEvidenceRole !== undefined) {
      if (row.documentType !== "photo") {
        throw new SafeError("Visual evidence role can only be set on photos");
      }
      patch.evidenceRole = data.applicationEvidenceRole;
    }
    if (data.applicationLogbookEvidenceType !== undefined) {
      if (
        row.documentType !== "pdf" &&
        row.documentType !== "weighbridge_ticket" &&
        row.documentType !== "affidavit"
      ) {
        throw new SafeError(
          "Boundary logbook evidence type can only be set on logbook documents",
        );
      }
      patch.logbookEvidenceType = data.applicationLogbookEvidenceType;
    }

    const updated = await updateDocument(ctx, row.id, {
      metadata: {
        ...metadataRecord(row.metadata),
        ...patch,
      },
    });
    if (!updated) throw new SafeError("Document not found");
    return updated;
  });
}

export async function deleteDocument(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  return withAction(async (ctx) => {
    const { documentId } = deleteDocumentSchema.parse(input);

    const row = await getDocumentById(ctx, documentId);
    if (!row) throw new SafeError("Document not found");
    await assertCanManageDocumentEntity(ctx, row.entityType, row.entityId);

    // Fast user-facing path; the FK-backed delete below remains the real race
    // guard in case a mirror appears after this check.
    const isometricMirror = await getDocumentUploadByDocument(
      ctx, ISOMETRIC_PROVIDER,
      row.id,
    );
    if (isometricMirror) {
      throw new SafeError(
        "This document is mirrored to Isometric as a Source. Unlink it from the Removal's Sources panel before deleting.",
      );
    }

    let deleted: DocumentRow | null;
    try {
      deleted = await deleteDocumentRow(ctx, row.id);
    } catch (err) {
      const mirror = await getDocumentUploadByDocument(
        ctx, ISOMETRIC_PROVIDER,
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
          await insertDocument(ctx, deleted);
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
  return withAction((ctx) =>
    listDocumentsForEntity(ctx, entityType, entityId)
  );
}
