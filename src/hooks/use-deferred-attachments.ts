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
  retry: (
    entityType: string,
    entityId: string,
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

  async function flushMatching(
    entityType: string,
    entityId: string,
    key?: string,
  ): Promise<DeferredAttachmentFlushResult> {
    return flushToEntities(
      [entityId],
      attachmentsRef.current.filter(
        (attachment) =>
          attachment.status !== "uploaded" &&
          attachment.status !== "uploading" &&
          (key === undefined || attachment.key === key),
      ),
      entityType,
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

      try {
        let lastDocumentId: string | undefined;
        // Attach the same physical file to every target row (e.g. a multi-bin
        // feedstock split). Stop at the first failure so a partial write is
        // recorded as failed rather than silently half-done.
        for (const entityId of entityIds) {
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
        }
        const uploadedAttachment: DeferredAttachment = {
          ...attachment,
          status: "uploaded",
          error: undefined,
          documentId: lastDocumentId,
        };
        uploaded.push(uploadedAttachment);
        updateAttachments((current) =>
          current.map((item) =>
            item.key === attachment.key ? uploadedAttachment : item,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        const failedAttachment: DeferredAttachment = {
          ...attachment,
          status: "failed",
          error: message,
        };
        failed.push(failedAttachment);
        updateAttachments((current) =>
          current.map((item) =>
            item.key === attachment.key ? failedAttachment : item,
          ),
        );
      }
    }

    return { ok: failed.length === 0, uploaded, failed };
  }

  function flush(entityType: string, entityId: string) {
    return flushMatching(entityType, entityId);
  }

  function flushMany(entityType: string, entityIds: string[]) {
    return flushToEntities(
      entityIds,
      attachmentsRef.current.filter(
        (attachment) =>
          attachment.status !== "uploaded" &&
          attachment.status !== "uploading",
      ),
      entityType,
    );
  }

  function retry(entityType: string, entityId: string, key?: string) {
    return flushMatching(entityType, entityId, key);
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
