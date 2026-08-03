"use server";

import { BYTES_PER_MB } from "@/lib/format-utils";
import { SafeError } from "@/lib/errors";
import { getStorageProvider, buildStorageKey } from "@/lib/storage";
import {
  confirmUploadSchema,
  deleteDocumentSchema,
  isAllowedMime,
  isProductionReadingsCsvFormat,
  maxBytesFor,
  requestUploadSchema,
  setVisibilitySchema,
  updateApplicationEvidenceMetadataSchema,
  type DocumentType,
} from "@/schemas/documents";
import {
  deleteDocumentWithCertificationSafety,
  getDocumentById,
  insertDocument,
  listDocumentsForEntity,
  updateDocument,
  assertCanManageDocumentEntity,
  type DocumentRow,
} from "@/data-access/documents";
import type { ActionResult } from "@/types/actions";
import { formatZodActionError } from "./action-errors";
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
    // Parse explicitly so the validation failure remains an intentional,
    // client-safe error at this upload boundary.
    const parsed = requestUploadSchema.safeParse(input);
    if (!parsed.success) {
      throw new SafeError(formatZodActionError(parsed.error));
    }

    const docType = parsed.data.documentType as DocumentType;
    if (
      parsed.data.entityType === "production_run" &&
      docType === "sensor_data" &&
      !isProductionReadingsCsvFormat({
        fileName: parsed.data.fileName,
        contentType: parsed.data.contentType,
      })
    ) {
      throw new SafeError("Readings files must use CSV format.");
    }
    if (!isAllowedMime(docType, parsed.data.contentType)) {
      throw new SafeError(
        "This file type is not allowed for this document. Choose another file."
      );
    }
    const cap = maxBytesFor(docType);
    if (parsed.data.sizeBytes > cap) {
      throw new SafeError(
        `This file is larger than the ${Math.round(cap / BYTES_PER_MB)} MB limit. Choose a smaller file.`
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
    if (!row.storageKey) {
      throw new SafeError(
        "The document is not available in storage. Upload the file again.",
      );
    }
    if (row.uploadStatus !== "pending") {
      throw new SafeError(
        "This file is no longer waiting for confirmation. Upload it again.",
      );
    }

    const provider = getStorageProvider();
    const head = await provider.headObject(row.storageKey);
    if (!head) {
      await updateDocument(ctx, row.id, { uploadStatus: "failed" });
      throw new SafeError(
        "The uploaded file could not be found. Upload it again.",
      );
    }

    const docType = row.documentType as DocumentType;
    const cap = maxBytesFor(docType);
    if (head.size > cap) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(ctx, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError(
        `This file is larger than the ${Math.round(cap / BYTES_PER_MB)} MB limit. Choose a smaller file.`,
      );
    }
    if (!isAllowedMime(docType, head.contentType)) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(ctx, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError(
        "The uploaded file type is not allowed for this document. Choose another file.",
      );
    }
    if (
      row.entityType === "production_run" &&
      docType === "sensor_data" &&
      !isProductionReadingsCsvFormat({
        fileName: row.fileName,
        contentType: head.contentType,
      })
    ) {
      await Promise.allSettled([
        provider.deleteObject(row.storageKey),
        updateDocument(ctx, row.id, { uploadStatus: "failed" }),
      ]);
      throw new SafeError("Readings files must use CSV format.");
    }

    const updated = await updateDocument(ctx, row.id, {
      uploadStatus: "uploaded",
      fileSizeBytes: head.size,
      mimeType: head.contentType,
    });
    if (!updated) {
      throw new SafeError(
        "The document upload could not be completed. Upload the file again.",
      );
    }
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

    const deleted = await deleteDocumentWithCertificationSafety(ctx, row.id);
    if (!deleted) throw new SafeError("Document not found");

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
