"use server";

import { getUser } from "@/lib/auth/server";
import { BYTES_PER_MB } from "@/lib/format-utils";
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
import type { ActionResult } from "@/types/actions";

export interface RequestUploadResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
  storageKey: string;
}

function failure(message: string): ActionResult<never> {
  return { success: false, error: message };
}

function unauthorized(): ActionResult<never> {
  return failure("Unauthorized");
}

export async function requestUpload(
  input: unknown
): Promise<ActionResult<RequestUploadResult>> {
  const user = await getUser();
  if (!user?.id) return unauthorized();

  const parsed = requestUploadSchema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const docType = parsed.data.documentType as DocumentType;
  if (!isAllowedMime(docType, parsed.data.contentType)) {
    return failure(
      `Content type ${parsed.data.contentType} not allowed for ${docType}`
    );
  }
  const cap = maxBytesFor(docType);
  if (parsed.data.sizeBytes > cap) {
    return failure(
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

  const row = await insertDocument(user.id, {
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
    capturedAt: parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : null,
    description: parsed.data.description ?? null,
    createdBy: user.id,
  });

  return {
    success: true,
    data: {
      documentId: row.id,
      uploadUrl: presign.url,
      headers: presign.headers,
      expiresAt: presign.expiresAt.toISOString(),
      storageKey,
    },
  };
}

export async function confirmUpload(
  input: unknown
): Promise<ActionResult<DocumentRow>> {
  const user = await getUser();
  if (!user?.id) return unauthorized();

  const parsed = confirmUploadSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);

  const row = await getDocumentById(user.id, parsed.data.documentId);
  if (!row) return failure("Document not found");
  if (!row.storageKey) return failure("Document has no storage key");
  if (row.uploadStatus !== "pending") {
    return failure(`Document already in '${row.uploadStatus}' state`);
  }

  const provider = getStorageProvider();
  const head = await provider.headObject(row.storageKey);
  if (!head) {
    await updateDocument(user.id, row.id, { uploadStatus: "failed" });
    return failure("Uploaded object not found in storage");
  }

  const docType = row.documentType as DocumentType;
  const cap = maxBytesFor(docType);
  if (head.size > cap) {
    await Promise.allSettled([
      provider.deleteObject(row.storageKey),
      updateDocument(user.id, row.id, { uploadStatus: "failed" }),
    ]);
    return failure(
      `Object size ${head.size} exceeds ${cap}-byte cap for ${docType}`
    );
  }
  if (!isAllowedMime(docType, head.contentType)) {
    await Promise.allSettled([
      provider.deleteObject(row.storageKey),
      updateDocument(user.id, row.id, { uploadStatus: "failed" }),
    ]);
    return failure(
      `Object content-type ${head.contentType} not allowed for ${docType}`
    );
  }

  const updated = await updateDocument(user.id, row.id, {
    uploadStatus: "uploaded",
    fileSizeBytes: head.size,
    mimeType: head.contentType,
  });
  if (!updated) return failure("Failed to mark document uploaded");
  return { success: true, data: updated };
}

export async function setDocumentVisibility(
  input: unknown
): Promise<ActionResult<DocumentRow>> {
  const user = await getUser();
  if (!user?.id) return unauthorized();

  const parsed = setVisibilitySchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);

  const updated = await updateDocument(user.id, parsed.data.documentId, {
    visibility: parsed.data.visibility,
  });
  if (!updated) return failure("Document not found");
  return { success: true, data: updated };
}

export async function deleteDocument(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const user = await getUser();
  if (!user?.id) return unauthorized();

  const parsed = deleteDocumentSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);

  const row = await getDocumentById(user.id, parsed.data.documentId);
  if (!row) return failure("Document not found");

  if (row.storageKey) {
    const provider = getStorageProvider();
    try {
      await provider.deleteObject(row.storageKey);
    } catch (err) {
      console.error("Failed to delete storage object", {
        documentId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await deleteDocumentRow(user.id, row.id);
  return { success: true, data: { id: row.id } };
}

export async function getDocumentsForEntity(
  entityType: string,
  entityId: string
): Promise<ActionResult<DocumentRow[]>> {
  const user = await getUser();
  if (!user?.id) return unauthorized();
  const rows = await listDocumentsForEntity(user.id, entityType, entityId);
  return { success: true, data: rows };
}
