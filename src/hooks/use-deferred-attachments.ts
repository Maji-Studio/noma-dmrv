"use client";

import { useRef, useState } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import type {
  ApplicationBoundaryLogbookEvidenceType,
  ApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";
import type { DocumentType } from "@/schemas/documents";

export interface DeferredFileEntry {
  key: string;
  file: File;
  classificationLabel?: string;
}

export interface DeferredAttachmentExtraMeta {
  applicationEvidenceRole?: ApplicationVisualEvidenceRole;
  applicationLogbookEvidenceType?: ApplicationBoundaryLogbookEvidenceType;
}

export interface DeferredAttachment extends DeferredFileEntry {
  documentType: DocumentType;
  extraMeta?: DeferredAttachmentExtraMeta;
  status: "held" | "uploading" | "uploaded" | "failed";
  error?: string;
  /** Document id created by the last successful upload (set on flush). */
  documentId?: string;
  /**
   * Entity ids this file has already been attached to. When a create produces
   * several rows (e.g. a multi-bin feedstock split) the same file is attached
   * to each; retry re-sends only to the rows still missing from this list so a
   * partial failure never duplicates the doc on rows that already succeeded.
   */
  uploadedEntityIds: string[];
}

export interface DeferredAttachmentFlushResult {
  ok: boolean;
  /** Entries uploaded during this flush, carrying their created document ids. */
  uploaded: DeferredAttachment[];
  failed: DeferredAttachment[];
}

export interface UseDeferredAttachmentsResult {
  attachments: DeferredAttachment[];
  hasHeld: boolean;
  add: (
    files: File[],
    documentType: DocumentType,
    extraMeta?: DeferredAttachmentExtraMeta,
  ) => void;
  remove: (key: string) => void;
  /** Re-tag a held entry's metadata (e.g. a classification radio changed). */
  updateMeta: (key: string, extraMeta?: DeferredAttachmentExtraMeta) => void;
  clear: () => void;
  flush: (
    entityType: string,
    entityId: string,
  ) => Promise<DeferredAttachmentFlushResult>;
  /**
   * Upload every held entry to each of `entityIds` (same physical file
   * attached to each). Used when one create produces several rows, e.g. a
   * multi-bin feedstock split.
   */
  flushMany: (
    entityType: string,
    entityIds: string[],
  ) => Promise<DeferredAttachmentFlushResult>;
  /**
   * Re-attempt held/failed entries against the full target-id list. Each
   * attachment skips rows it already reached, so callers must pass every
   * target row (not just one) or rows that were never attempted stay missing.
   */
  retry: (
    entityType: string,
    entityIds: string[],
    key?: string,
  ) => Promise<DeferredAttachmentFlushResult>;
}

export function useDeferredAttachments(): UseDeferredAttachmentsResult {
  const [attachments, setAttachments] = useState<DeferredAttachment[]>([]);
  const attachmentsRef = useRef<DeferredAttachment[]>([]);
  const { upload } = useFileUpload();

  function updateAttachments(
    update: (current: DeferredAttachment[]) => DeferredAttachment[],
  ): DeferredAttachment[] {
    const next = update(attachmentsRef.current);
    attachmentsRef.current = next;
    setAttachments(next);
    return next;
  }

  function add(
    files: File[],
    documentType: DocumentType,
    extraMeta?: DeferredAttachmentExtraMeta,
  ) {
    if (files.length === 0) return;
    updateAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        key: crypto.randomUUID(),
        file,
        documentType,
        extraMeta,
        status: "held" as const,
        uploadedEntityIds: [],
      })),
    ]);
  }

  function remove(key: string) {
    updateAttachments((current) =>
      current.filter((attachment) => attachment.key !== key),
    );
  }

  function updateMeta(key: string, extraMeta?: DeferredAttachmentExtraMeta) {
    updateAttachments((current) =>
      current.map((item) =>
        item.key === key && item.status !== "uploaded"
          ? { ...item, extraMeta }
          : item,
      ),
    );
  }

  function clear() {
    updateAttachments(() => []);
  }

  function pendingEntries(key?: string): DeferredAttachment[] {
    return attachmentsRef.current.filter(
      (attachment) =>
        // "uploaded" means attached to every target so far, so it is skipped;
        // a still-incomplete attachment is left "failed" and remains eligible.
        attachment.status !== "uploaded" &&
        attachment.status !== "uploading" &&
        (key === undefined || attachment.key === key),
    );
  }

  async function flushToEntities(
    entityIds: string[],
    pending: DeferredAttachment[],
    entityType: string,
  ): Promise<DeferredAttachmentFlushResult> {
    const uploaded: DeferredAttachment[] = [];
    const failed: DeferredAttachment[] = [];

    // One useFileUpload instance aborts its previous request when upload is
    // called again, so this loop must remain sequential.
    for (const attachment of pending) {
      updateAttachments((current) =>
        current.map((item) =>
          item.key === attachment.key
            ? { ...item, status: "uploading", error: undefined }
            : item,
        ),
      );

      // Attach the same physical file to every target row (e.g. a multi-bin
      // feedstock split), skipping rows a previous attempt already reached.
      // Every remaining row is attempted even if an earlier one fails, so one
      // failure never blocks the others and successes are recorded per-row.
      const succeeded = new Set(attachment.uploadedEntityIds);
      let lastDocumentId = attachment.documentId;
      let lastError: string | undefined;
      for (const entityId of entityIds) {
        if (succeeded.has(entityId)) continue;
        try {
          const result = await upload({
            entityType,
            entityId,
            documentType: attachment.documentType,
            file: attachment.file,
            applicationEvidenceRole:
              attachment.extraMeta?.applicationEvidenceRole,
            applicationLogbookEvidenceType:
              attachment.extraMeta?.applicationLogbookEvidenceType,
          });
          lastDocumentId = result.documentId;
          succeeded.add(entityId);
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Upload failed";
        }
      }

      const uploadedEntityIds = entityIds.filter((id) => succeeded.has(id));
      const missing = entityIds.some((id) => !succeeded.has(id));
      const settled: DeferredAttachment = missing
        ? {
            ...attachment,
            status: "failed",
            error: lastError ?? "Upload failed",
            documentId: lastDocumentId,
            uploadedEntityIds,
          }
        : {
            ...attachment,
            status: "uploaded",
            error: undefined,
            documentId: lastDocumentId,
            uploadedEntityIds,
          };
      (missing ? failed : uploaded).push(settled);
      updateAttachments((current) =>
        current.map((item) => (item.key === attachment.key ? settled : item)),
      );
    }

    return { ok: failed.length === 0, uploaded, failed };
  }

  function flush(entityType: string, entityId: string) {
    return flushToEntities([entityId], pendingEntries(), entityType);
  }

  function flushMany(entityType: string, entityIds: string[]) {
    return flushToEntities(entityIds, pendingEntries(), entityType);
  }

  function retry(entityType: string, entityIds: string[], key?: string) {
    return flushToEntities(entityIds, pendingEntries(key), entityType);
  }

  return {
    attachments,
    hasHeld: attachments.some((attachment) => attachment.status !== "uploaded"),
    add,
    remove,
    updateMeta,
    clear,
    flush,
    flushMany,
    retry,
  };
}
