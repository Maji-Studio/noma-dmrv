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
}

export interface DeferredAttachmentFlushResult {
  ok: boolean;
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
  clear: () => void;
  flush: (
    entityType: string,
    entityId: string,
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

  function clear() {
    updateAttachments(() => []);
  }

  async function flushMatching(
    entityType: string,
    entityId: string,
    key?: string,
  ): Promise<DeferredAttachmentFlushResult> {
    const pending = attachmentsRef.current.filter(
      (attachment) =>
        attachment.status !== "uploaded" &&
        attachment.status !== "uploading" &&
        (key === undefined || attachment.key === key),
    );
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
        await upload({
          entityType,
          entityId,
          documentType: attachment.documentType,
          file: attachment.file,
          applicationEvidenceRole:
            attachment.extraMeta?.applicationEvidenceRole,
          applicationLogbookEvidenceType:
            attachment.extraMeta?.applicationLogbookEvidenceType,
        });
        updateAttachments((current) =>
          current.map((item) =>
            item.key === attachment.key
              ? { ...item, status: "uploaded", error: undefined }
              : item,
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

    return { ok: failed.length === 0, failed };
  }

  function flush(entityType: string, entityId: string) {
    return flushMatching(entityType, entityId);
  }

  function retry(entityType: string, entityId: string, key?: string) {
    return flushMatching(entityType, entityId, key);
  }

  return {
    attachments,
    hasHeld: attachments.some((attachment) => attachment.status !== "uploaded"),
    add,
    remove,
    clear,
    flush,
    retry,
  };
}
