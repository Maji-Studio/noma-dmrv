"use client";

import { useState } from "react";
import {
  ArrowSquareOut,
  Camera,
  File,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload, ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import { formatFileSize } from "@/lib/format-utils";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";

const ENTITY_TYPE: DocumentEntityType = "application";
const VISUAL_DOC_TYPE: DocumentType = "photo";
const BOUNDARY_DOC_TYPE: DocumentType = "pdf";

type EvidenceMode = "visual" | "boundary";

interface ApplicationEvidencePanelProps {
  applicationId?: string;
  mode: EvidenceMode;
  disabled?: boolean;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function missingExifLabel(metadata: unknown): string | null {
  const missing = metadataRecord(metadata).missingExif;
  if (!Array.isArray(missing) || missing.length === 0) return null;
  return missing.filter((item) => typeof item === "string").join(", ");
}

export function ApplicationEvidencePanel({
  applicationId,
  mode,
  disabled = false,
}: ApplicationEvidencePanelProps) {
  const toast = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    applicationId,
    { enabled: !!applicationId },
  );
  const invalidateKey = applicationId
    ? documentKeys.forEntity(ENTITY_TYPE, applicationId)
    : undefined;
  const deleteMutation = useDeleteDocument(invalidateKey);

  const documentType = mode === "visual" ? VISUAL_DOC_TYPE : BOUNDARY_DOC_TYPE;
  const visibleDocs = (docs ?? []).filter(
    (doc) =>
      doc.documentType === documentType &&
      (doc.uploadStatus === "uploaded" || doc.fileUrl),
  );

  const handleDelete = async () => {
    if (!deleteId) return;
    setErrorMessage(null);
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Evidence deleted");
      setDeleteId(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to delete evidence",
      );
    }
  };

  if (!applicationId) {
    return (
      <div className="border border-[var(--color-border-tertiary)] bg-[var(--color-background-sunken)] px-16 py-12">
        <p className="body-small text-[var(--color-text-secondary)]">
          Evidence upload is available after the application is saved.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-12 border border-[var(--color-border-secondary)] p-16">
      <header className="flex items-center justify-between gap-12">
        <h3 className="title-heading-3 flex items-center gap-8">
          {mode === "visual" ? (
            <Camera size={18} weight="bold" />
          ) : (
            <File size={18} weight="bold" />
          )}
          Evidence
        </h3>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {visibleDocs.length} {visibleDocs.length === 1 ? "file" : "files"}
        </span>
      </header>

      {(error || errorMessage) && (
        <ServerError
          message={
            errorMessage ??
            (error instanceof Error ? error.message : "Failed to load evidence")
          }
        />
      )}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading evidence...
        </p>
      ) : visibleDocs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No evidence files attached yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {visibleDocs.map((doc) => {
            const missingExif = missingExifLabel(doc.metadata);
            return (
              <li
                key={doc.id}
                className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
              >
                <File
                  size={16}
                  weight="bold"
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="body-small truncate text-[var(--color-text-primary)]">
                    {doc.fileName}
                  </span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {formatFileSize(doc.fileSizeBytes)}
                    {doc.capturedAt
                      ? ` · ${new Date(doc.capturedAt).toLocaleDateString()}`
                      : ""}
                  </span>
                  {missingExif && (
                    <span className="inline-flex items-center gap-4 body-caption text-[var(--color-signal-orange-strong)]">
                      <WarningCircle size={14} weight="bold" />
                      No geotag: {missingExif}
                    </span>
                  )}
                </div>
                <a
                  href={`/api/documents/${doc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 p-4 text-[var(--color-text-tertiary)] transition-colors duration-300 hover:text-[var(--color-interaction)]"
                  aria-label={`Open ${doc.fileName}`}
                >
                  <ArrowSquareOut size={16} weight="bold" />
                </a>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setDeleteId(doc.id)}
                  disabled={deleteMutation.isPending || disabled}
                  className="shrink-0"
                  aria-label={`Delete ${doc.fileName}`}
                >
                  <Trash size={16} weight="bold" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <FormFileUpload
        id={`application-${applicationId}-${mode}-evidence-upload`}
        accept={mode === "visual" ? "image/*" : "application/pdf,.pdf"}
        multiple={mode === "visual"}
        maxSizeMb={mode === "visual" ? 25 : 50}
        disabled={disabled}
        entityType={ENTITY_TYPE}
        entityId={applicationId}
        documentType={documentType}
        onUploaded={() => setErrorMessage(null)}
        onUploadError={(err) => setErrorMessage(err)}
      />

      <DeleteConfirmDialog
        isOpen={!!deleteId}
        title="Delete Evidence"
        message="Are you sure you want to delete this evidence file?"
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleteId(null);
          setErrorMessage(null);
        }}
        isPending={deleteMutation.isPending}
      />
    </section>
  );
}
