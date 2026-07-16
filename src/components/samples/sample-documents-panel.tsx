"use client";

import { useState } from "react";
import { FileIcon, EyeIcon, EyeSlashIcon, TrashIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatFileSize } from "@/lib/format-utils";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
  useSetDocumentVisibility,
} from "@/hooks/use-documents";
import type {
  DocumentEntityType,
  DocumentType,
  DocumentVisibility,
} from "@/schemas/documents";

interface SampleDocumentsPanelProps {
  sampleId: string;
  readOnly?: boolean;
}

const SAMPLE_DOC_TYPE: DocumentType = "lab_report";
const ENTITY_TYPE: DocumentEntityType = "sample";

export function SampleDocumentsPanel({
  sampleId,
  readOnly = false,
}: SampleDocumentsPanelProps) {
  const toast = useToast();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    sampleId,
  );
  const invalidateKey = documentKeys.forEntity(ENTITY_TYPE, sampleId);
  const setVisibilityMutation = useSetDocumentVisibility(invalidateKey);
  const deleteMutation = useDeleteDocument(invalidateKey);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleToggleVisibility = async (
    documentId: string,
    next: DocumentVisibility,
  ) => {
    try {
      await setVisibilityMutation.mutateAsync({ documentId, visibility: next });
      toast.success(`Document is now ${next}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update visibility",
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(deletingId);
      toast.success("Document deleted");
      setDeletingId(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete document",
      );
    }
  };

  const uploadedDocs = (docs ?? []).filter(
    (d) => d.uploadStatus === "uploaded" || d.fileUrl,
  );

  return (
    <section className="flex flex-col gap-12">
      <header className="flex items-center justify-end">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {uploadedDocs.length} {uploadedDocs.length === 1 ? "file" : "files"}
        </span>
      </header>

      {error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "Failed to load documents"
          }
        />
      )}
      {uploadError && <ServerError message={uploadError} />}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading documents…
        </p>
      ) : uploadedDocs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          {readOnly
            ? "No documents attached yet."
            : "No documents attached yet. Upload a lab report below."}
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {uploadedDocs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              <FileIcon
                size={16}
                weight="bold"
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="body-small truncate text-[var(--color-text-primary)]">
                  {doc.fileName}
                </span>
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {doc.documentType} · {formatFileSize(doc.fileSizeBytes)} · {doc.visibility}
                </span>
              </div>
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-interaction)] transition-colors duration-300"
                aria-label={`Open ${doc.fileName}`}
              >
                <ArrowSquareOutIcon size={16} weight="bold" />
              </a>
              {!readOnly && (
                <>
                  <Button
                    variant="noOutline"
                    size="icon"
                    onClick={() =>
                      handleToggleVisibility(
                        doc.id,
                        doc.visibility === "private" ? "public" : "private",
                      )
                    }
                    disabled={setVisibilityMutation.isPending}
                    className="shrink-0"
                    aria-label={
                      doc.visibility === "private"
                        ? "Make public"
                        : "Make private"
                    }
                    title={
                      doc.visibility === "private"
                        ? "Make public (share with buyers)"
                        : "Make private"
                    }
                  >
                    {doc.visibility === "private" ? (
                      <EyeSlashIcon size={16} weight="bold" />
                    ) : (
                      <EyeIcon size={16} weight="bold" />
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => setDeletingId(doc.id)}
                    disabled={deleteMutation.isPending}
                    className="shrink-0"
                    aria-label={`Delete ${doc.fileName}`}
                  >
                    <TrashIcon size={16} weight="bold" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <FormFileUpload
          id={`sample-${sampleId}-documents-upload`}
          accept="image/*,.pdf,.csv,.xlsx"
          multiple
          maxSizeMb={50}
          entityType={ENTITY_TYPE}
          entityId={sampleId}
          documentType={SAMPLE_DOC_TYPE}
          onUploaded={() => setUploadError(null)}
          onUploadError={(err) => setUploadError(err)}
        />
      )}

      {deleteError && <ServerError message={deleteError} />}
      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deletingId}
          title="Delete Document"
          message="Are you sure you want to delete this document? The file will be removed from storage."
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setDeletingId(null);
            setDeleteError(null);
          }}
          isPending={deleteMutation.isPending}
        />
      )}
    </section>
  );
}
